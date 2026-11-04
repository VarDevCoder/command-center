// Avatar 3D de Violet (VRM 1.0). La boca en `talking` es una animación genérica:
// no hay voz ni sincronización con audio.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import VioletAvatarFallback from './VioletAvatarFallback.jsx';

const MODEL_URL = '/api/v1/violet/avatar.vrm';
const CAMERA_FOV = 24;
// Parte del tramo cadera-cabeza que queda fuera de cuadro, para que el corte del modelo nunca se vea.
const BUST_CROP = 0.3;
const HEAD_MARGIN = 0.04;
const CUT_MARGIN = 0.03;

const THINKING_TARGET = new THREE.Vector3(-0.135, 1.35, 0.15);
const THINKING_POLE = new THREE.Vector3(-0.7, -1, -0.05);
const GREETING_TARGET = new THREE.Vector3(-0.31, 1.36, 0.1);
const GREETING_POLE = new THREE.Vector3(-0.25, -1, -0.1);

const damp = (current, target, dt, speed = 6) => current + (target - current) * (1 - Math.exp(-speed * dt));

function blinkAmount(t) {
  const period = 4.3;
  const phase = (t + Math.sin(t * 0.37) * 0.8) % period;
  return phase < 0.14 ? Math.sin((phase / 0.14) * Math.PI) : 0;
}

function createRig(vrm) {
  const weights = {};
  const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);
  const worldPosition = (name) => vrm.humanoid.getRawBoneNode(name).getWorldPosition(new THREE.Vector3());

  vrm.scene.updateMatrixWorld(true);
  const shoulder = worldPosition('rightUpperArm');
  const elbowRest = worldPosition('rightLowerArm');
  const wristRest = worldPosition('rightHand');
  const upperLength = shoulder.distanceTo(elbowRest);
  const lowerLength = elbowRest.distanceTo(wristRest);
  const restDirection = new THREE.Vector3(-1, 0, 0);
  const restAngle = Math.atan2(shoulder.y - wristRest.y, Math.abs(wristRest.x - shoulder.x));
  const armDrop = THREE.MathUtils.degToRad(74) - restAngle;

  const setExpression = (name, value, dt) => {
    weights[name] = damp(weights[name] || 0, value, dt);
    vrm.expressionManager.setValue(name, weights[name]);
  };

  const rotate = (name, [x, y, z], dt) => {
    const node = bone(name);
    if (!node) return;
    node.rotation.x = damp(node.rotation.x, x, dt, 5);
    node.rotation.y = damp(node.rotation.y, y, dt, 5);
    node.rotation.z = damp(node.rotation.z, z, dt, 5);
  };

  // IK de dos huesos: lleva la muñeca derecha a un punto del modelo; el codo se orienta hacia pole.
  const solveRightArm = (target, pole, dt) => {
    const toTarget = new THREE.Vector3().subVectors(target, shoulder);
    const length = THREE.MathUtils.clamp(
      toTarget.length(),
      Math.abs(upperLength - lowerLength) + 1e-3,
      upperLength + lowerLength - 1e-3,
    );
    const direction = toTarget.normalize();
    const cos = (upperLength ** 2 + length ** 2 - lowerLength ** 2) / (2 * upperLength * length);
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
    const elbow = shoulder.clone().addScaledVector(direction, upperLength * cos).addScaledVector(bend, upperLength * sin);
    const wrist = shoulder.clone().addScaledVector(direction, length);
    const upperDirection = elbow.clone().sub(shoulder).normalize();
    const upperRotation = new THREE.Quaternion().setFromUnitVectors(restDirection, upperDirection);
    const lowerDirection = wrist.clone().sub(elbow).normalize().applyQuaternion(upperRotation.clone().invert());
    const lowerRotation = new THREE.Quaternion().setFromUnitVectors(restDirection, lowerDirection);
    const k = 1 - Math.exp(-5 * dt);
    bone('rightUpperArm').quaternion.slerp(upperRotation, k);
    bone('rightLowerArm').quaternion.slerp(lowerRotation, k);
  };

  return function pose(state, t, dt) {
    const breath = Math.sin(t * 1.5);
    const sway = Math.sin(t * 0.55);
    const look = { x: 0, y: 0 };
    let ik = null;
    let neck = [0, sway * 0.03, 0];
    let head = [0, 0, 0];
    const right = { upper: [-0.04, 0, armDrop], lower: [0, 0.22, 0], hand: [0, 0, 0.05] };
    const left = { upper: [-0.04, 0, -armDrop + sway * 0.012], lower: [0, -0.22, 0], hand: [0, 0, -0.05] };
    const expression = { aa: 0, oh: 0, ee: 0, ih: 0, ou: 0, happy: 0, thinking: 0, listening: 0, focused: 0, smirk: 0 };

    if (state === 'idle') {
      expression.happy = 0.12;
      look.y = Math.sin(t * 0.31) * 0.25;
    } else if (state === 'talking') {
      const syllable = Math.sin(t * 9.3) * 0.5 + 0.5;
      const pick = Math.floor(t * 3.1) % 4;
      expression.aa = pick === 0 ? syllable * 0.8 : 0;
      expression.oh = pick === 1 ? syllable * 0.7 : 0;
      expression.ee = pick === 2 ? syllable * 0.7 : 0;
      expression.ih = pick === 3 ? syllable * 0.7 : 0;
      expression.happy = 0.18;
      head = [Math.sin(t * 2.3) * 0.03, Math.sin(t * 1.1) * 0.05, Math.sin(t * 1.7) * 0.02];
      right.lower = [0, 0.55 + Math.sin(t * 1.9) * 0.12, 0];
    } else if (state === 'thinking') {
      expression.thinking = 1;
      neck = [0.05, 0.1, 0.1];
      head = [-0.05, 0.08, 0.08];
      look.x = 0.6;
      look.y = 0.5;
      ik = { target: THINKING_TARGET, pole: THINKING_POLE };
      right.hand = [0, 0, 0.12];
    } else if (state === 'listening') {
      expression.listening = 1;
      neck = [0.03, 0, -0.08];
      head = [0.04, 0, -0.08 + Math.sin(t * 1.2) * 0.012];
    } else if (state === 'greeting') {
      expression.happy = 0.75;
      ik = { target: GREETING_TARGET, pole: GREETING_POLE };
      right.hand = [0, 0, Math.sin(t * 7) * 0.22];
      neck = [0, 0, -0.05];
    }

    rotate('spine', [breath * 0.012, sway * 0.018, sway * 0.012], dt);
    rotate('chest', [breath * 0.018, 0, 0], dt);
    rotate('neck', neck, dt);
    rotate('head', head, dt);
    if (ik) {
      solveRightArm(ik.target, ik.pole, dt);
    } else {
      rotate('rightUpperArm', right.upper, dt);
      rotate('rightLowerArm', right.lower, dt);
    }
    rotate('rightHand', right.hand, dt);
    rotate('leftUpperArm', left.upper, dt);
    rotate('leftLowerArm', left.lower, dt);
    rotate('leftHand', left.hand, dt);

    Object.entries(expression).forEach(([name, value]) => setExpression(name, value, dt));
    setExpression('lookLeft', Math.max(look.y, 0), dt);
    setExpression('lookRight', Math.max(-look.y, 0), dt);
    setExpression('lookUp', Math.max(look.x, 0), dt);
    setExpression('lookDown', Math.max(-look.x, 0), dt);
    vrm.expressionManager.setValue('blink', blinkAmount(t));
  };
}

