# BMW M5 F90 / M4 CS / Maybach GLS 600 — browser driving simulator

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
| `F` | Recovery Mode — GLS only |
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
* **REC**, which appears only on a car that actually has a free-driving assist.
  A button for something the car cannot do would be a lie, and the pad has no
  room to spare on a phone.

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

## The three cars

| | BMW M5 CS (F90) | 2025 BMW M4 CS VR46 | Mercedes-Maybach GLS 600 |
|---|---|---|---|
| engine | S63 4.4 twin-turbo **cross-plane V8**, 635 hp / 750 Nm | S58 3.0 twin-turbo **inline six**, 550 hp / 650 Nm | M177 4.0 twin-turbo **cross-plane V8** + EQ Boost, 558 hp / 730 Nm |
| mass | 1825 kg | 1760 kg | 2785 kg |
| gearbox | ZF 8HP, 8 speeds | ZF 8HP51, 8 speeds | 9G-TRONIC, 9 speeds |
| drive | M xDrive | M xDrive | 4MATIC |
| model | 305,984 tris, 144 meshes, **no textures at all** | 166,313 tris, 48 meshes, **full PBR set** | 474,445 tris, 86 meshes, **no textures at all** |
| file | 1.16 MB | 2.08 MB | 1.77 MB |
| measured | 4.966 × 1.43 m, wheelbase 2.963 | 4.794 × 1.391 m, wheelbase 2.858 | 5.054 × 1.813 m, wheelbase 3.058 |
| special | — | — | **Recovery Mode** (air suspension) |

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
periodic waves and hands them to the running oscillators. The GLS shares the
M5's cross-plane spectrum but idles at 700 rpm and stops at 6000, so the same
waveform arrives an octave lower and never gets shrill.

### Why only the M4's materials are left alone

The M5 and the GLS came through exports that threw away every texture — 89 and
63 flat colours respectively. They *need* the material pass (clearcoat on the
paint, matte rubber, polished rims) or they read like clay models. The M4 keeps
base-colour, metallic-roughness, normal and emissive maps, real transmission
glass and clearcoat on the spoiler; restyling that would destroy work that is
already correct, so for that car the material pass is off
(`restyleMaterials: false`), no tread is painted, and its head and tail lights
are left exactly as the author baked them (`lightLayer: false`).

Which name means "paint", "glass" or "rubber" is a property of the model, not
of the renderer: the M5's panels are `bodyshell`, the GLS's are `gls_paint`. So
each car brings its own `restyle` set of patterns.

One exception, and it is a performance one, not a style one: refracting glass
(`KHR_materials_transmission`) makes three.js render the whole scene a second
time into a transmission target every frame. Measured, that was about a
quarter of the frame on its own. So it follows the quality setting like
everything else of that cost — refraction on `high`, ordinary alpha-blended
glass below it, with the authored values kept on the material so switching
back restores them exactly.

### Names lie; geometry does not

Both Sketchfab exports rename every node to `Object_N`, so parts are found by
material name plus measured geometry. The GLS is the sharpest illustration of
why the *measurement* half matters. Its export calls two materials `wheel_42a`
and `wheel_42b` — **neither is a wheel**; `wheel_42b.038` spreads over
1.89 × 1.39 × 4.95 m, the whole car. The real tyre is the one material the
exporter never named, `Scene_-_Root.001`: of all 43 materials it is the only
one forming four separate clusters of 0.29 × 0.81 × 0.81 m, one per corner,
which is a 275/50 R21 to the centimetre.

## Recovery Mode / Bounce Mode — the GLS's free-driving assist

A real feature of the Mercedes-Maybach GLS 600, not a game idea. A GLS with
E-ACTIVE BODY CONTROL pumps its air suspension up and down on the spot, and
that is how it digs itself out of sand: the body rises and drops, each drop
packs the sand under the tyres, each lift unloads them, and with a little
throttle the car walks out of the hole it made.

`F`, or the **REC** button, toggles it. Give it throttle while it rocks.

### Four independent struts

Rapier's ray-cast vehicle already gives each wheel its own spring, damper and
rest length, so this drives the one thing the real car drives — the target
length of each strut:

