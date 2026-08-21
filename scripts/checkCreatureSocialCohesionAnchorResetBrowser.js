#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4195;
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
      const { scatterCreatures, CREATURE_SOCIAL_SPAWN_RADIUS_METERS } = await import('/src/3d/gameplay/creatureSpawner.js');
      const localRadius = CREATURE_SOCIAL_SPAWN_RADIUS_METERS.koyun;
      const sequence = [
        // Sheep 0: canonical world-disc anchor exactly at x=899.
        0, 0, 0,
        // Sheep 1: ten local attempts just beyond the sheep habitat's 900m settlement ceiling.
        ...Array.from({ length: 10 }, () => [0, 0.999999, 0]).flat(),
        // Sheep 2: after anchor reset, canonical world-disc sample at x=895 becomes a new anchor.
        0.5, 0.04, 0,
        // Sheep 3: local member remains attached to the second anchor at about x=899.5.
        0, 0.999999, 0,
      ];
      const controlledMulberry32 = () => {
        let index = 0;
        return () => sequence[index++] ?? 0;
      };
      const scatterOnce = () => scatterCreatures({
        sampleHeightMeters: () => 100,
        seaLevelMeters: 0,
        seats: [{ x: 0, z: 0 }],
        roadEdges: [],
        seed: 123,
        seedTag: 456,
        mulberry32: controlledMulberry32,
        centerX: 899,
        centerZ: 0,
        radiusMeters: 20,
        speciesCounts: { koyun: 4 },
      });

      const first = scatterOnce();
      const second = scatterOnce();
      const deterministic = JSON.stringify(first) === JSON.stringify(second);
      const boundedDrop = first.length === 3;
      const [oldCluster, newAnchor, newClusterMember] = first;
      const firstAnchorPreserved = oldCluster?.socialAnchorX === 899 && oldCluster?.socialAnchorZ === 0;
      const secondAnchorCreated = Math.abs((newAnchor?.socialAnchorX ?? Infinity) - 895) < 1e-6
        && newAnchor?.socialAnchorZ === 0;
      const secondMemberUsesSecondAnchor = newClusterMember?.socialAnchorX === newAnchor?.socialAnchorX
        && newClusterMember?.socialAnchorZ === newAnchor?.socialAnchorZ;
      const oldMemberNotRebound = oldCluster?.socialAnchorX !== newAnchor?.socialAnchorX;
      const localRadiusPreserved = first.every((entry) => entry.socialSpawnRadiusMeters === localRadius);
      const newMemberInsideLocalRadius = Math.hypot(
        newClusterMember.x - newAnchor.socialAnchorX,
        newClusterMember.z - newAnchor.socialAnchorZ,
      ) <= localRadius + 1e-6;
      const allHabitatValid = first.every((entry) => Math.hypot(entry.x, entry.z) <= 900 + 1e-6);
      const rejectedMemberNotLeaked = first.every((entry) => entry.x < 900 + 1e-6);

      return {
        deterministic,
        boundedDrop,
        firstAnchorPreserved,
        secondAnchorCreated,
        secondMemberUsesSecondAnchor,
        oldMemberNotRebound,
        localRadiusPreserved,
        newMemberInsideLocalRadius,
        allHabitatValid,
        rejectedMemberNotLeaked,
        anchors: first.map((entry) => Number(entry.socialAnchorX.toFixed(3))),
        positions: first.map((entry) => Number(entry.x.toFixed(3))),
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const diagnostics = new Set(['anchors', 'positions']);
    const failed = Object.entries(result).filter(([key, value]) => !diagnostics.has(key) && value !== true);
    if (failed.length) throw new Error(`social cohesion anchor reset proof failed: ${JSON.stringify(result)}`);
    console.log('CREATURE_SOCIAL_COHESION_ANCHOR_RESET_BROWSER_PASS', JSON.stringify(result));
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
