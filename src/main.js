import { Clock, MathUtils, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MODEL_URL } from './config.js';
import { settings } from './settings.js';
import { VEHICLE_TUNING } from './vehicleConfig.js';
import { createTestScene } from './scene/TestScene.js';
import { PhysicsWorld } from './scene/PhysicsWorld.js';
import { Environment } from './scene/Environment.js';
import { CameraRig } from './scene/CameraRig.js';
import { VehicleVisual } from './vehicle/VehicleVisual.js';
import { VehiclePhysics } from './vehicle/VehiclePhysics.js';
import { KinematicVehicle } from './vehicle/KinematicVehicle.js';
import { NullPhysicsWorld } from './scene/NullPhysicsWorld.js';
import { VehicleLights } from './vehicle/VehicleLights.js';
import { Controls } from './input/Controls.js';
import { EngineAudio } from './audio/EngineAudio.js';
import { reportToConsole, buildReportJSON } from './model/reportToConsole.js';
import { DebugPanel } from './ui/DebugPanel.js';
import { Hud } from './ui/Hud.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import './ui/style.css';

const container = document.getElementById('app');
const loader = document.getElementById('boot');
const setBootMessage = (text) => {
  const el = loader?.querySelector('[data-boot-text]');
  if (el) el.textContent = text;
};

const scene3d = createTestScene(container, { settings });
const { renderer, scene, camera, axes } = scene3d;

// ---------------------------------------------------------------- model ----
setBootMessage('loading BMW M5 F90…');
/**
 * The GLB normally comes from public/models. A host that only serves standard
 * web media types (a published artifact) can instead ship it as base64 in a
 * plain script that sets `window.__BMW_MODEL__`; it is decoded here and handed
 * to the loader as bytes.
 */
function embeddedModelBytes() {
  const base64 = window.__BMW_MODEL__;
  if (typeof base64 !== 'string' || base64.length < 1024) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Hand the loader a blob: URL rather than the raw buffer, so the embedded
  // model goes through exactly the same load path as a fetched file.
  return {
    url: URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })),
    buffer: bytes.buffer,
  };
}

// Candidates, so the same bundle works from a dev server, a sub-directory and
// a published page whose URL has no trailing slash.
const embedded = embeddedModelBytes();
const modelSource = embedded
  ? [embedded.url, embedded.buffer]
  : [MODEL_URL, new URL(MODEL_URL, document.baseURI).href, new URL(MODEL_URL, import.meta.url).href, `/${MODEL_URL}`];

const visual = new VehicleVisual();
await visual.load({
  url: modelSource,
  renderer,
  onProgress: (e) => {
    if (e.lengthComputable) setBootMessage(`loading model — ${Math.round((e.loaded / e.total) * 100)}%`);
  },
});
scene.add(visual.root);

// --------------------------------------------------------------- physics ---
// Rapier is WebAssembly. A strict Content-Security-Policy without
// `wasm-unsafe-eval` refuses to instantiate it, so the page falls back to a
// kinematic drive model instead of dying. Everything downstream is identical.
setBootMessage('starting physics…');
let rapierReady = false;
try {
  await RAPIER.init();
  rapierReady = true;
} catch (error) {
  console.warn('Rapier (WebAssembly) could not start — falling back to the kinematic vehicle model.', error);
}

const physicsWorld = rapierReady ? new PhysicsWorld(RAPIER, scene) : new NullPhysicsWorld(scene);
const environment = new Environment(physicsWorld, scene, { quality: settings.get('quality') });

const physics = rapierReady
  ? new VehiclePhysics(RAPIER, physicsWorld.world, visual)
  : new KinematicVehicle(visual);
const lights = new VehicleLights(visual, { settings });
const audio = new EngineAudio({ settings, engine: VEHICLE_TUNING.engine });
const SPAWN = new Vector3(0, rapierReady ? 0.08 : 0, 0);
physics.reset(SPAWN);

// ------------------------------------------------------------- reporting ---
reportToConsole(visual);
console.group(`%c14. ${rapierReady ? 'VehiclePhysics (Rapier)' : 'KinematicVehicle (no WebAssembly here)'}`, 'color:#7dd3fc;font-weight:700');
console.log(physics.describe());
console.log('material upgrades applied:', visual.materialUpgrades);
console.log('steering wheel pivot:', visual.steeringWheel);
console.groupEnd();

// ------------------------------------------------------------------- UI ----
const hud = new Hud(container);
hud.bindSound(() => {
  audio.setEnabled(true);
  settings.set('sound', true);
  audio.resume();
});
if (!rapierReady) hud.setNotice('simplified physics — WebAssembly blocked');
const debugPanel = new DebugPanel(container);
debugPanel.render(visual, physics);
debugPanel.el.hidden = !settings.get('debug');
debugPanel.controls.hidden = !settings.get('debug');

const rig = new CameraRig(camera, renderer.domElement, visual.root, { settings });

const resetCar = () => {
  physics.reset(SPAWN);
  controls.setReverseLatch(false);
  controls.releaseAll();
  lights.setIndicator(0);
  rig.snap();
};