> `L_target,i(t) = L_base + lift + A · sin(2π f t + φ_i)`

and the solver turns that into `F = k(L₀ − L) − c·v` at each corner, pushing
the body up and the wheel down. **Nothing touches the chassis directly**: no
impulses, no teleports, no velocity writes. It is not a jump button.

| | |
|---|---|
| `L_base` | the car's own 0.38 m, raised 0.055 m for off-road |
| `A`, `f` | 0.075 m at 1.25 Hz |
| `φ_i` | per corner — see the patterns below |
| dampers | `× 0.55` while running |
| droop | `× 1.7` while running |
| force cap | `1.55 ×` the 6,830 N static load each corner carries |
| ramps | 1.5 s in, 1.0 s out |

**Why the amplitude is at the bottom of the useful range.** Body acceleration
in a sinusoidal stroke is `a = ω²A`, and a spring can only produce it by
swinging its force about the car's weight: `a = g·(F/mg − 1)`. At 0.10 m and
1.5 Hz that is 0.72 g, which needs the force to reach 1.72 × static with no
margin at all — and anything past the top throws the car. Measured at those
values: the body swung **0.574 m**, four times the stroke, with all four wheels
off the ground 17 % of the time. 0.075 m at 1.25 Hz asks 0.47 g, a force swing
of 0.53 … 1.47 × static, which sits inside the cap and still gives about 15 cm
of body travel.

**Why there is a governor.** Open-loop numbers cannot be trusted here: the
stroke is deliberately near the body's resonance and the damping is
deliberately low, and resonance does not care what the numbers were chosen to
produce. So amplitude is scaled by a factor pulled down at 2.5/s the moment a
wheel leaves the ground and crept back at 0.35/s while all four are planted. It
is the difference between "these values should keep it down" and "it is kept
down". The `diagonal` pattern is aggressive enough to trip it: measured, the
governor settles it at ×0.26.

### Strut phasing (⚙ → Bounce pattern)

| pattern | φ (FL, FR, RL, RR) | body travel | corner spread | wheels ever off |
|---|---|---|---|---|
| **sync** | 0, 0, 0, 0 | 19.4 cm | 0 | 0.2 % of the time |
| **walk** | 0, 0, π/2, π/2 | 13.8 cm | 10.6 cm | never |
| **diagonal** | 0, π/2, π/2, 0 | 8.1 cm | 6.4 cm | never (governed to ×0.26) |

`sync` lifts the whole body at once, which is what the car does in the adverts.
`walk` offsets the rear axle by a quarter cycle so the car pitches and packs
one axle at a time.

### It has to actually help

An animation that looks like it is helping would be worthless, so the payoff
lives in the tyre model rather than here. `src/scene/Terrain.js` marks circular
patches of loose ground, and `VehiclePhysics.#updateTerrain` gives every wheel
a **sink depth**:

* a loose surface cuts grip outright (sand to 0.40) and adds heavy rolling
  drag (coefficient 0.30 — about 8 kN against 2.8 tonnes, the same order as the
  drive force, so the car bogs rather than blasting through);
* a wheel **digs in** when it is slipping, and it slips when the drivetrain
  asks for more force than the tyre can transmit — a real comparison of drive
  force against `μ · load`, not a proxy;
* a **load peak packs it back down**. Any peak: a kerb, a bump, or this.
  Deliberately not special-cased to Recovery Mode — the assist earns its effect
  through the physics instead of being handed one.

A peak means a load well above what that corner has been carrying *lately*,
measured against a low-pass of its own load, not against its static share. An
earlier version compared against the static share, read the sustained squat
under acceleration as continuous hammering, and packed the sand exactly as fast
as the wheels dug it: `sink` sat at 0.00 for entire runs.

**Measured end to end.** Drive the GLS into the big pit at full throttle and it
digs in over 2.5 s, slowing from 17 km/h to a standstill 13 m in. Then, from
buried, 14 s of full throttle:

| | distance | sink after |
|---|---|---|
| no assist | **1.39 m** — still buried, still on sand | 1.00 |
| assist, `sync` | **102 m** — out, back on tarmac | 0.00 |
| assist, `walk` | **110 m** — out, back on tarmac | 0.00 |

### State machine

