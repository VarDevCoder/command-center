// Movimiento de Violet: una pose por estado, más capas que evitan que se vea como un bucle.
// - Resortes por hueso: cada parte llega a destiempo y con un leve rebote.
// - Ruido sin período corto en vez de un seno fijo.
// - Eventos al azar: parpadeos, sacadas de los ojos, cambios de apoyo, suspiros y gestos.
// - Golpes de velocidad para las reacciones (asentir, sorprenderse) sobre los mismos resortes.
import * as THREE from 'three';
import { buildSpeech } from './violetSpeech.js';

const { clamp, smoothstep } = THREE.MathUtils;
const rand = (min, max) => min + Math.random() * (max - min);
const chance = (probability) => Math.random() < probability;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const damp = (current, target, dt, speed) => current + (target - current) * (1 - Math.exp(-speed * dt));
// Tres senos de frecuencias sin relación simple: suave y no se percibe la repetición.
const noise = (t, seed) => (
  Math.sin(t + seed * 12.9) * 0.5 + Math.sin(t * 2.17 + seed * 4.1) * 0.3 + Math.sin(t * 3.93 + seed * 7.7) * 0.2
);

const MAX_STEP = 0.008;
class Spring {
  constructor(omega, zeta) {
    this.omega = omega;
    this.zeta = zeta;
    this.value = 0;
    this.velocity = 0;
  }

  step(target, dt, snap) {
    if (snap) {
      this.value = target;
      this.velocity = 0;
      return this.value;
    }
    const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const acceleration = this.omega ** 2 * (target - this.value) - 2 * this.zeta * this.omega * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}
const springs3 = (omega, zeta) => [new Spring(omega, zeta), new Spring(omega, zeta), new Spring(omega, zeta)];

// [rigidez, amortiguación]. Lo pesado llega despacio y sin rebote; la cabeza y las manos, con algo de rebote.
const BONES = {
  hips: [4.5, 0.95],
  spine: [5.5, 0.85],
  chest: [6.5, 0.8],
  upperChest: [7, 0.78],
  neck: [8.5, 0.7],
  head: [10.5, 0.6],
  leftShoulder: [8, 0.72],
  rightShoulder: [8, 0.72],
  leftHand: [13, 0.5],
  rightHand: [13, 0.5],
};
const MOUTH = ['aa', 'ee', 'ih', 'oh', 'ou'];
const EMOTIONS = ['happy', 'relaxed', 'thinking', 'listening', 'focused', 'smirk', 'surprised'];
const EMOTION_SPEED = 5;
const MOUTH_SPEED = 26;

// Cuánto sigue al puntero en cada estado; pensando o trabajando no le presta atención.
const POINTER_ATTENTION = { idle: 0.75, listening: 0.9, talking: 0.55, greeting: 0.8, thinking: 0, working: 0 };
const POINTER_STALE_SECONDS = 5;
const BLINK_INTERVAL = {
  idle: [2.2, 5.5], listening: [2.8, 6], talking: [1.6, 4], greeting: [2, 4], thinking: [3, 7], working: [3.5, 8],
};
const SACCADE_INTERVAL = {
  idle: [0.9, 3], listening: [1.2, 3.4], talking: [0.8, 2.4], greeting: [1.5, 3], thinking: [0.9, 2.4], working: [0.22, 0.46],
};
const REST_ARM_ANGLE = THREE.MathUtils.degToRad(74);
// Parte del encuadre que la cámara se acerca en cada estado: el saludo necesita lugar para la mano.
export const CAMERA_ZOOM = { greeting: 0, idle: 0.2, talking: 0.22, listening: 0.36, thinking: 0.26, working: 0.36 };
const FILLER_SPEECH = 'Mirá, esto lo vemos enseguida, dame un momento y te cuento qué encontré.';

export function createRig(vrm, { calm = false } = {}) {
  const amount = calm ? 0.35 : 1;
  const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);
  const worldPosition = (name) => vrm.humanoid.getRawBoneNode(name).getWorldPosition(new THREE.Vector3());

  vrm.scene.updateMatrixWorld(true);
  const headRest = worldPosition('head');

