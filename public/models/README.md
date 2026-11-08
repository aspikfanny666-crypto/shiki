# public/models

Two cars ship here. Which one is loaded is a user setting; the catalogue that
describes them (dimensions, physics tuning, material patterns, how much the
renderer may restyle them) is `src/cars.js`.

```
public/models/bmw-f90.glb      7.8 MB, glTF binary, 305,984 triangles, 144 meshes
public/models/bmw-m4-cs.glb    7.2 MB, glTF binary, 166,313 triangles,  48 meshes
```

## bmw-f90.glb — BMW M5 CS (F90)

The file in the repo has been through `gltf-transform prune` (it carried a UV
set for 89 materials that have no textures at all) and `weld` (duplicate
vertices merged: 283,444 → 245,822). That is 12.8 MB → 7.8 MB with **exactly
the same 305,984 triangles** and identical measurements — verified by re-running
the import analysis and the driving tests against both files.

**What this file actually is**

| | |
|---|---|
| Title | **BMW M5 CS (F90)** |
| Author | **fvrenbld** — https://sketchfab.com/890244234 |
| License | **CC BY 4.0** — http://creativecommons.org/licenses/by/4.0/ |
| Source | https://sketchfab.com/3d-models/bmw-m5-cs-f90-8f74fb3420e24213aaeea33dc99450a3 |
| Exporter | Sketchfab 17.15.0 (`objcleaner` + `materialmerger` + `gles` pipeline) |

This is **not** the model originally linked in the brief
(`bmw-m5-f90-5478e978bd634337adc8e3dc413fbfa3` by Res1n) — that one could not be
downloaded from this environment, since outbound requests to `sketchfab.com`
are refused by the network policy (HTTP 403 on CONNECT). The file above was
supplied directly instead. CC BY 4.0 requires the attribution above to be kept
wherever the model is used; the debug panel shows it in the UI.

## What the exporter did to the file, and how the loader copes

Sketchfab's export pipeline destroyed all naming and merged geometry:

* **every node is called `Object_2` … `Object_99`** — no "wheel", no "body",
  nothing. Node names carry zero information.
* **the four wheels are fused into shared meshes.** One mesh holds two tyres;
  another holds parts of two more, mixed with brake rotors. There is no wheel
  node to rotate.
* **material names survived** (`Meshestires0011Mtl`, `Steeringwheel0011Mtl`,
  `Miscdash1Mtl`, `Brakelightm1Mtl`, `Bonnet1Mtl`, …) and are the only reliable
  labels in the file.
* the model is authored **Z-up, X-forward, ~3.9 units per metre** (19.26 units
  long), so it needs rotating and scaling.
* there are **no textures at all** (0 images) — 89 plain PBR materials.

The loader therefore:

1. identifies parts by **material name**, falling back to geometry, never by
   inventing node names (`src/model/detectParts.js`);
2. measures the tyre material to locate the four wheel volumes, then **splits
   every wheel out at triangle level** into four rotatable groups
   (`src/model/extractWheels.js`);
3. measures and fixes orientation and scale (`src/model/normalizeModel.js`);
4. prints the whole hierarchy, stats and findings to the console
   (`src/model/reportToConsole.js`).

Anything detection gets wrong can be pinned by hand in
`src/vehicleConfig.js` → `NODE_OVERRIDES`.

## Replacing the model

Drop any other car GLB in as `bmw-f90.glb` and reload. Draco, Meshopt and
KTX2/Basis compression are all supported (decoders are served locally from
`public/draco/` and `public/basis/`, copied out of `three` by
`scripts/copy-decoders.mjs`).

If the file is missing the app still runs: it falls back to a procedural
placeholder car whose every node is prefixed `PLACEHOLDER_`, and the debug panel
shows a red banner so it can never be mistaken for the real model.

---

## bmw-m4-cs.glb — 2025 BMW M4 CS VR46 Edition

| | |
|---|---|
| Title | **2025 BMW M4 CS VR46 Edition** |
| Author | **BMW'S Lost Proxy** — https://sketchfab.com/Bmws_Lost_Proxy |
| License | **CC BY 4.0** — http://creativecommons.org/licenses/by/4.0/ (commercial use allowed) |
| Source | https://sketchfab.com/3d-models/2025-bmw-m4-cs-vr46-edition-3d111a7ed0f544bc9215e3038db4c8dc |
| Exporter | Sketchfab 16.95.0 |

Unlike the M5, this one **keeps its full PBR texture set** — base colour,
metallic-roughness, normal and emissive maps, plus `KHR_materials_transmission`
glass and `KHR_materials_clearcoat` on the spoiler. The head and tail lights
are already lit by the author's emissive map, so the simulator does not add a
light layer to this car and does not touch its materials at all (see
`restyleMaterials: false` and `lightLayer: false` in `src/cars.js`).

### What was done to the file, and why

The download was 20.4 MB with **1,019 separate primitives** — the wheels alone
were 972 `polySurface*` pieces, every one its own draw call. That is the single
thing that would have made this car unusable on a phone. The pipeline run
against it:

```
gltf-transform prune      → drop unused accessors and one unreferenced texture
gltf-transform dedup      → 20.4 MB → 14.5 MB
gltf-transform flatten    → collapse 3,125 wrapper nodes
gltf-transform join       → merge primitives by material: 1,019 → 27
gltf-transform weld       → merge duplicate vertices
gltf-transform webp -q 85 → textures 7.1 MB PNG → 1.2 MB WebP
drop TANGENT, TEXCOORD_1  → three.js derives tangents from the normal map
gltf-transform prune      → 20.4 MB → 7.2 MB
```

**166,313 triangles in and out — not one was removed.** `COLOR_0` was measured
before being considered for removal, found not to be uniform white, and kept.

### What the loader finds in it

Node names are `Object_N` here too, so the same material-name + measured
geometry detection runs. Measured after loading, against the real car:

| | measured | real M4 CS | error |
|---|---|---|---|
| length | 4.794 m | 4.794 m | — (scale normalised to it) |
| height | 1.391 m | 1.393 m | −0.1 % |
| wheelbase | 2.858 m | 2.857 m | +0.04 % |
| front track | 1.598 m | 1.617 m | −1.2 % |
| wheel diameter | 0.674 m | 0.675 m (275/35 R19) | −0.1 % |

The wheelbase and wheel diameter landing within a millimetre of the real car,
from geometry alone, is the check that the wheel split found the right
triangles. One material (`…Wheel1A…Material.032`) covers rim, tyre and hub
together, so `tire` in this car's material patterns matches that name rather
than the word "tyre", which appears nowhere in the file.
