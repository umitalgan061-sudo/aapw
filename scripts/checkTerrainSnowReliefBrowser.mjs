#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts', 'terrain-snow-relief');
const playwright = devServerHelper.loadPlaywright();
assert(playwright, 'Playwright is required');
fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
try {
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${url}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  const result = await page.evaluate(async () => {
    const mod = await import('/src/3d/world/terrainSnowReliefDirector.js');
    const windward = mod.resolveTerrainSnowRelief({ snowAmount: 0.84, permanentIce: 1, tundra: 1, windwardScour: 0.92, ridgeExposure: 0.88, slopeDegrees: 34, worldX: -240, worldZ: -400, rockWeight: 0.26, screeWeight: 0.17 });
    const lee = mod.resolveTerrainSnowRelief({ snowAmount: 0.84, permanentIce: 1, tundra: 1, leeDeposit: 0.92, concavityHold: 0.88, gentleSlope: 0.92, slopeDegrees: 18, worldX: 240, worldZ: -400, rockWeight: 0.05, screeWeight: 0.04 });
    const cliff = mod.resolveTerrainSnowRelief({ snowAmount: 0.90, permanentIce: 1, tundra: 1, ridgeExposure: 0.84, slopeDegrees: 76, worldX: 0, worldZ: -400, rockWeight: 0.62, screeWeight: 0.48 });
    const field = mod.buildTerrainSnowReliefField({ columns: 9, rows: 7, sample: ({ worldX, worldZ }) => ({ snowAmount: 0.75, permanentIce: worldZ < 0 ? 1 : 0, tundra: 0.8, slopeDegrees: 12 + Math.abs(worldX) / 100, worldX, worldZ }) });
    return {
      windward: { family: windward.dominantFamily, packed: windward.weights.packed, crust: windward.weights.crust },
      lee: { family: lee.dominantFamily, powder: lee.weights.powder, accumulated: lee.weights.accumulated },
      cliff: { rock: cliff.weights.rock, scree: cliff.weights.scree, suppression: cliff.terrain.cliffSuppression },
      fieldCount: field.length,
      unique: new Set(field.map((row) => row.digest)).size,
    };
  });
  assert.equal(result.fieldCount, 63);
  assert(result.unique > 10);
  assert(result.windward.crust > result.lee.powder * 0.5);
  assert(result.lee.powder > 0);
  assert(result.cliff.rock > 0.15);
  assert(result.cliff.suppression > 0.9);
  assert.equal(errors.length, 0, errors.join(' | '));
  fs.writeFileSync(path.join(OUT, 'terrain-snow-relief-browser.json'), `${JSON.stringify(result, null, 2)}\n`);
  await page.screenshot({ path: path.join(OUT, 'terrain-snow-relief-browser.png'), type: 'png' });
  console.log('TERRAIN_SNOW_RELIEF_BROWSER_OK', JSON.stringify(result));
} finally {
  await page.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
