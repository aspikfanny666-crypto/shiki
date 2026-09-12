import { Clock, MathUtils, Vector3 } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { MODEL_URL } from './config.js';
import { QUALITY } from './vehicleConfig.js';
import { createTestScene } from './scene/TestScene.js';
import { PhysicsWorld } from './scene/PhysicsWorld.js';
import { CameraRig } from './scene/CameraRig.js';
import { VehicleVisual } from './vehicle/VehicleVisual.js';
import { VehiclePhysics } from './vehicle/VehiclePhysics.js';
import { Controls } from './input/Controls.js';
import { reportToConsole, buildReportJSON } from './model/reportToConsole.js';
import { DebugPanel } from './ui/DebugPanel.js';
import './ui/style.css';

const container = document.getElementById('app');
const isMobile = matchMedia('(hover: none), (pointer: coarse)').matches;
const { renderer, scene, camera, axes, followShadow } = createTestScene(container, { mobile: isMobile });

const panel = new DebugPanel(container);
panel.renderLoading(`loading ${MODEL_URL} …`);

// ---------------------------------------------------------------- model ----
const visual = new VehicleVisual();
await visual.load({
  url: MODEL_URL,
  renderer,
  onProgress: (e) => {
    if (e.lengthComputable) panel.renderLoading(`loading model — ${Math.round((e.loaded / e.total) * 100)}%`);
  },
});
scene.add(visual.root);

// --------------------------------------------------------------- physics ---
panel.renderLoading('starting physics…');
await RAPIER.init();
const physicsWorld = new PhysicsWorld(RAPIER, scene);
physicsWorld.buildTestCourse();

const physics = new VehiclePhysics(RAPIER, physicsWorld.world, visual);
physics.reset(new Vector3(0, 0.08, 0));
physics.syncVisual();

// ------------------------------------------------------------- reporting ---
reportToConsole(visual);
console.group('%c14. VehiclePhysics (Rapier)', 'color:#7dd3fc;font-weight:700');
console.log(physics.describe());
console.groupEnd();

panel.render(visual, physics);
// the report panel eats the screen on a phone — start it folded, tap the title to open
if (isMobile) panel.toggle();

// ----------------------------------------------------------- interaction ---
const rig = new CameraRig(camera, renderer.domElement, visual.root);
const controls = new Controls(container, {
  onReset: () => physics.reset(new Vector3(0, 0.08, 0)),
  onCamera: () => rig.cycleMode(),
});

panel.addButton('Camera (C)', (b) => { b.textContent = `Camera: ${rig.cycleMode()}`; });
panel.addButton('Reset car (R)', () => physics.reset(new Vector3(0, 0.08, 0)));
panel.addButton('Touch controls', (b) => {
  const on = controls.setTouchPadVisible(!controls.touchPadVisible);
  b.textContent = on ? 'Touch controls: on' : 'Touch controls';
});
panel.addButton('Bounds box', () => visual.showBoundsHelper(scene, !(visual.boxHelper?.visible ?? false)));
panel.addButton('World axes', () => { axes.visible = !axes.visible; });

// ------------------------------------------------------------ render loop ---
const clock = new Clock();
let fps = 60;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  fps = MathUtils.lerp(fps, dt > 0 ? 1 / dt : fps, 0.08);

  const input = controls.sample();
  physics.setInput(input);

  physicsWorld.step(dt, (step) => physics.update(step));
  physics.syncVisual();
  physicsWorld.syncObstacles();

  const t = physics.telemetry;
  followShadow(visual.root.position);
  rig.update(dt, t.speedKmh);
  renderer.render(scene, camera);
  panel.renderHud(t, { fps, camera: rig.mode });
});

// -------------------------------------------------------------- debugging ---
window.__BMW__ = {
  visual,
  physics,
  physicsWorld,
  controls,
  scene,
  camera,
  rig,
  RAPIER,
  report: buildReportJSON(visual),
  dumpHierarchy: () => console.log(window.__BMW__.report.tree),
  /** headless/manual driving helper: drive(1, 0, 0) for full throttle */
  drive: (throttle = 0, brake = 0, steer = 0, handbrake = false) => {
    controls.touch.throttle = throttle;
    controls.touch.brake = brake;
    controls.touch.steer = steer;
    controls.touch.handbrake = handbrake;
  },
  /**
   * Steps the physics at a fixed rate without waiting for frames — used by the
   * automated driving tests so results do not depend on render speed.
   * @returns {Array<{t:number, kmh:number, gear:string, rpm:number, onGround:number, z:number}>}
   */
  simulate: (seconds, input = {}, sampleEvery = 0.25) => {
    const step = physicsWorld.world.timestep;
    const samples = [];
    physics.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false, ...input });
    for (let i = 0; i < Math.round(seconds / step); i++) {
      physics.update(step);
      physicsWorld.world.step();
      const t = (i + 1) * step;
      if (t % sampleEvery < step) {
        const tel = physics.telemetry;
        samples.push({
          t: +t.toFixed(2), kmh: +tel.speedKmh.toFixed(1), gear: tel.gear,
          rpm: Math.round(tel.rpm), onGround: tel.wheelsOnGround,
          z: +physics.body.translation().z.toFixed(2),
          yaw: +((2 * Math.asin(Math.max(-1, Math.min(1, physics.body.rotation().y))) * 180) / Math.PI).toFixed(1),
          x: +physics.body.translation().x.toFixed(2),
        });
      }
    }
    physics.syncVisual();
    return samples;
  },
};
console.log('%cwindow.__BMW__ ready — try __BMW__.drive(1) then __BMW__.physics.telemetry', 'color:#4ade80');