Entry needs a gear selected (not P or N) and under 5 km/h, as MBUX does. It
releases itself above 15 km/h, fading out over a second. Hydraulic heat builds
over 75 s of continuous running; at full it stops itself and will not restart
until heat has bled back below 35 %. The HUD bar is that heat, and the four
small bars above it are the four struts, as the car's own screen draws them.

It is stepped by the physics solver, not by the frame: it commands a suspension
position on a timed curve, and driving that from a variable frame time made the
body lurch when the frame rate dropped — at 3 fps the phase advanced a third of
a pump per call.

Only a car whose entry in `src/cars.js` sets `recoveryAssist: true` offers it.
The M5 and the M4 have steel springs, so for them the REC button is not
rendered at all, and it needs the real ray-cast suspension, so it reports
itself unavailable under the no-WebAssembly fallback rather than pretending.

### Sound

`EngineAudio.updateRecovery` adds the hydraulic pump: a band-passed whine whose
pitch and level follow how hard the pump is working — hardest at the extremes
of the stroke, where it is filling or dumping, coasting through the middle —
plus a dull valve clunk at each change of direction, which is the moment the
body stops rising and starts falling.

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

### Sand

Three sand pits, 34 m, 18 m and 12 m across, sit on the open parts of the pad.
They are **not holes in the collision** — the ground stays flat, which is what
keeps the ray-cast vehicle well behaved. What changes is the tyre model: inside
a patch the wheels have 40 % of their grip, rolling drag goes up roughly
fifteen-fold, a spinning wheel digs itself in and a load peak packs it back
down. `src/scene/Terrain.js` holds the patch list and one `surfaceAt(x, z)`
lookup that the physics calls per wheel per step; `Environment` registers the
patches as it draws them, so the geometry and the surface data cannot drift
apart.

This is what Recovery Mode exists for, and the only place in the simulator
where it does anything.

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

## Compression

Every car is **Draco**-compressed. That one change took the three models from
26 MB to 5.0 MB with **no geometry removed at all**:

| | before | after |
|---|---|---|
| BMW M5 CS | 7.81 MB | **1.16 MB** |
| BMW M4 CS | 7.25 MB | **2.08 MB** |
| Maybach GLS 600 | 15.9 MB | **1.77 MB** |

It replaced a worse idea. The GLS first shipped through
`gltf-transform simplify --ratio 0.6`, which took it from 474k to 287k
triangles to fit the size budget — and visibly dented the tailgate and rear
bumper. Draco is six times smaller than that *and* keeps every one of the
474,445 triangles, so the decimation is gone. Verified after the swap: all
three cars report the same triangle count, mesh count, wheelbase, track and
wheel radius as they did uncompressed, with no loader warnings.

`createGLTFLoader` serves the decoder from `public/draco/`, so nothing is
fetched from a CDN. The WebAssembly decoder is the fast one and is what a
normally-hosted build uses; a published single-page build sets
`window.__DRACO_JS_ONLY__` and ships the 512 KB pure-JS decoder instead,
because the artifact host cannot be relied on to serve a `.wasm`.

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
(written by `scripts/build-sw-manifest.mjs` after every build — about 10.5 MB,
all three cars and the Draco decoder included) because the worker only starts controlling the
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
| draw calls | ~224 at medium with the M5, ~174 with the M4, ~141 with the GLS (car + city + environment + shadow pass) |
| model download | 5.0 MB for all three cars, Draco-compressed (26 MB uncompressed) |
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

All three models are **CC BY 4.0**, and the credit for whichever car is loaded is
shown in ⚙ → About.

* "BMW M5 CS (F90)" by **fvrenbld** —
  https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3
* "2025 BMW M4 CS VR46 Edition" by **BMW'S Lost Proxy** —
  https://sketchfab.com/3d-models/2025-bmw-m4-cs-vr46-edition-3d111a7ed0f544bc9215e3038db4c8dc
* "Mersedes- Benz Maybach GLS 600" by **Black Snow** —
  https://sketchfab.com/3d-models/mersedes-benz-maybach-gls-600-34c4687ba8204efaa7551afea9f5689f

See `public/models/README.md` for what each file contains and how it was
processed.
