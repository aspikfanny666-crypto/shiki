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
 * Loads the GLB. Accepts one URL or a list of candidates — when the page is
 * hosted somewhere that resolves relative paths differently (a published
 * artifact URL without a trailing slash, for example), the next candidate is
 * tried instead of failing.
 *
 * Resolves with `{ ok: true, gltf }`, or `{ ok: false, reason: 'missing' }` so
 * the caller can fall back to the placeholder instead of blowing up.
 */
export async function loadVehicleModel(url, { renderer, onProgress } = {}) {
  const loader = createGLTFLoader(renderer);
  const startedAt = performance.now();
  const attempts = [];

  const candidates = (Array.isArray(url) ? url : [url]).filter(Boolean);

  for (const candidate of candidates) {
    // A candidate may also be raw bytes — a page that ships the GLB inline
    // instead of fetching it (a published artifact, where only standard web
    // media types are served, embeds it in a script).
    const isBytes = candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate);
    try {
      const gltf = isBytes
        ? await loader.parseAsync(candidate instanceof ArrayBuffer ? candidate : candidate.buffer, '')
        : await loader.loadAsync(candidate, onProgress);
      return {
        ok: true,
        gltf,
        url: isBytes ? 'embedded (parsed)' : candidate,
        attempts,
        loadMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      attempts.push({ url: isBytes ? 'embedded (parsed)' : candidate, error: String(error?.message ?? error).slice(0, 120) });
    }
  }

  const lastError = attempts.at(-1)?.error ?? '';
  const missing = /404|Failed to fetch|NetworkError|Unexpected token|not valid JSON/i.test(lastError);
  return {
    ok: false,
    reason: missing ? 'missing' : 'error',
    url: candidates[0],
    attempts,
    error: lastError,
  };
}