  const springs = Object.fromEntries(Object.entries(BONES).map(([name, [omega, zeta]]) => [name, springs3(omega, zeta)]));
  const pose = Object.fromEntries(Object.keys(BONES).map((name) => [name, [0, 0, 0]]));
  const add = (name, x, y, z) => {
    pose[name][0] += x;
    pose[name][1] += y;
    pose[name][2] += z;
  };
  const kick = (name, x, y, z) => {
    springs[name][0].velocity += x * amount;
    springs[name][1].velocity += y * amount;
    springs[name][2].velocity += z * amount;
  };

  // Brazos: el resorte mueve la muñeca y el IK resuelve el resto, así la mano traza un arco natural.
  const createArm = (side) => {
    const sign = side === 'right' ? -1 : 1;
    const shoulder = worldPosition(`${side}UpperArm`);
    const elbowRest = worldPosition(`${side}LowerArm`);
    const wristRest = worldPosition(`${side}Hand`);
    const upperLength = shoulder.distanceTo(elbowRest);
    const lowerLength = elbowRest.distanceTo(wristRest);
    const upperRestDir = elbowRest.clone().sub(shoulder).normalize();
    const lowerRestDir = wristRest.clone().sub(elbowRest).normalize();
    const upperNode = bone(`${side}UpperArm`);
    const lowerNode = bone(`${side}LowerArm`);
    const wristSprings = springs3(8.5, 0.72);
    const poleSprings = springs3(7, 0.9);
    const wrist = new THREE.Vector3();
    const polePoint = new THREE.Vector3();
    const toWrist = new THREE.Vector3();
    const bend = new THREE.Vector3();
    const elbow = new THREE.Vector3();
    const upperDir = new THREE.Vector3();
    const lowerDir = new THREE.Vector3();
    const inverse = new THREE.Quaternion();
    const rest = new THREE.Vector3(
      sign * Math.cos(REST_ARM_ANGLE),
      -Math.sin(REST_ARM_ANGLE),
      0.06,
    ).normalize().multiplyScalar((upperLength + lowerLength) * 0.975).add(shoulder).toArray();

    return {
      sign,
      shoulder,
      rest,
      restPole: [sign * 0.45, -0.1, -1],
      kick(x, y, z) {
        wristSprings[0].velocity += x * amount;
        wristSprings[1].velocity += y * amount;
        wristSprings[2].velocity += z * amount;
      },
      update(target, pole, offset, dt, snap) {
        wrist.set(
          wristSprings[0].step(target[0], dt, snap) + offset[0],
          wristSprings[1].step(target[1], dt, snap) + offset[1],
          wristSprings[2].step(target[2], dt, snap) + offset[2],
        );
        polePoint.set(
          poleSprings[0].step(pole[0], dt, snap),
          poleSprings[1].step(pole[1], dt, snap),
          poleSprings[2].step(pole[2], dt, snap),
        );
        toWrist.subVectors(wrist, shoulder);
        const length = clamp(toWrist.length(), Math.abs(upperLength - lowerLength) + 1e-3, upperLength + lowerLength - 1e-3);
        toWrist.normalize();
        const cos = (upperLength ** 2 + length ** 2 - lowerLength ** 2) / (2 * upperLength * length);
        const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
        bend.copy(polePoint).addScaledVector(toWrist, -polePoint.dot(toWrist)).normalize();
        elbow.copy(toWrist).multiplyScalar(upperLength * cos).addScaledVector(bend, upperLength * sin);
        upperNode.quaternion.setFromUnitVectors(upperRestDir, upperDir.copy(elbow).normalize());
        lowerDir.copy(toWrist).multiplyScalar(length).sub(elbow).normalize();
        inverse.copy(upperNode.quaternion).invert();
        lowerNode.quaternion.setFromUnitVectors(lowerRestDir, lowerDir.applyQuaternion(inverse));
      },
    };
  };
  const arms = { right: createArm('right'), left: createArm('left') };
  const atHead = (x, y, z) => [headRest.x + x, headRest.y + y, headRest.z + z];
  const atShoulder = (side, x, y, z) => {
    const arm = arms[side];
    return [arm.shoulder.x + arm.sign * x, arm.shoulder.y + y, arm.shoulder.z + z];
  };

  const weights = {};
  const setExpression = (name, value, dt, speed) => {
    weights[name] = damp(weights[name] || 0, value, dt, speed);
    vrm.expressionManager.setValue(name, weights[name]);
  };

  let time = 0;
  let current = null;
  let stateTime = 0;
  let firstFrame = true;

