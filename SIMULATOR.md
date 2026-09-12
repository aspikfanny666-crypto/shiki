# BMW M5 F90 — browser driving simulator

A Three.js + Rapier 3D driving simulator built around a real BMW M5 CS (F90)
glTF model. `npm run dev`, then open http://localhost:5173.

> This repository is primarily the is-a.dev domain registry; the simulator lives
> alongside it in `src/`, `public/` and `index.html` and does not touch
> `domains/`, `util/` or the registry tests (`npm test` still runs those).

## Controls

| Input | Action |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake — and reverse, once stopped (release and press again) |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake (locks the rear axle) |
| `R` | reset the car |
| `C` | camera: follow → hood → orbit |
| touch | on-screen pedals and steering appear automatically on touch devices; the debug panel can force them on for testing |

## Measured behaviour

Numbers below come from the automated physics harness
(`window.__BMW__.simulate()`), not from estimates:

| | simulator | real M5 CS |
|---|---|---|
| 0–100 km/h | 2.9 s | 3.0 s |
| 0–200 km/h | 9.4 s | 10.4 s |
| top speed | 303 km/h | 305 km/h (limited) |
| braking | 1.06 g | ~1.1 g |
| reverse | limited to 40 km/h | — |
| length × width × height | 4.966 × 2.12 × 1.43 m | 4.97 × 2.13 (mirrors) × 1.44 m |
| wheelbase / track | 2.963 m / 1.63 / 1.60 m | 2.98 m / 1.63 / 1.61 m |

## Architecture

```
src/
├── config.js               axis convention (+Y up, -Z forward, +X right), reference dimensions
├── vehicleConfig.js        MANUAL OVERRIDES + all tuning (engine, gearbox, tyres, suspension, quality)
├── main.js                 bootstrap, render loop, window.__BMW__ debug handle
├── model/
│   ├── loadVehicleModel.js GLTFLoader + Draco/Meshopt/KTX2, local decoders
│   ├── analyzeHierarchy.js read-only walk: names, geometry, materials, transforms
│   ├── modelStats.js       triangles/vertices/meshes/materials/textures + optimisation findings
│   ├── normalizeModel.js   measures up/forward/length axes and scale, then fixes them
│   ├── detectParts.js      finds wheels/steering wheel/dashboard/lights/interior — never invents names
│   ├── extractWheels.js    splits the four wheels out of material-merged meshes, triangle by triangle
│   ├── reportToConsole.js  the full console dump
│   └── PlaceholderVehicle.js  fallback car when the GLB is missing
├── vehicle/
│   ├── VehicleVisual.js    the visual car: model transform + wheel pivots. No colliders.
│   ├── VehiclePhysics.js   Rapier rigid body + 4 ray-cast wheels + resistive forces
│   ├── Drivetrain.js       torque curve, 8-speed automatic, engine braking, reverse
│   └── WheelVisualController.js  visual-only wheel rotation/steering (used without physics)
├── scene/
│   ├── TestScene.js        renderer, lights, ground, quality settings
│   ├── PhysicsWorld.js     Rapier world, ground collider, obstacle course
│   └── CameraRig.js        follow / hood / orbit
├── input/Controls.js       keyboard + touch
└── ui/DebugPanel.js        model report panel + live HUD
```

### Visual / physics separation

The GLB is **never** used as a collider. `VehiclePhysics` builds its own bodies
from the measurements `VehicleVisual` took:

* one **cuboid chassis collider** (1.95 × 0.79 × 4.82 m) on a dynamic rigid body
  with explicit mass (1825 kg), inertia and a lowered centre of mass;
* **four ray-cast wheels** with spring/damper suspension, tyre friction and
  per-wheel steering and braking;
* engine torque → gearbox → wheels, plus aerodynamic drag, downforce, rolling
  resistance and engine braking applied to the body.

Each frame the physics drives the visual: body transform → `VehicleVisual.root`,
wheel rotation → the `…WheelSpin` nodes, steering → the `…SteeringPivot` nodes,
suspension travel → the pivot height.

```
VehicleVisual (root, follows the rigid body)
├── ModelTransform → <GLB scene>          (scale + orientation normalisation)
├── FrontLeftSteeringPivot  → FrontLeftWheelSpin  → FrontLeftWheelVisual
├── FrontRightSteeringPivot → FrontRightWheelSpin → FrontRightWheelVisual
├── RearLeftWheelMount      → RearLeftWheelSpin   → RearLeftWheelVisual
└── RearRightWheelMount     → RearRightWheelSpin  → RearRightWheelVisual
```

### Rapier specifics worth knowing

Three behaviours of Rapier's `DynamicRayCastVehicleController` are load-bearing
here and were each found by measurement:

1. suspension rays start **inside** the chassis collider, so the vehicle's own
   colliders must be filtered out of the ray query or the car never touches the
   ground;
2. a wheel's **brake is ignored while an engine force is set** on it, so braking
   and drive torque are mutually exclusive per wheel;
3. user forces (`addForce`) **persist across steps**, so drag and rolling
   resistance are reset every step before being re-applied.

## Mobile

* pixel ratio capped (1.5 on touch devices, 2 otherwise), antialias off on mobile;
* one 1024/2048 shadow map whose shadow camera follows the car, so a small map
  stays sharp; no self-shadowing, no post-processing;
* frustum culling on for every mesh; 151 draw calls, no textures to stream;
* on-screen pedals/steering with `touch-action: none` and pointer events.

## Debugging

`window.__BMW__` exposes everything:

```js
__BMW__.report                 // full JSON: hierarchy, stats, detected parts, warnings
__BMW__.dumpHierarchy()        // the ASCII tree
__BMW__.drive(1, 0, 0.5)       // throttle, brake, steer
__BMW__.simulate(5, {throttle: 1})   // deterministic physics run, returns samples
__BMW__.physics.telemetry      // speed, rpm, gear, wheels on ground, drag…
__BMW__.physics.describe()     // what the physics vehicle is built from
```

## Model attribution

"BMW M5 CS (F90)" by **fvrenbld**, licensed **CC BY 4.0** —
https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3
See `public/models/README.md` for what the file contains and how it is processed.
