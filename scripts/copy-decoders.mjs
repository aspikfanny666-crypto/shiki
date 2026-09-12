/**
 * Copies the Draco and Basis/KTX2 decoders out of the installed three package
 * into public/, so compressed Sketchfab GLBs decode without any CDN call.
 * Runs automatically before `npm run dev` and `npm run build`.
 */
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const three = resolve(root, 'node_modules/three/examples/jsm/libs');

const jobs = [
  [resolve(three, 'draco/gltf'), resolve(root, 'public/draco')],
  [resolve(three, 'basis'), resolve(root, 'public/basis')],
];

for (const [from, to] of jobs) {
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`decoders: ${from} -> ${to}`);
}