const controls = new Controls(container, {
  settings,
  onReset: resetCar,
  onCamera: () => audio.setCamera(rig.cycleMode()),
  onLights: () => lights.toggleHeadlights(),
  onIndicator: (dir) => lights.setIndicator(lights.state.indicator === dir ? 0 : dir),
  onMute: () => settings.set('sound', !settings.get('sound')),
  onReverse: (on) => physics.requestReverse(on),
});

const settingsPanel = new SettingsPanel(container, settings, {
  credit: visual.credit,
  getAudioStatus: () => audio.diagnose(),
  onAction: (action) => {
    if (action === 'reset-car') resetCar();
  },
});

debugPanel.addButton('Camera (C)', (b) => { b.textContent = `Camera: ${audio.setCamera(rig.cycleMode())}`; });
debugPanel.addButton('Reset car (R)', resetCar);
debugPanel.addButton('Bounds box', () => visual.showBoundsHelper(scene, !(visual.boxHelper?.visible ?? false)));
debugPanel.addButton('World axes', () => { axes.visible = !axes.visible; });

// settings -> systems
settings.subscribe((key) => {
  if (key === 'quality' || key === 'shadows' || key === 'reflections' || key === '*') {
    scene3d.applySettings();
    environment.setQuality(settings.get('quality'));
    environment.setShadows(settings.get('shadows'));
    visual.setShadows(settings.get('shadows'), settings.get('quality'));
  }
  if (key === 'headlightBeams' || key === '*') lights.setBeamsEnabled(settings.get('headlightBeams'));
  if (key === 'steeringSensitivity' || key === '*') physics.steeringSensitivity = settings.get('steeringSensitivity');
  if (key === 'debug' || key === '*') {
    debugPanel.el.hidden = !settings.get('debug');
    debugPanel.controls.hidden = !settings.get('debug');
  }
});
physics.steeringSensitivity = settings.get('steeringSensitivity');
environment.setShadows(settings.get('shadows'));
visual.setShadows(settings.get('shadows'), settings.get('quality'));

// ------------------------------------------------------------ render loop ---
const clock = new Clock();
let fps = 60;
let flippedFor = 0;

loader?.classList.add('done');
setTimeout(() => loader?.remove(), 600);
rig.snap();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = MathUtils.lerp(fps, dt > 0 ? 1 / dt : fps, 0.06);

  const input = controls.sample();
  physics.setInput(input);
  physicsWorld.step(dt, (step) => physics.update(step));
  physics.syncVisual();
  environment.update();

  const t = physics.telemetry;

  lights.update(dt, t);
  audio.update(dt, t);

  // an upside-down car is a stuck car: offer the reset rather than forcing it
  flippedFor = physics.isFlipped && Math.abs(t.speedMps) < 1 ? flippedFor + dt : 0;
  hud.el.classList.toggle('flipped-hint', flippedFor > 2.5);

  scene3d.follow(visual.root.position, visual.root.quaternion);
  rig.update(dt, {
    speedKmh: t.speedKmh,
    throttle: input.throttle,
    brake: input.brake,
    reversing: t.gear === 'R' && t.speedMps < -0.5,
  });

  renderer.render(scene, camera);
  hud.update(t, {
    fps,
    camera: rig.mode,
    headlights: lights.state.headlights,
    soundBlocked: settings.get('sound') && !audio.running,
  });
});

// -------------------------------------------------------------- debugging ---
window.__BMW__ = {
  visual, physics, physicsWorld, environment, lights, controls, settings,
  scene, camera, rig, hud, renderer, RAPIER, rapierReady, audio,
  report: buildReportJSON(visual),
  dumpHierarchy: () => console.log(window.__BMW__.report.tree),
  drive: (throttle = 0, brake = 0, steer = 0, handbrake = false) => {
    controls.touch.throttle = throttle;
    controls.touch.brake = brake;
    controls.touch.steerLeft = steer > 0 ? steer : 0;
    controls.touch.steerRight = steer < 0 ? -steer : 0;
    controls.touch.handbrake = handbrake;
  },
  resetCar,
  /** Deterministic physics run, independent of frame rate — used by the tests. */
  simulate: (seconds, input = {}, sampleEvery = 0.25) => {
    const step = physicsWorld.world.timestep;
    const samples = [];
    physics.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...input });
    for (let i = 0; i < Math.round(seconds / step); i++) {
      physics.update(step);
      physicsWorld.stepOnce();
      const time = (i + 1) * step;
      if (time % sampleEvery < step) {
        const tel = physics.telemetry;
        samples.push({
          t: +time.toFixed(2), kmh: +tel.speedKmh.toFixed(1), gear: tel.gear,
          rpm: Math.round(tel.rpm), onGround: tel.wheelsOnGround,
          x: +physics.body.translation().x.toFixed(2),
          z: +physics.body.translation().z.toFixed(2),
          yaw: +((2 * Math.asin(Math.max(-1, Math.min(1, physics.body.rotation().y))) * 180) / Math.PI).toFixed(1),
        });
      }
    }
    physics.syncVisual();
    return samples;
  },
};
console.log('%cwindow.__BMW__ ready — __BMW__.drive(1) to accelerate, __BMW__.simulate(5,{throttle:1})', 'color:#4ade80');
