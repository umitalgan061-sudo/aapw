#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4196;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripBenignServerNoise(log) {
  return String(log)
    .replace(/^-+\s*\nException occurred during processing of request from .*?\n[\s\S]*?^-+\s*$/gm, (block) => {
      const browserCloseStack = /socketserver\.py/.test(block)
        && /http\/server\.py/.test(block)
        && /shutil\.py/.test(block)
        && !/" [45]\d\d /.test(block);
      return browserCloseStack ? '' : block;
    })
    .replace(/^BrokenPipeError: \[Errno 32\] Broken pipe\s*$/gm, '')
    .replace(/^ConnectionResetError: \[Errno 104\] Connection reset by peer\s*$/gm, '');
}

function minimumPairDistance(items, speciesA, speciesB) {
  let minimum = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (items[i].speciesId !== speciesA) continue;
    for (let j = 0; j < items.length; j++) {
      if (i === j || items[j].speciesId !== speciesB) continue;
      minimum = Math.min(minimum, Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z));
    }
  }
  return minimum;
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverErrors = [];
  server.stderr.on('data', (chunk) => serverErrors.push(String(chunk)));
  await sleep(700);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console:${message.text()}`);
  });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const {
        scatterCreatures,
        CREATURE_PREDATOR_TERRITORY_RADIUS_METERS,
        CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS,
      } = await import('/src/3d/gameplay/creatureSpawner.js');
      const { mulberry32 } = await import('/src/3d/world/terrain.js');

      const common = {
        sampleHeightMeters: () => 100,
        seaLevelMeters: 0,
        seats: [{ x: 0, z: 0 }],
        roadEdges: [],
        seed: 0x7e221026,
        seedTag: 0x44b9a1,
        mulberry32,
        centerX: 720,
        centerZ: 0,
        radiusMeters: 210,
        speciesCounts: { geyik: 8, ayi: 3, aslan: 3 },
      };

      const first = scatterCreatures(common);
      const second = scatterCreatures(common);
      const bySpecies = (id) => first.filter((entry) => entry.speciesId === id);
      const bears = bySpecies('ayi');
      const lions = bySpecies('aslan');
      const deer = bySpecies('geyik');

      const minDistance = (speciesA, speciesB) => {
        let minimum = Infinity;
        for (let i = 0; i < first.length; i++) {
          if (first[i].speciesId !== speciesA) continue;
          for (let j = 0; j < first.length; j++) {
            if (i === j || first[j].speciesId !== speciesB) continue;
            minimum = Math.min(minimum, Math.hypot(first[i].x - first[j].x, first[i].z - first[j].z));
          }
        }
        return minimum;
      };

      const bearBear = minDistance('ayi', 'ayi');
      const lionLion = minDistance('aslan', 'aslan');
      const bearLion = minDistance('ayi', 'aslan');
      const bearDeer = minDistance('ayi', 'geyik');
      const lionDeer = minDistance('aslan', 'geyik');

      return {
        deterministic: JSON.stringify(first) === JSON.stringify(second),
        countsPreserved: bears.length === 3 && lions.length === 3 && deer.length === 8,
        bearTerritorySeparated: bearBear + 1e-6 >= CREATURE_PREDATOR_TERRITORY_RADIUS_METERS.ayi.ayi,
        lionTerritorySeparated: lionLion + 1e-6 >= CREATURE_PREDATOR_TERRITORY_RADIUS_METERS.aslan.aslan,
        crossPredatorSeparated: bearLion + 1e-6 >= CREATURE_PREDATOR_TERRITORY_RADIUS_METERS.aslan.ayi,
        bearPreyBufferPreserved: bearDeer + 1e-6 >= CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS.ayi.geyik,
        lionPreyBufferPreserved: lionDeer + 1e-6 >= CREATURE_PREDATOR_PREY_SPAWN_BUFFER_METERS.aslan.geyik,
        physicalPlacementPreserved: first.every((entry) => Math.hypot(entry.x, entry.z) > 75),
        bearBearMeters: Number(bearBear.toFixed(3)),
        lionLionMeters: Number(lionLion.toFixed(3)),
        bearLionMeters: Number(bearLion.toFixed(3)),
        bearDeerMeters: Number(bearDeer.toFixed(3)),
        lionDeerMeters: Number(lionDeer.toFixed(3)),
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result)
      .filter(([key, value]) => !key.endsWith('Meters') && value !== true);
    if (failed.length) throw new Error(`predator territory proof failed: ${JSON.stringify(result)}`);
    console.log('CREATURE_PREDATOR_TERRITORY_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close();
    await browser.close();
    server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
  if (/" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) {
    throw new Error(`static server errors: ${fatalServerLog}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
