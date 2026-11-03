/**
 * Packs dist/ into the three files a published Claude artifact can host:
 *
 *   index.html  the page, with the CSS inlined
 *   app.js      the bundle
 *   model.js    the GLB as base64 in `window.__BMW_MODEL__`
 *
 * The model travels inside a script because the artifact host only serves
 * standard web media types and refuses .glb / application/octet-stream;
 * main.js picks the global up, turns it into a blob: URL and hands that to
 * GLTFLoader — the same code path as a fetched file.
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
await writeFile(
  join(out, 'model.js'),
  `window.__BMW_MODEL__=${JSON.stringify((await readFile(new URL('../public/models/bmw-f90.glb', import.meta.url))).toString('base64'))};`,
);

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
<script>window.__NO_SERVICE_WORKER__ = true;</script>
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
console.log(`  model.js    ${await size(join(out, 'model.js'))}`);
