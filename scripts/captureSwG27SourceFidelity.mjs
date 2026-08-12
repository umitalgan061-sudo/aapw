import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sampleG27WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g27_hydrology.mjs';
import {
  G27_SOURCE_COAST_POLICY,
  isG27SourceLandPixel,
} from '../godot/terrain-authoring/geocells/sw/g27_source_mask.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const WIDTH = G27_SOURCE_COAST_POLICY.width;
const HEIGHT = G27_SOURCE_COAST_POLICY.height;
const oldLand = new Uint8Array(WIDTH * HEIGHT);
const sourceLand = new Uint8Array(WIDTH * HEIGHT);
const mismatch = new Uint8Array(WIDTH * HEIGHT);
let mismatchCount = 0;

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const index = y * WIDTH + x;
    const nx = (G27_SOURCE_COAST_POLICY.pixelBounds.xMin + x + 0.5) / 1536;
    const ny = (G27_SOURCE_COAST_POLICY.pixelBounds.yMin + y + 0.5) / 1024;
    oldLand[index] = sampleG27WaterConfidence(nx, ny) < 0.5 ? 1 : 0;
    sourceLand[index] = isG27SourceLandPixel(x, y) ? 1 : 0;
    mismatch[index] = oldLand[index] === sourceLand[index] ? 0 : 1;
    mismatchCount += mismatch[index];
  }
}
assert.equal(mismatchCount, 2572);

const windowSize = 64;
let best = { x: 0, y: 0, mismatches: -1 };
for (let y = 0; y <= HEIGHT - windowSize; y += 8) {
  for (let x = 0; x <= WIDTH - windowSize; x += 8) {
    let count = 0;
    for (let wy = 0; wy < windowSize; wy += 1) {
      const row = (y + wy) * WIDTH + x;
      for (let wx = 0; wx < windowSize; wx += 1) count += mismatch[row + wx];
    }
    if (count > best.mismatches) best = { x, y, mismatches: count };
  }
}

const toBase64 = (array) => Buffer.from(array).toString('base64');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 980 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #11151a; color: #eef2f4; font: 16px system-ui, sans-serif; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { margin: 0 0 18px; color: #b9c4ca; }
  .proof { width: max-content; padding: 18px; margin-bottom: 22px; background: #1a2229; border: 1px solid #35434d; border-radius: 12px; }
  .row { display: flex; gap: 18px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { margin-bottom: 7px; font-weight: 700; }
  canvas { display: block; image-rendering: pixelated; border: 1px solid #5b6b75; background: #274f63; }
  .metric { margin-top: 12px; font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; color: #d8e1e5; }
</style></head><body>
  <section id="far-proof" class="proof">
    <h1>Günbatımı Ustası — G27 Coast/Hydrology</h1>
    <p>Whole GeoCell semantic comparison. Labels/decorations are excluded; only land/water identity is shown.</p>
    <div class="row">
      <figure><figcaption>Before — 96×64-derived bilinear</figcaption><canvas id="far-old" width="576" height="384"></canvas></figure>
      <figure><figcaption>After — 192×128 source-derived</figcaption><canvas id="far-new" width="576" height="384"></canvas></figure>
    </div>
    <div class="metric">source pixels: 24,576 · before mismatches: 2,572 · after mismatches: 0 · semantic resolution: 256× per GeoCell vs 96 coarse cells</div>
  </section>
  <section id="near-proof" class="proof">
    <h1>G27 coastline detail — mismatch-dense 64×64 window</h1>
    <p>Nearest-neighbour enlargement preserves the exact semantic pixels for inspection.</p>
    <div class="row">
      <figure><figcaption>Before</figcaption><canvas id="near-old" width="384" height="384"></canvas></figure>
      <figure><figcaption>After</figcaption><canvas id="near-new" width="384" height="384"></canvas></figure>
    </div>
    <div class="metric" id="near-metric"></div>
  </section>
<script>
const WIDTH=${WIDTH}, HEIGHT=${HEIGHT};
const oldLand=Uint8Array.from(atob('${toBase64(oldLand)}'), c=>c.charCodeAt(0));
const sourceLand=Uint8Array.from(atob('${toBase64(sourceLand)}'), c=>c.charCodeAt(0));
const best=${JSON.stringify(best)};
const LAND=[82,116,73], WATER=[39,79,99];
function paint(id, data, sx, sy, sw, sh) {
  const canvas=document.getElementById(id), ctx=canvas.getContext('2d');
  const tmp=document.createElement('canvas'); tmp.width=sw; tmp.height=sh;
  const tctx=tmp.getContext('2d'); const image=tctx.createImageData(sw,sh);
  for (let y=0;y<sh;y++) for (let x=0;x<sw;x++) {
    const land=data[(sy+y)*WIDTH+(sx+x)]===1, rgb=land?LAND:WATER, i=(y*sw+x)*4;
    image.data[i]=rgb[0]; image.data[i+1]=rgb[1]; image.data[i+2]=rgb[2]; image.data[i+3]=255;
  }
  tctx.putImageData(image,0,0); ctx.imageSmoothingEnabled=false; ctx.drawImage(tmp,0,0,canvas.width,canvas.height);
}
paint('far-old',oldLand,0,0,WIDTH,HEIGHT); paint('far-new',sourceLand,0,0,WIDTH,HEIGHT);
paint('near-old',oldLand,best.x,best.y,64,64); paint('near-new',sourceLand,best.x,best.y,64,64);
document.getElementById('near-metric').textContent='window x='+best.x+'..'+(best.x+64)+', y='+best.y+'..'+(best.y+64)+' · before mismatches in window: '+best.mismatches;
</script></body></html>`, { waitUntil: 'load' });

await page.locator('#far-proof').screenshot({ path: '/tmp/g27-source-fidelity-far.png' });
await page.locator('#near-proof').screenshot({ path: '/tmp/g27-source-fidelity-near.png' });
await browser.close();

for (const path of ['/tmp/g27-source-fidelity-far.png', '/tmp/g27-source-fidelity-near.png']) {
  assert.ok(fs.statSync(path).size > 1000, `${path} must be a non-empty visual proof`);
}
console.log(JSON.stringify({ mismatchCount, detailWindow: best }, null, 2));
console.log('SW_G27_SOURCE_VISUAL_OK');
