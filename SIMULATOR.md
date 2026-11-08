# BMW M5 F90 / M4 CS — browser driving simulator

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
| `C` | camera: chase → close → hood → cockpit → free |
| `L` | headlights (also brings up the city's windows and street lamps) |
| `Z` / `X` | left / right indicator |

On touch devices an on-screen pad appears automatically:

* a **steering wheel** you turn with a finger. The angle is measured around the
  wheel's own centre and accumulated, so you can keep turning past where you
  grabbed it; it is limited to ±135° on screen and springs back to centre at a
  rate fixed in seconds, not frames, so it feels the same at 30 and 120 fps.
  Screen-clockwise is a right turn.
* **pedals** rather than buttons. They ramp in — 170 ms to full throttle,
  110 ms to full brake — so a tap is a blip and a hold is full travel, and the
  fill inside each pedal shows how far in it is.
* a latching **R** for reverse (with the pedals swapped so GAS drives
  backwards), handbrake **P**, plus CAM, RESET, LIGHT and SND.

Settings → Controls switches the wheel back to the old left/right arrows
(**Touch steering: Wheel | Arrows**) and moves the pedals to the left thumb
(**Touch layout**).

Buttons cannot stick, and holding two at once works: every press is tracked by
`pointerId`, so a release clears only the finger that ended — pressing the
wheel never drops the throttle. Losing window focus clears the keyboard only,
because an embedded page can lose focus to its host while a finger is still on
a pedal.

## Camera

Five modes, cycled with `C` or the on-screen CAM button:

| Mode | What it does |
|---|---|
| chase | third person, pulls back and widens the lens with speed |
| close | tighter and lower, for a stronger sense of speed |
| hood | on the bonnet, looking down the road |
| cockpit | driver's eye, behind the real steering wheel |
| free | orbit/debug camera (drag to look, wheel to zoom) |

The chase cameras smooth position and aim with a frame-rate independent
exponential, lean under acceleration and dive under braking (driven by the
*measured* acceleration, so a collision moves the camera too), swing round when
reversing, clamp their offset so they can never end up inside the car or under
the road, and pull back further on a portrait phone screen.

## Settings

The ⚙ panel (persisted in `localStorage`): the car, graphics quality (low /
medium / high), shadows, reflections, headlight beams, camera follow sensitivity,
steering sensitivity, touch layout (pedals left or right), touch steering
(wheel or arrows), debug panel, plus install-as-an-app, reset-car,
restore-defaults and the model attribution.

## The two cars

| | BMW M5 CS (F90) | 2025 BMW M4 CS VR46 Edition |
|---|---|---|
| engine | S63 4.4 twin-turbo **cross-plane V8**, 635 hp / 750 Nm | S58 3.0 twin-turbo **inline six**, 550 hp / 650 Nm |
| mass | 1825 kg | 1760 kg |
| drive | M xDrive | M xDrive |
| model | 305,984 tris, 144 meshes, **no textures at all** | 166,313 tris, 48 meshes, **full PBR set** |
| measured | 4.966 × 1.43 m, wheelbase 2.963 | 4.794 × 1.391 m, wheelbase 2.858 |

Switching is a setting (⚙ → Car), not a page reload. `swapCar()` in `main.js`
takes the old chassis out of the Rapier world, disposes its geometries,
materials and textures, loads the new GLB, rebuilds the physics and re-points
the camera. The **AudioContext is deliberately kept**: it is already unlocked,
and making the player tap for sound again after changing car would be a poor
trade for a spectrum that can be swapped in place.

Everything that differs lives in `src/cars.js`; `src/vehicleConfig.js` holds
whichever is selected and re-exports it as **live bindings**, so the rest of
the code still imports `VEHICLE_TUNING` / `MATERIAL_PATTERNS` as before. Read
those inside functions, never into a module-level `const` at import time, or
you capture the first car for the life of the page.

### Why they sound different

Not a filter setting — the firing pattern. A cross-plane V8 fires four times
per cycle, so engine order 4 dominates, and because the two banks fire
unevenly there is real energy on the **half orders**. That half-order content
*is* the V8 burble. An inline six fires three times per revolution, perfectly
evenly: order 3 dominates and the odd harmonics all but vanish, which is why a
straight six howls instead of burbling. `SPECTRA` in `src/audio/EngineAudio.js`
holds one cruise/load pair per layout, and `setEngine()` rebuilds the two
periodic waves and hands them to the running oscillators.

### Why the M4's materials are left alone

The M5 came through Sketchfab's `materialmerger`, which threw away every
texture and left 89 flat colours — it *needs* the material pass (clearcoat on
the paint, matte rubber, polished rims) and a generated tyre tread or it reads
like a clay model. The M4 keeps base-colour, metallic-roughness, normal and
emissive maps, real transmission glass and clearcoat on the spoiler.
Restyling that would destroy work that is already correct, so for this car the
material pass is off (`restyleMaterials: false`), no tread is painted, and its
head and tail lights are left exactly as the author baked them
(`lightLayer: false` — `VehicleLights` keeps its state and the HUD lamp, it
just draws nothing of its own).

One exception, and it is a performance one, not a style one: refracting glass
(`KHR_materials_transmission`) makes three.js render the whole scene a second
time into a transmission target every frame. Measured, that was about a
quarter of the frame on its own. So it follows the quality setting like
everything else of that cost — refraction on `high`, ordinary alpha-blended
glass below it, with the authored values kept on the material so switching
back restores them exactly.

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

### Lights

The GLB's headlights are merged into the body meshes and cannot be lit by
changing a material, so `VehicleLights` adds a thin **light layer** (emissive
lens quads plus glow sprites, positioned from the measured bounding box) as
children of the vehicle root — the GLB geometry is never modified. Where the
export did keep a usable material (`Brakelightm1Mtl` for the centre brake
light, `Indicatorrf1Mtl` for the indicator) that material's emissive is driven
directly. Headlights, DRLs, brake lights, reverse lights and blinking
indicators are all wired to the telemetry. Real spot-light beams are available
behind a setting (off by default).

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

## Environment

A 240 m asphalt pad with painted markings (dashed lanes, a start box, a skid
pad, braking markers) baked into a single canvas texture, red/white kerbs and
barrier posts as instanced meshes, Armco runs, concrete walls, two ramps, two
speed bumps and twenty knock-over cones — the cones are one InstancedMesh
driven by twenty dynamic cylinder bodies. Collision geometry is cuboids and
cylinders only.

### The city (`src/scene/City.js`)

The pad is open on three sides and the streets around it are drivable. The city
is generated from a seeded PRNG, so it is identical on every load and the
collision boxes always match what is drawn:

* **Facades** are painted canvases: window bays, recessed reveals, mullions,
  floor slabs, dark glass with a sky gradient, and a share of rooms lit from
  inside (some with a half-drawn blind). A second canvas holds *only* the lit
  windows and is used as the emissive map, so a window glows without the
  concrete glowing with it. `L` (headlights) raises that emissive level and the
  street lamps with it.
* **Buildings** come in five size classes — low block, mid block, slab, tower,
  glass tower — and each class is one `InstancedMesh`, so ~135 buildings are
  about ten draw calls. Per-instance colour gives each one its own shade, and
  the height is scaled by whole storeys so the windows stay square. Each gets a
  parapet and a roof plant room, because a perfectly sharp lid is what makes a
  box city look like boxes.
* **Streets** are one tiling ground texture whose tile is exactly one 64 m
  block: carriageway, kerb line, dashed centre line, pavement and the yard
  behind it. Because the tile *is* the block, the road grid lines up with the
  buildings for free.
* **Collision**: every building hands back a primitive cuboid. As everywhere
  else in this project, no mesh is ever used as a collider.

Side-face UVs are squeezed by `depth / width` so a window is the same size on
the narrow side of a building as on the wide one.

## Install it on a phone

The build is a PWA, so it can live on a home screen and run with no network at
all.

* **Android / desktop Chrome, Edge**: Settings → Install → **Install app**
  (the button only appears when the browser offers `beforeinstallprompt`).
* **iPhone / iPad**: Safari only — **Share → Add to Home Screen → Add**. iOS
  has no install event, so Settings → Install shows those steps instead of a
  button that could not work. Chrome and Firefox on iOS cannot add web apps to
  the home screen.

`public/sw.js` is the service worker. It pre-caches from `dist/sw-manifest.json`
(written by `scripts/build-sw-manifest.mjs` after every build — about 13 MB,
the 7.5 MB car model included) because the worker only starts controlling the
page *after* it activates, by which time the model has already been fetched;
runtime caching alone would leave a first visitor with an app that opens offline
and then cannot load the car. Navigations are network-first so a redeploy is
picked up while online; everything else is cache-first, which is exactly right
for content-hashed file names. The cache id is stamped with the main bundle's
hash at build time, so a new deploy drops the old cache.

Nothing of this runs in an embedded frame (a published artifact, an `<iframe>`
preview): a service worker registered from a sandboxed frame is useless, and an
app cannot be installed from inside someone else's page. Settings → Install
says so rather than offering a dead button.

`.github/workflows/simulator-pages.yml` builds and deploys `dist/` to GitHub
Pages on every push to `main` that touches the simulator. One-time repository
setup: **Settings → Pages → Source: GitHub Actions**.

## Performance

| | |
|---|---|
| draw calls | ~224 at medium with the M5, ~174 with the M4 (car + city + environment + shadow pass) |
| triangles per frame | ~350k at medium with the M5 (car is 306k), ~390k with the M4 (car is 166k, but its glass costs a transmission pass at `high`) |
| shadows | one blob contact shadow always; the sun shadow casts from a **box proxy** at low/medium (12 triangles) and from the 47 large panels at high |
| pixel ratio | capped at 1.0 / 1.5 / 2.0 by quality preset |
| textures | none in the model; asphalt, markings, streets and every facade are generated canvases |
| city density | 55 % of plots at low quality, 80 % at medium, 100 % at high; street lamps are dropped at low |
| physics | fixed 60 Hz step with an accumulator, max 5 substeps per frame |
| post-processing | none |

The shadow proxy is the single biggest saving: casting from every body panel
pushes ~250k triangles through the shadow pass every frame, which is what makes
a 300k-triangle car expensive on a phone.

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

## Publishing it as a single page

`npm run build` produces `dist/` with relative asset paths, so it can be hosted
from any sub-directory. For hosts that only serve standard web media types (a
published Claude artifact, for instance) the GLB can travel inside a script
instead of being fetched:

```bash
npm run build
node scripts/build-artifact.mjs out/
```

That writes `index.html` (CSS inlined), `app.js`, and one script per car with
its GLB as base64 in that car's embed global. `main.js` picks the global up,
turns it into a `blob:` URL and hands that to the loader — the same code path
as a fetched file.

Only the default car is a `<script>` in the page. The others are listed in
`window.__BMW_EMBED_SCRIPTS__` and injected the first time somebody actually
switches to one, so opening the page costs one model, not twenty megabytes of
them.

If WebAssembly is refused by the host's Content-Security-Policy (no
`wasm-unsafe-eval`), Rapier cannot start; the page then runs `KinematicVehicle`
instead — the same drivetrain and steering law, integrated as a bicycle model,
with no collisions or suspension travel — and the HUD says so.

## Model attribution

Both models are **CC BY 4.0**, and the credit for whichever car is loaded is
shown in ⚙ → About.

* "BMW M5 CS (F90)" by **fvrenbld** —
  https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3
* "2025 BMW M4 CS VR46 Edition" by **BMW'S Lost Proxy** —
  https://sketchfab.com/3d-models/2025-bmw-m4-cs-vr46-edition-3d111a7ed0f544bc9215e3038db4c8dc

See `public/models/README.md` for what each file contains and how it was
processed.
