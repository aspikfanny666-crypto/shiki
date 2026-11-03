# public/models

## bmw-f90.glb — the vehicle model the simulator loads

```
public/models/bmw-f90.glb      7.8 MB, glTF binary, 305,984 triangles
```

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
