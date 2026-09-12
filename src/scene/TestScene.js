import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  AxesHelper,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { QUALITY_PRESETS } from '../settings.js';

/** Soft radial blob used as a contact shadow under the car. */
function contactShadowTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.78)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new CanvasTexture(c);
}

/** Vertical gradient sky, also used to light the scene through the PMREM. */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#4d7ec4');
  g.addColorStop(0.45, '#93b4d9');
  g.addColorStop(0.52, '#c9d3d8');
  g.addColorStop(0.60, '#5d6a68');
  g.addColorStop(1.0, '#2f3833');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function createTestScene(container, { settings }) {
  const preset = settings.preset;

  const renderer = new WebGLRenderer({
    antialias: preset.antialias,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = settings.get('shadows');
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.fog = new Fog(0x8aa2bb, 120, 700);

  // sky dome (no lighting cost, just a backdrop that matches the fog)
  const sky = new Mesh(
    new SphereGeometry(900, 24, 16),
    new MeshBasicMaterial({ map: skyTexture(), side: BackSide, fog: false, depthWrite: false }),
  );
  sky.name = 'Sky';
  scene.add(sky);

  // image-based lighting: gives the paint and chrome something to reflect
  const pmrem = new PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = settings.get('reflections') ? preset.envIntensity : 0.35;

  const camera = new PerspectiveCamera(52, container.clientWidth / container.clientHeight, 0.15, 1200);
  camera.position.set(6.5, 2.6, 7.5);
  camera.lookAt(0, 0.8, 0);

  const ambient = new AmbientLight(0xffffff, 0.18);
  scene.add(ambient);

  const hemi = new HemisphereLight(0xaecbf0, 0x4a4a3f, 0.75);
  scene.add(hemi);

  const sun = new DirectionalLight(0xfff4e0, 2.6);
  sun.name = 'Sun';
  sun.position.set(28, 42, 18);
  sun.castShadow = settings.get('shadows');
  sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);
  scene.add(sun.target);

  const applyShadowDistance = (d) => {
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.updateProjectionMatrix();
  };
  applyShadowDistance(preset.shadowDistance);

  // contact shadow: cheap, always-on darkening right under the car, which sells
  // the "wheels are touching the ground" read even when shadows are off
  const contact = new Mesh(
    new PlaneGeometry(6.6, 3.6),
    new MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, opacity: 0.9, toneMapped: false }),
  );
  contact.name = 'ContactShadow';
  contact.rotation.x = -Math.PI / 2;
  contact.renderOrder = 2;
  scene.add(contact);

  const axes = new AxesHelper(3);
  axes.name = 'WorldAxes';
  axes.position.y = 0.02;
  axes.visible = false;
  scene.add(axes);

  /** Keeps the shadow frustum and the contact shadow glued to the car. */
  const follow = (position, quaternion) => {
    sun.target.position.copy(position);
    sun.position.set(position.x + 28, position.y + 42, position.z + 18);
    sun.target.updateMatrixWorld();
    contact.position.set(position.x, 0.012, position.z);
    if (quaternion) {
      const yaw = Math.atan2(
        2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z),
        1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
      );
      contact.rotation.z = -yaw;
    }
  };

  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

  /** Re-applies quality/shadow/reflection settings at runtime. */
  const applySettings = () => {
    const p = QUALITY_PRESETS[settings.get('quality')] ?? QUALITY_PRESETS.medium;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    renderer.shadowMap.enabled = settings.get('shadows');
    sun.castShadow = settings.get('shadows');
    if (sun.shadow.map && sun.shadow.map.width !== p.shadowMapSize) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    applyShadowDistance(p.shadowDistance);
    scene.environment = settings.get('reflections') ? envTexture : envTexture;
    scene.environmentIntensity = settings.get('reflections') ? p.envIntensity : 0.35;
    contact.visible = p.contactShadow;
    onResize();
  };

  return { renderer, scene, camera, sun, ambient, hemi, axes, contact, sky, onResize, follow, applySettings };
}
