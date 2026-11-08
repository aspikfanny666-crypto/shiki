/**
 * Packs dist/ into the files a published Claude artifact can host:
 *
 *   index.html   the page, with the CSS inlined
 *   app.js       the bundle
 *   model.js     the first car's GLB as base64 in its embed global
 *   model-*.js   one per extra car, fetched only when somebody switches to it
 *
 * A model travels inside a script because the artifact host only serves
 * standard web media types and refuses .glb / application/octet-stream;
 * main.js picks the global up, turns it into a blob: URL and hands that to
 * GLTFLoader — the same code path as a fetched file. Only the default car is
 * a <script> in the page: the rest are listed in `window.__BMW_EMBED_SCRIPTS__`
 * and injected on demand, so opening the page does not cost 20 MB.
 *
 * Usage: node scripts/build-artifact.mjs <output-directory>
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/build-artifact.mjs <output-directory>');
  process.exit(1);
}
const DIST = new URL('../dist/', import.meta.url).pathname;
const assets = await readdir(join(DIST, 'assets'));
const js = assets.find((f) => /^index-.*\.js$/.test(f));
const css = assets.find((f) => /^index-.*\.css$/.test(f));
if (!js || !css) throw new Error('run `npm run build` first');

const html = await readFile(join(DIST, 'index.html'), 'utf8');
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'BMW M5 F90 Simulator';

await mkdir(out, { recursive: true });
await writeFile(join(out, 'app.js'), await readFile(join(DIST, 'assets', js)));

const { CARS, DEFAULT_CAR_ID } = await import('../src/cars.js');
const lazy = {};
for (const car of Object.values(CARS)) {
  const file = car.id === DEFAULT_CAR_ID ? 'model.js' : `model-${car.id}.js`;
  const glb = await readFile(new URL(`../public/${car.modelUrl}`, import.meta.url));
  await writeFile(join(out, file), `window.${car.embedGlobal}=${JSON.stringify(glb.toString('base64'))};`);
  if (car.id !== DEFAULT_CAR_ID) lazy[car.id] = file;
  console.log(`  ${file.padEnd(16)} ${(glb.length / 1024 / 1024).toFixed(1)} MB of GLB → base64`);
}

// The artifact is one page in someone else's frame: no manifest, no service
// worker (both are useless there), and the boot text says so.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0e12">
<title>${title}</title>
<style>
${await readFile(join(DIST, 'assets', css), 'utf8')}
</style>
</head>
<body>
<script>
window.__NO_SERVICE_WORKER__ = true;
window.__BMW_EMBED_SCRIPTS__ = ${JSON.stringify(lazy)};
</script>
<div id="app"></div>
<div id="boot">
  <div class="mark">BMW M5 F90</div>
  <div class="bar"><i></i></div>
  <div class="sub" data-boot-text>loading the car…</div>
</div>
<script src="model.js"></script>
<script type="module" src="app.js"></script>
</body>
</html>
`;
await writeFile(join(out, 'index.html'), page);

const size = (p) => readFile(p).then((b) => `${(b.length / 1024 / 1024).toFixed(1)} MB`);
console.log(`artifact bundle in ${out}`);
console.log(`  index.html  ${(page.length / 1024).toFixed(0)} kB`);
console.log(`  app.js      ${await size(join(out, 'app.js'))}`);
for (const car of Object.values(CARS)) {
  const file = car.id === DEFAULT_CAR_ID ? 'model.js' : `model-${car.id}.js`;
  console.log(`  ${file.padEnd(16)}${await size(join(out, file))}${car.id === DEFAULT_CAR_ID ? '' : '  (lazy)'}`);
}
