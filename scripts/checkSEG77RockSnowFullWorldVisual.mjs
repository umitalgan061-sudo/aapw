import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import { G77_ROCK_SNOW_POLICY, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
import { sampleReferencePindexQualityV2 } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/se-g77-rock-snow-r9');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77RockSnowFullWorldVisual] ${message}`); };
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const bounds = G77_ROCK_SNOW_POLICY.normalizedBounds;
const width = 480, height = 320;
const pixels = new Uint8ClampedArray(width * height * 4);
const palette = { sea:[35,73,93], lake:[62,113,128], soil:[132,131,78], rock:[112,105,96], snow:[220,227,226] };
let g77Samples = 0, rockSamples = 0, snowSamples = 0, waterSamples = 0;

for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
  const nx = (x + 0.5) / width, ny = (y + 0.5) / height;
  const quality = sampleReferencePindexQualityV2(nx, ny);
  const base = palette[quality.dominantSurface] || palette.soil;
  let r = base[0], g = base[1], b = base[2];
  if (nx >= bounds.xMin && nx <= bounds.xMax && ny >= bounds.yMin && ny <= bounds.yMax) {
    const s = sampleG77RockSnow(nx, ny);
    const rock = s.rockWeight, snow = s.snowWeight;
    r = r * (1 - rock) + 92 * rock; g = g * (1 - rock) + 91 * rock; b = b * (1 - rock) + 88 * rock;
    r = r * (1 - snow) + 232 * snow; g = g * (1 - snow) + 237 * snow; b = b * (1 - snow) + 240 * snow;
    g77Samples += 1; if (rock > 0.001) rockSamples += 1; if (snow > 0.001) snowSamples += 1; if (s.waterConfidence >= 0.5) waterSamples += 1;
  }
  const o = (y * width + x) * 4; pixels[o] = Math.round(r); pixels[o+1] = Math.round(g); pixels[o+2] = Math.round(b); pixels[o+3] = 255;
}
need(g77Samples > 1000, `G77 overlay too sparse: ${g77Samples}`);
need(rockSamples > 100, `G77 rock not visible in full-world proof: ${rockSamples}`);
need(waterSamples > 100, `G77 coast/water context missing: ${waterSamples}`);

const playwright = loadPlaywright(); need(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer(); const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
  await page.evaluate(({ pixels, width, height }) => {
    document.body.innerHTML = '<canvas id="full" width="1200" height="800"></canvas>';
    const low = document.createElement('canvas'); low.width = width; low.height = height;
    const lctx = low.getContext('2d'); const image = lctx.createImageData(width, height); image.data.set(pixels); lctx.putImageData(image, 0, 0);
    const ctx = document.getElementById('full').getContext('2d', { alpha: false }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(low, 0, 0, 1200, 800);
  }, { pixels: Array.from(pixels), width, height });
  const png = await page.locator('#full').screenshot(); need(png.length > 10000, 'full-world PNG too small'); need(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  fs.writeFileSync(path.join(OUT_DIR, 'g77-rock-snow-full-world-topdown.png'), png);
  const metrics = { schema:'se-g77-rock-snow-full-world-r9', sourceMapSha256:G77_ROCK_SNOW_POLICY.sourceMapSha256, sourceRaster:[width,height], output:[1200,800], g77Samples, rockSamples, snowSamples, waterSamples, visibleGeoCellOverlay:false, imageSmoothing:'high', sha256:sha256(png) };
  fs.writeFileSync(path.join(OUT_DIR, 'g77-rock-snow-full-world-metrics.json'), `${JSON.stringify(metrics,null,2)}\n`);
  console.log(`SE_G77_ROCK_SNOW_FULL_WORLD_VISUAL=${JSON.stringify(metrics)}`); console.log('SE_G77_ROCK_SNOW_FULL_WORLD_VISUAL_OK');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