  let breathPhase = 0;
  let sighUntil = 0;

  const eye = { x: new Spring(38, 0.85), y: new Spring(38, 0.85) };
  const gaze = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, movedAt: -Infinity };
  let readingStep = 0;

  let nextBlink = rand(1, 3);
  let nextSaccade = 0.5;
  let nextAct = rand(3, 6);
  let nextNod = 0;
  let blinkStart = -1;
  let doubleBlinkAt = 0;

  let lean = 0;
  let headTilt = 0;
  let tiltUntil = 0;
  const pulses = [];
  const pulse = (name, value, seconds) => pulses.push({ name, value: value * (calm ? 0.6 : 1), start: time, seconds });

  let speech = null;
  let speechTime = 0;
  let beatIndex = 0;
  let segmentIndex = 0;
  let gesture = null;
  let gestureUntil = 0;

  const blink = () => {
    blinkStart = time;
    nextBlink = time + rand(...(BLINK_INTERVAL[current] || BLINK_INTERVAL.idle));
    doubleBlinkAt = chance(0.16) ? time + 0.26 : 0;
  };
  // Cierre rápido y apertura más lenta, como un párpado real.
  const blinkAmount = () => {
    if (blinkStart < 0) return 0;
    const t = time - blinkStart;
    if (t < 0.07) return smoothstep(t, 0, 0.07);
    if (t < 0.1) return 1;
    return 1 - smoothstep(t, 0.1, 0.27);
  };

  const lookAt = (x, y) => {
    if (Math.abs(x - gaze.x) + Math.abs(y - gaze.y) > 0.5 && chance(0.55)) blink();
    gaze.x = x;
    gaze.y = y;
  };
  const saccade = () => {
    nextSaccade = time + rand(...(SACCADE_INTERVAL[current] || SACCADE_INTERVAL.idle));
    if (current === 'thinking') {
      lookAt(pick([-0.55, -0.3, 0.3, 0.55]), rand(0.35, 0.6));
    } else if (current === 'working') {
      // Lee: avanza de a saltitos por la línea y vuelve al principio.
      readingStep = (readingStep + 1) % 7;
      lookAt(-0.34 + readingStep * 0.11, -0.22 + rand(-0.02, 0.02));
    } else if (current === 'listening') {
      lookAt(rand(-0.08, 0.08), rand(-0.06, 0.06));
    } else if (chance(current === 'talking' ? 0.22 : 0.28)) {
      lookAt(pick([-1, 1]) * rand(0.3, 0.55), rand(-0.2, 0.25));
    } else {
      lookAt(rand(-0.1, 0.1), rand(-0.07, 0.07));
    }
  };

  const idleAct = () => {
    nextAct = time + rand(4, 10);
    const act = pick(['shift', 'tilt', 'sigh', 'smile', 'glance']);
    if (act === 'shift') {
      lean = lean > 0 ? rand(-1, -0.4) : rand(0.4, 1);
    } else if (act === 'tilt') {
      headTilt = pick([-1, 1]) * rand(0.05, 0.1);
      tiltUntil = time + rand(1.8, 3.6);
    } else if (act === 'sigh') {
      sighUntil = time + 4;
      breathPhase = 0;
      kick('head', -0.12, 0, 0);
    } else if (act === 'smile') {
      pulse(pick(['happy', 'smirk']), rand(0.3, 0.45), rand(1.6, 2.8));
      kick('head', 0.1, 0, pick([-1, 1]) * 0.2);
    } else {
      const side = pick([-1, 1]);
      lookAt(side * rand(0.45, 0.65), rand(-0.1, 0.2));
      kick('neck', 0, side * 0.35, 0);
      nextSaccade = time + rand(0.8, 1.5);
    }
  };

  const enter = (state, previous) => {
    current = state;
    stateTime = 0;
    readingStep = 0;
    nextSaccade = time + rand(0.05, 0.25);
    if (previous !== null && chance(0.7)) blink();
    if (state === 'talking') {
      speechTime = 0;
      beatIndex = 0;
      segmentIndex = 0;
      if (!speech) speech = buildSpeech(FILLER_SPEECH);
      // Toma aire antes de empezar: el pecho sube y se alzan las cejas.
      breathPhase = 0;
      speechTime = -0.22;
      kick('chest', -0.3, 0, 0);
      kick('head', -0.28, 0, 0);
      pulse('surprised', 0.18, 0.5);
      lookAt(0, 0);
    } else if (state === 'thinking') {
      kick('head', -0.25, 0.45, 0.3);
    } else if (state === 'working') {
      kick('head', 0.35, 0, 0);
      kick('spine', 0.14, 0, 0);
    } else if (state === 'listening') {
      kick('head', 0.5, 0, -0.2);
      nextNod = time + rand(1.8, 3.4);
    } else if (state === 'greeting') {
      kick('head', 0.35, 0, -0.35);
      kick('rightShoulder', 0, 0, 0.3);
      pulse('surprised', 0.25, 0.8);
      lookAt(0, 0);
    } else if (state === 'idle') {
      if (previous === 'talking') {
        speech = null;
        sighUntil = time + 3;
        breathPhase = Math.PI;
        pulse('happy', 0.25, 1.8);
        kick('head', 0.18, 0, 0);
      }
      nextAct = time + rand(2.5, 6);
    }
    if (state !== 'talking') gesture = null;
  };

  const talkingGestures = {
    right: [
      { target: () => atShoulder('right', 0.17, -0.09, 0.25), pole: [-0.6, -1, -0.45], hand: [0.1, 0, 0.1] },
      { target: () => atShoulder('right', 0.09, -0.07, 0.27), pole: [-0.7, -1, -0.3], hand: [-0.15, 0, 0.18] },
    ],
    left: [
      { target: () => atShoulder('left', 0.16, -0.09, 0.25), pole: [0.6, -1, -0.45], hand: [0.1, 0, -0.1] },
    ],
  };
  const startGesture = () => {
    if (calm) return;
    const side = chance(0.7) ? 'right' : 'left';
    gesture = { side, ...pick(talkingGestures[side]) };
    gestureUntil = time + rand(1.2, 2.8);
    arms[side].kick(0, 0.5, 0.15);
  };

  const onBeat = (kind) => {
    if (kind === 'stress') {
      kick('head', 0.14 * rand(0.6, 1.3), rand(-0.08, 0.08), 0);
      if (gesture) arms[gesture.side].kick(0, -0.16, 0.05);
    } else if (kind === 'phrase') {
      kick('head', 0.3, pick([-1, 1]) * 0.18, pick([-1, 1]) * 0.12);
      breathPhase = 0;
      if (chance(0.45)) startGesture();
      if (chance(0.4)) lookAt(pick([-1, 1]) * rand(0.2, 0.42), rand(-0.1, 0.18));
      else lookAt(0, 0);
      nextSaccade = time + rand(0.7, 1.5);
    } else if (kind === 'end') {
      kick('head', 0.42, 0, 0);
      breathPhase = 0;
      if (chance(0.6)) blink();
      lookAt(0, 0);
    } else if (kind === 'exclaim') {
      kick('head', -0.32, 0, pick([-1, 1]) * 0.15);
      pulse('happy', 0.45, 1.1);
      pulse('surprised', 0.2, 0.5);
      startGesture();
    } else if (kind === 'ask') {
      headTilt = pick([-1, 1]) * 0.09;
      tiltUntil = time + 1.1;
      pulse('surprised', 0.22, 0.8);
      kick('head', -0.15, 0, 0);
      lookAt(0, 0.05);
    }
  };

  const updateMouth = (dt) => {
    const mouth = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
    if (current === 'talking' && speech) {
      speechTime += dt;
      while (beatIndex < speech.beats.length && speech.beats[beatIndex].at <= speechTime) {
        onBeat(speech.beats[beatIndex].kind);
        beatIndex += 1;
      }
      while (segmentIndex < speech.segments.length && speech.segments[segmentIndex].end <= speechTime) segmentIndex += 1;
      const segment = speech.segments[segmentIndex];
      if (segment && segment.start <= speechTime) mouth[segment.viseme] = segment.amount;
    }
    MOUTH.forEach((name) => setExpression(name, mouth[name], dt, MOUTH_SPEED));
  };

  const updateEmotions = (dt) => {
    const emotion = { happy: 0, relaxed: 0, thinking: 0, listening: 0, focused: 0, smirk: 0, surprised: 0 };
    if (current === 'idle') emotion.happy = 0.14 + noise(time * 0.21, 8) * 0.05;
    else if (current === 'talking') emotion.happy = 0.22;
    else if (current === 'thinking') emotion.thinking = 1;
    else if (current === 'working') emotion.focused = 0.9;
    else if (current === 'listening') {
      emotion.listening = 0.85;
      emotion.happy = 0.1;
    } else if (current === 'greeting') emotion.happy = 0.8;

    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      const { name, value, start, seconds } = pulses[i];
      const age = time - start;
      if (age >= seconds) pulses.splice(i, 1);
      else emotion[name] += value * Math.sin((age / seconds) * Math.PI);
    }
    EMOTIONS.forEach((name) => setExpression(name, clamp(emotion[name], 0, 1), dt, EMOTION_SPEED));
  };

  const updateEyes = (dt, snap) => {
    const fresh = 1 - smoothstep(time - pointer.movedAt, POINTER_STALE_SECONDS, POINTER_STALE_SECONDS + 1.5);
    const attention = calm ? 0 : (POINTER_ATTENTION[current] || 0) * fresh;
    const targetX = clamp(gaze.x + pointer.x * attention * 0.6, -0.7, 0.7);
    const targetY = clamp(gaze.y + pointer.y * attention * 0.45, -0.6, 0.65);
    const x = eye.x.step(targetX, dt, snap);
    const y = eye.y.step(targetY, dt, snap);
    // El VRM mueve los ojos por expresiones; la cabeza sigue la misma mirada con el retraso de sus resortes.
    vrm.expressionManager.setValue('lookLeft', Math.max(x, 0));
    vrm.expressionManager.setValue('lookRight', Math.max(-x, 0));
    vrm.expressionManager.setValue('lookUp', Math.max(y, 0));
    vrm.expressionManager.setValue('lookDown', Math.max(-y, 0));
    add('neck', -targetY * 0.05, targetX * 0.11, 0);
    add('head', -targetY * 0.09, targetX * 0.15, -targetX * 0.02);
    add('upperChest', 0, targetX * 0.025, 0);
  };

  const updateBody = (dt) => {
    // Inhala más rápido de lo que exhala; un suspiro amplía el ciclo.
    const sigh = time < sighUntil ? 2.1 : 1;
    const rate = (current === 'talking' ? 2 : 1.45) * (sigh > 1 ? 0.7 : 1) * (1 + noise(time * 0.13, 3) * 0.12);
    breathPhase += dt * rate;
    const breath = Math.sin(breathPhase + 0.45 * Math.sin(breathPhase)) * sigh * amount;
    add('chest', -breath * 0.014, 0, 0);
    add('upperChest', -breath * 0.018, 0, 0);
    add('neck', breath * 0.008, 0, 0);
    add('leftShoulder', 0, 0, breath * 0.016);
    add('rightShoulder', 0, 0, -breath * 0.016);

    const vivid = (current === 'talking' ? 1.8 : 1) * amount;
    const pace = time * (current === 'talking' ? 1.1 : 0.55);
    add('spine', noise(pace, 1) * 0.01 * vivid, noise(pace, 2) * 0.02 * vivid, noise(pace, 3) * 0.01 * vivid);
    add('chest', 0, noise(pace, 4) * 0.012 * vivid, noise(pace, 5) * 0.008 * vivid);
    add('neck', noise(pace * 1.2, 6) * 0.012 * vivid, noise(pace * 1.1, 7) * 0.016 * vivid, noise(pace * 0.9, 9) * 0.01 * vivid);
    add('head', noise(pace * 1.4, 10) * 0.016 * vivid, noise(pace * 1.3, 11) * 0.022 * vivid, noise(pace * 1.1, 12) * 0.018 * vivid);

    // Cambio de apoyo: la cadera va a un lado y el torso compensa.
    const leanNow = current === 'idle' || current === 'listening' ? lean : lean * 0.4;
    add('hips', 0, 0, leanNow * 0.016 * amount);
    add('spine', 0, 0, -leanNow * 0.026 * amount);
    add('head', 0, 0, leanNow * 0.022 * amount);
    if (time > tiltUntil) headTilt = 0;
    add('head', 0, 0, headTilt * amount);
  };

  const update = (state, dt) => {
    const snap = firstFrame;
    firstFrame = false;
    time += dt;
    stateTime += dt;
    if (state !== current) enter(state, current);
    Object.values(pose).forEach((rotation) => rotation.fill(0));

    if (time >= nextBlink) blink();
    if (doubleBlinkAt && time >= doubleBlinkAt) {
      const keep = nextBlink;
      blink();
      nextBlink = keep;
      doubleBlinkAt = 0;
    }
    if (time >= nextSaccade) saccade();
    if (current === 'idle' && time >= nextAct) idleAct();

    updateBody(dt);
    updateMouth(dt);
    updateEmotions(dt);
    updateEyes(dt, snap);
    vrm.expressionManager.setValue('blink', blinkAmount());

    const right = { target: arms.right.rest, pole: arms.right.restPole, offset: [0, 0, 0] };
    const left = { target: arms.left.rest, pole: arms.left.restPole, offset: [0, 0, 0] };
    add('rightHand', 0.05, 0, 0.05);
    add('leftHand', 0.05, 0, -0.05);

    if (current === 'talking') {
      if (gesture && time > gestureUntil) gesture = null;
      if (gesture) {
        const active = gesture.side === 'right' ? right : left;
        active.target = gesture.target();
        active.pole = gesture.pole;
        add(`${gesture.side}Hand`, ...gesture.hand);
      }
    } else if (current === 'thinking') {
      add('spine', 0.015, 0.03, 0);
      add('neck', 0.03, 0.08, 0.06);
      add('head', 0, 0.05, 0.1);
      right.target = atHead(-0.07, -0.122, 0.145);
      right.pole = [-0.55, -1, -0.1];
      add('rightHand', 0, 0, 0.12);
      add('rightShoulder', 0, 0, -0.05);
      // La mano no queda clavada: acompaña un poco el pensamiento.
      right.offset[1] = noise(time * 0.8, 21) * 0.004 * amount;
    } else if (current === 'working') {
      add('spine', 0.04, 0, 0);
      add('chest', 0.015, 0, 0);
      add('head', 0.07, 0, 0);
    } else if (current === 'listening') {
      add('spine', 0.028, 0, 0);
      add('neck', 0.03, 0, -0.05);
      add('head', 0.04, 0, -0.07);
      if (time >= nextNod) {
        nextNod = time + rand(2.2, 5);
        kick('head', 0.34 * rand(0.7, 1.2), 0, 0);
      }
    } else if (current === 'greeting') {
      // Anticipación corta, alza la mano con rebote, tres o cuatro vaivenes y se apaga.
      const raised = smoothstep(stateTime, 0.05, 0.3);
      const swing = smoothstep(stateTime, 0.45, 0.8) * (1 - smoothstep(stateTime, 3.1, 3.7)) * amount;
      if (raised > 0) {
        right.target = atShoulder('right', 0.14, 0.03, 0.12);
        right.pole = [-0.45, -1, -0.15];
      }
      const wave = Math.sin(stateTime * 9.2);
      right.offset[0] = wave * 0.035 * swing;
      add('rightHand', 0, 0, Math.sin(stateTime * 9.2 - 0.8) * 0.34 * swing);
      add('rightShoulder', 0, 0, -0.1);
      add('upperChest', 0, -0.03, 0.02);
      add('neck', 0, -0.03, -0.05);
      add('head', 0, -0.03, -0.05 - wave * 0.008 * swing);
    }

    arms.right.update(right.target, right.pole, right.offset, dt, snap);
    arms.left.update(left.target, left.pole, left.offset, dt, snap);
    Object.entries(pose).forEach(([name, rotation]) => {
      const node = bone(name);
      if (!node) return;
      node.rotation.set(
        springs[name][0].step(rotation[0], dt, snap),
        springs[name][1].step(rotation[1], dt, snap),
        springs[name][2].step(rotation[2], dt, snap),
      );
    });
  };

  return {
    update,
    // Guion de la respuesta que va a "decir"; si ya está hablando, empieza de nuevo con el texto nuevo.
    say(text) {
      speech = buildSpeech(text);
      speechTime = 0;
      beatIndex = 0;
      segmentIndex = 0;
    },
    // x e y van de -1 a 1 respecto de su cara: derecha y arriba de la pantalla son positivos.
    setPointer(x, y) {
      pointer.x = clamp(x, -1, 1);
      pointer.y = clamp(y, -1, 1);
      pointer.movedAt = time;
    },
  };
}
