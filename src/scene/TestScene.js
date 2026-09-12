import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  GridHelper,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  AxesHelper,
  SRGBColorSpace,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';
import { QUALITY } from '../vehicleConfig.js';

/** Ground plane, lights, camera, renderer — no physics in this stage. */
export function createTestScene(container, { mobile = false } = {}) {
  const renderer = new WebGLRenderer({ antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? QUALITY.maxPixelRatioMobile : QUALITY.maxPixelRatioDesktop));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x0e1116);
  scene.fog = new Fog(0x0e1116, 60, 400);

  // image-based lighting so car paint and chrome read correctly
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.set(6.5, 2.6, 7.5);
  camera.lookAt(0, 0.8, 0);

  const ambient = new AmbientLight(0xffffff, 0.35);
  ambient.name = 'AmbientLight';
  scene.add(ambient);

  const hemi = new HemisphereLight(0xbfd6ff, 0x2b2b30, 0.45);
  hemi.name = 'HemisphereLight';
  scene.add(hemi);

  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.name = 'DirectionalLight';
  sun.position.set(8, 12, 6);
  sun.castShadow = !mobile || QUALITY.enableShadowsMobile;
  const shadowSize = mobile ? QUALITY.shadowMapSizeMobile : QUALITY.shadowMapSizeDesktop;
  const d = QUALITY.shadowDistance;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  const ground = new Mesh(
    new PlaneGeometry(2000, 2000),
    new MeshStandardMaterial({ color: 0x2c3038, roughness: 0.95, metalness: 0.0 }),
  );
  ground.name = 'GroundPlane';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new GridHelper(2000, 400, 0x3d4450, 0x23272f);
  grid.name = 'GroundGrid';
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);

  // +X red / +Y green / +Z blue — remember: forward is -Z (away from blue)
  const axes = new AxesHelper(3);
  axes.name = 'WorldAxes';
  axes.position.y = 0.01;
  axes.visible = false;
  scene.add(axes);

  // the sun's shadow box follows the car so a small map stays sharp
  const followShadow = (targetPosition) => {
    sun.target.position.copy(targetPosition);
    sun.position.set(targetPosition.x + 8, targetPosition.y + 14, targetPosition.z + 6);
    sun.target.updateMatrixWorld();
  };

  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, sun, ambient, hemi, ground, grid, axes, onResize, followShadow };
}
