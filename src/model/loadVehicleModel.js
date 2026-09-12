import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DECODER_PATHS } from '../config.js';

/**
 * GLTFLoader configured for the compression schemes Sketchfab exports use
 * (Draco, Meshopt, KTX2/Basis). Decoders are served locally from /public,
 * so nothing is fetched from a CDN at runtime.
 */
export function createGLTFLoader(renderer) {
  const loader = new GLTFLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath(DECODER_PATHS.draco);
  loader.setDRACOLoader(draco);

  loader.setMeshoptDecoder(MeshoptDecoder);

  if (renderer) {
    const ktx2 = new KTX2Loader()
      .setTranscoderPath(DECODER_PATHS.ktx2)
      .detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }

  return loader;
}

/**
 * Loads the GLB. Resolves with `{ ok: true, gltf }` or, when the file is
 * simply not there yet, `{ ok: false, reason: 'missing', error }` so the
 * caller can fall back to the placeholder instead of blowing up.
 */
export async function loadVehicleModel(url, { renderer, onProgress } = {}) {
  const loader = createGLTFLoader(renderer);
  const startedAt = performance.now();

  try {
    const gltf = await loader.loadAsync(url, onProgress);
    return {
      ok: true,
      gltf,
      url,
      loadMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    const missing =
      /404|Failed to fetch|NetworkError|Unexpected token|not valid JSON/i.test(
        String(error?.message ?? error),
      );
    return {
      ok: false,
      reason: missing ? 'missing' : 'error',
      url,
      error,
    };
  }
}
