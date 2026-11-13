// Avatar 3D de Violet (VRM 1.0). El movimiento vive en violetMotion.js. La boca en `talking`
// sale del texto de la respuesta: no hay voz ni sincronización con audio.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import VioletAvatarFallback from './VioletAvatarFallback.jsx';
import { CAMERA_ZOOM, createRig } from './violetMotion.js';

const MODEL_URL = '/api/v1/violet/avatar.vrm';
const CAMERA_FOV = 24;
// Parte del tramo cadera-cabeza que queda fuera de cuadro, para que el corte del modelo nunca se vea.
const BUST_CROP = 0.3;
const HEAD_MARGIN = 0.04;
const CUT_MARGIN = 0.03;
const FACE_HEIGHT = 0.3;
const CAMERA_SPEED = 1.4;
const POINTER_RANGE_PX = 450;

// El tramo vertical es fijo: si el panel es angosto se recortan los costados, nunca se ve el corte inferior.
function frameBust(camera, vrm) {
  vrm.scene.updateMatrixWorld(true);
  const hips = vrm.humanoid.getRawBoneNode('hips').getWorldPosition(new THREE.Vector3());
  const headBone = vrm.humanoid.getRawBoneNode('head').getWorldPosition(new THREE.Vector3());
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const bottom = Math.max(hips.y + (headBone.y - hips.y) * BUST_CROP, bounds.min.y + CUT_MARGIN);
  const top = bounds.max.y + HEAD_MARGIN;
  return { top, bottom, modelBottom: bounds.min.y };
}

// Acercarse solo sube el borde inferior: el corte del modelo sigue fuera de cuadro.
function aimCamera(camera, { top, bottom }, zoom) {
  const lowest = bottom + (top - bottom) * zoom;
  const center = (top + lowest) / 2;
  const distance = (top - lowest) / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  camera.position.set(0, center, distance);
  camera.lookAt(0, center, 0);
}

export default function VioletAvatar3D({ state = 'idle', speech = null, onLoadEnd }) {
  const hostRef = useRef(null);
  const stateRef = useRef(state);
  const onLoadEndRef = useRef(onLoadEnd);
  const rigRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    stateRef.current = state;
    onLoadEndRef.current = onLoadEnd;
  }, [state, onLoadEnd]);

  // `speech` es un objeto nuevo por respuesta: dos respuestas con el mismo texto también se dicen.
  useEffect(() => {
    if (speech) rigRef.current?.say(speech.text);
  }, [speech]);

  useEffect(() => {
    const host = hostRef.current;
    let disposed = false;
    let renderer = null;
    let vrm = null;
    let animate = null;

    const fail = (err) => {
      if (disposed) return;
      console.warn('Avatar 3D de Violet no disponible:', err?.message || err);
      setStatus('error');
      renderer?.setAnimationLoop(null);
      onLoadEndRef.current?.();
    };
    const onContextLost = () => fail(new Error('Se perdió el contexto WebGL'));
    const onVisibility = () => {
      if (!renderer || !animate) return;
      renderer.setAnimationLoop(document.hidden ? null : animate);
    };
    // Mira hacia el puntero, tomando como centro la zona de su cara en el panel.
    const onPointerMove = (event) => {
      const rect = host.getBoundingClientRect();
      rigRef.current?.setPointer(
        (event.clientX - (rect.left + rect.width / 2)) / POINTER_RANGE_PX,
        (rect.top + rect.height * FACE_HEIGHT - event.clientY) / POINTER_RANGE_PX,
      );
    };

    let resizeObserver = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      renderer.domElement.style.display = 'block';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 20);
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(-0.6, 1.2, 1.4);
      scene.add(key, new THREE.AmbientLight(0xffffff, 0.45));

      const resize = () => {
        const { clientWidth: width, clientHeight: height } = host;
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      resize();
      document.addEventListener('visibilitychange', onVisibility);

      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      loader.load(MODEL_URL, (gltf) => {
        if (disposed) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }
        try {
          if (!gltf.userData.vrm) throw new Error('El archivo no es un VRM válido');
          vrm = gltf.userData.vrm;
          VRMUtils.combineSkeletons(gltf.scene);
          scene.add(vrm.scene);
          vrm.scene.traverse((object) => { object.frustumCulled = false; });

          const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          const rig = createRig(vrm, { calm });
          rigRef.current = rig;
          const frame = frameBust(camera, vrm);
          let zoom = calm ? CAMERA_ZOOM.idle : CAMERA_ZOOM[stateRef.current] ?? CAMERA_ZOOM.idle;
          aimCamera(camera, frame, zoom);
          // El primer cuadro ya sale en pose: no se ve la pose de reposo del archivo.
          rig.update(stateRef.current, 0);
          const debug = import.meta.env.DEV ? { vrm, camera, frame, renderer, scene, rig, forcedState: null } : null;
          const clock = new THREE.Clock();
          animate = () => {
            const dt = Math.min(clock.getDelta(), 0.05);
            const current = debug?.forcedState || stateRef.current;
            rig.update(current, dt);
            if (!calm) {
              zoom += ((CAMERA_ZOOM[current] ?? CAMERA_ZOOM.idle) - zoom) * (1 - Math.exp(-CAMERA_SPEED * dt));
              aimCamera(camera, frame, zoom);
            }
            vrm.update(dt);
            renderer.render(scene, camera);
          };
          if (!document.hidden) renderer.setAnimationLoop(animate);
          if (debug) window.__violetAvatar = debug;
          window.addEventListener('pointermove', onPointerMove, { passive: true });
          setStatus('ready');
          onLoadEndRef.current?.();
        } catch (err) {
          fail(err);
        }
      }, undefined, fail);
    } catch (err) {
      fail(err);
    }

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointerMove);
      rigRef.current = null;
      if (import.meta.env.DEV) delete window.__violetAvatar;
      if (vrm) VRMUtils.deepDispose(vrm.scene);
      if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full" data-avatar-state={state} data-avatar-status={status}>
      <div ref={hostRef} className={`absolute inset-0 ${status === 'error' ? 'hidden' : ''}`} />
      {status === 'loading' && (
        <p className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-bridge-500">
          Cargando avatar...
        </p>
      )}
      {status === 'error' && <VioletAvatarFallback />}
    </div>
  );
}
