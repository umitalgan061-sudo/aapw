#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4192;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        CREATURE_SOCIAL_SPAWN_RADIUS_METERS,
      } = await import('/src/3d/gameplay/creatureSpawner.js');
      const { mulberry32 } = await import('/src/3d/world/terrain.js');

      const sampleHeightMeters = () => 100;
      const seats = [{ x: 0, z: 0 }];
      const common = {
        sampleHeightMeters,
        seaLevelMeters: 0,
        seats,
        roadEdges: [],
        seed: 0x51fa2026,
        seedTag: 0x77aa33,
        mulberry32,
        centerX: 300,
        centerZ: 0,
        radiusMeters: 90,
      };
      const speciesCounts = { koyun: 7, geyik: 6, kedi: 6 };
      const first = scatterCreatures({ ...common, speciesCounts });
      const second = scatterCreatures({ ...common, speciesCounts });

      const bySpecies = (items, speciesId) => items.filter((entry) => entry.speciesId === speciesId);
      const maxAnchorDistance = (items) => {
        const anchor = items[0];
        if (!anchor) return Infinity;
        return Math.max(...items.map((entry) => Math.hypot(entry.x - anchor.x, entry.z - anchor.z)));
      };
      const sheep = bySpecies(first, 'koyun');
      const deer = bySpecies(first, 'geyik');
      const cats = bySpecies(first, 'kedi');
      const sheepRadius = CREATURE_SOCIAL_SPAWN_RADIUS_METERS.koyun;
      const deerRadius = CREATURE_SOCIAL_SPAWN_RADIUS_METERS.geyik;

      // All flat-world placements must remain above water and outside the canonical seat exclusion.
      const physicallyValid = first.every((entry) => sampleHeightMeters(entry.x, entry.z) > 0
        && Math.hypot(entry.x - seats[0].x, entry.z - seats[0].z) > 75);
      const idsUnique = new Set(first.map((entry) => entry.id)).size === first.length;
      const deterministic = JSON.stringify(first) === JSON.stringify(second);
      const socialCountsPreserved = sheep.length === 7 && deer.length === 6;
      const solitaryCountPreserved = cats.length === 6;
      const sheepClustered = maxAnchorDistance(sheep) <= sheepRadius + 1e-6;
      const deerClustered = maxAnchorDistance(deer) <= deerRadius + 1e-6;
      // Solitary cats still use the original world-disc scatter and should not collapse into the
      // much smaller sheep cluster envelope under this fixed deterministic seed.
      const solitaryStillScattered = maxAnchorDistance(cats) > sheepRadius * 3;
      const withinWorldDisc = first.every((entry) => Math.hypot(entry.x - common.centerX, entry.z - common.centerZ)
        <= common.radiusMeters + Math.max(sheepRadius, deerRadius) + 1e-6);

      return {
        deterministic,
        physicallyValid,
        idsUnique,
        socialCountsPreserved,
        solitaryCountPreserved,
        sheepClustered,
        deerClustered,
        solitaryStillScattered,
        withinWorldDisc,
        sheepMaxAnchorDistance: Number(maxAnchorDistance(sheep).toFixed(3)),
        deerMaxAnchorDistance: Number(maxAnchorDistance(deer).toFixed(3)),
        catMaxAnchorDistance: Number(maxAnchorDistance(cats).toFixed(3)),
        total: first.length,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result)
      .filter(([key, value]) => !key.endsWith('Distance') && key !== 'total' && value !== true);
    if (failed.length) throw new Error(`social fauna spawn proof failed: ${JSON.stringify(result)}`);
    console.log('CREATURE_SOCIAL_SPAWN_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close();
    await browser.close();
    server.kill('SIGTERM');
  }

  const fatalServerLog = serverErrors.join('').replace(/BrokenPipeError[^\n]*/g, '').replace(/ConnectionResetError[^\n]*/g, '');
  if (/" [45]\d\d |Traceback|(?:^|\n)\w*(?:Error|Exception):/im.test(fatalServerLog)) {
    throw new Error(`static server errors: ${fatalServerLog}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