// El tramo vertical es fijo: si el panel es angosto se recortan los costados, nunca se ve el corte inferior.
function frameBust(camera, vrm) {
  vrm.scene.updateMatrixWorld(true);
  const hips = vrm.humanoid.getRawBoneNode('hips').getWorldPosition(new THREE.Vector3());
  const headBone = vrm.humanoid.getRawBoneNode('head').getWorldPosition(new THREE.Vector3());
  const bounds = new THREE.Box3().setFromObject(vrm.scene);
  const bottom = Math.max(hips.y + (headBone.y - hips.y) * BUST_CROP, bounds.min.y + CUT_MARGIN);
  const top = bounds.max.y + HEAD_MARGIN;
  const center = (top + bottom) / 2;
  const distance = (top - bottom) / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  camera.position.set(0, center, distance);
  camera.lookAt(0, center, 0);
  return { top, bottom, modelBottom: bounds.min.y };
}

export default function VioletAvatar3D({ state = 'idle', onLoadEnd }) {
  const hostRef = useRef(null);
  const stateRef = useRef(state);
  const onLoadEndRef = useRef(onLoadEnd);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    stateRef.current = state;
    onLoadEndRef.current = onLoadEnd;
  }, [state, onLoadEnd]);

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

          const pose = createRig(vrm);
          const frame = frameBust(camera, vrm);
          // Un dt grande anula el suavizado: el primer cuadro no muestra la pose de reposo del archivo.
          pose(stateRef.current, 0, 10);
          const clock = new THREE.Clock();
          animate = () => {
            const dt = Math.min(clock.getDelta(), 0.05);
            pose(stateRef.current, clock.elapsedTime, dt);
            vrm.update(dt);
            renderer.render(scene, camera);
          };
          if (!document.hidden) renderer.setAnimationLoop(animate);
          if (import.meta.env.DEV) window.__violetAvatar = { vrm, camera, frame, renderer, scene };
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
