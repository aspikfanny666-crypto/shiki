/**
 * Writes dist/sw-manifest.json: every file the service worker should have in
 * its cache before the first offline launch.
 *
 * This exists because the service worker only starts controlling the page
 * *after* it activates, which is long after the 7.5 MB model and the main
 * bundle have already been fetched — so relying on runtime caching alone would
 * leave the first visitor with an app that opens offline and then cannot load
 * the car. With a manifest, install() pulls the real file list in one go.
 */
import { readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

// Decoder blobs are fetched only when a model actually needs them; the car in
// this build does not, so they stay out of the precache and are cached at
// runtime if they are ever used.
const SKIP = [/^sw\.js$/, /^sw-manifest\.json$/, /^draco\//, /^basis\//, /\.map$/];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = (await walk(DIST))
  .map((f) => relative(DIST, f).split(sep).join('/'))
  .filter((f) => !SKIP.some((re) => re.test(f)))
  .sort();

let bytes = 0;
for (const f of files) bytes += (await stat(join(DIST, f))).size;

// './' is the start URL; index.html is cached under both so a navigation hits
// either spelling.
const urls = ['./', ...files.map((f) => `./${f}`)];
await writeFile(join(DIST, 'sw-manifest.json'), `${JSON.stringify({ urls }, null, 2)}\n`);

// Stamp the build into the worker so a redeploy invalidates the old cache.
const swPath = join(DIST, 'sw.js');
const hash = files.find((f) => /^assets\/index-.*\.js$/.test(f))?.match(/index-([^.]+)\.js/)?.[1] ?? Date.now();
await writeFile(swPath, (await readFile(swPath, 'utf8')).replace('__BUILD__', String(hash)));

console.log(`sw-manifest: ${urls.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB (cache id ${hash})`);
