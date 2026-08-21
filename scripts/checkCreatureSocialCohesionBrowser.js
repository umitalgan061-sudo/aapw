#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4193;
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
      const { scatterCreatures } = await import('/src/3d/gameplay/creatureSpawner.js');
      const {
        spawnConfiguredCreatures,
        CREATURE_BEHAVIOR_PROFILES,
        CREATURE_SOCIAL_WANDER_RADIUS_FACTOR,
      } = await import('/src/3d/gameplay/creatureBrain.js');
      const { mulberry32 } = await import('/src/3d/world/terrain.js');

      const sampleHeightMeters = () => 100;
      const groundCollider = { getGroundHeight: () => 100 };
      const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
      const common = {
        sampleHeightMeters,
        seaLevelMeters: 0,
        seats: [{ x: 0, z: 0 }],
        roadEdges: [],
        seed: 0x5c0e2026,
        seedTag: 0x71a5c0,
        mulberry32,
        centerX: 260,
        centerZ: 0,
        radiusMeters: 30,
        speciesCounts: { koyun: 6, geyik: 5, kedi: 3, tavuk: 3 },
      };
      const spawns = scatterCreatures(common);
      const beings = spawnConfiguredCreatures({ spawns, groundCollider, playerCollider, mulberry32 });
      const bySpecies = (speciesId) => beings.filter((being) => being.object3D.name.includes(`-${speciesId}-`));
      const sheep = bySpecies('koyun');
      const deer = bySpecies('geyik');
      const cats = bySpecies('kedi');
      const chickens = bySpecies('tavuk');

      const anchorsFor = (speciesId) => spawns
        .filter((entry) => entry.speciesId === speciesId)
        .map((entry) => `${entry.socialAnchorX},${entry.socialAnchorZ}`);
      const oneSheepAnchor = new Set(anchorsFor('koyun')).size === 1;
      const oneDeerAnchor = new Set(anchorsFor('geyik')).size === 1;
      const socialMetadataPresent = spawns
        .filter((entry) => entry.speciesId === 'koyun' || entry.speciesId === 'geyik')
        .every((entry) => Number.isFinite(entry.socialAnchorX) && Number.isFinite(entry.socialAnchorZ));
      const solitaryMetadataAbsent = spawns
        .filter((entry) => entry.speciesId === 'kedi')
        .every((entry) => entry.socialAnchorX == null && entry.socialAnchorZ == null);

      const sheepTelemetry = sheep.map((being) => being.object3D.userData.creatureSocial);
      const deerTelemetry = deer.map((being) => being.object3D.userData.creatureSocial);
      const catTelemetry = cats.map((being) => being.object3D.userData.creatureSocial);
      const chickenTelemetry = chickens.map((being) => being.object3D.userData.creatureSocial);
      const groundHerdEnabled = [...sheepTelemetry, ...deerTelemetry].every((entry) => entry?.enabled === true);
      const solitaryDisabled = catTelemetry.every((entry) => entry?.enabled === false);
      const flightExcluded = chickenTelemetry.every((entry) => entry?.enabled === false);

      const expectedSheepRadius = Math.min(
        CREATURE_BEHAVIOR_PROFILES.koyun.wanderRadiusMeters,
        CREATURE_BEHAVIOR_PROFILES.koyun.packAlertRadiusMeters * CREATURE_SOCIAL_WANDER_RADIUS_FACTOR,
      );
      const expectedDeerRadius = Math.min(
        CREATURE_BEHAVIOR_PROFILES.geyik.wanderRadiusMeters,
        CREATURE_BEHAVIOR_PROFILES.geyik.packAlertRadiusMeters * CREATURE_SOCIAL_WANDER_RADIUS_FACTOR,
      );
      const radiusTelemetryCorrect = sheepTelemetry.every((entry) => Math.abs(entry.idleWanderRadiusMeters - expectedSheepRadius) < 0.001)
        && deerTelemetry.every((entry) => Math.abs(entry.idleWanderRadiusMeters - expectedDeerRadius) < 0.001);

      const dt = 1 / 30;
      for (let frame = 0; frame < 45 * 30; frame += 1) {
        for (const being of beings) being.update(dt, null, []);
      }

      const maxAnchorDistance = (group) => Math.max(...group.map((being) => {
        const social = being.object3D.userData.creatureSocial;
        return Math.hypot(being.object3D.position.x - social.anchorX, being.object3D.position.z - social.anchorZ);
      }));
      const maxPairDistance = (group) => {
        let max = 0;
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            max = Math.max(max, Math.hypot(
              group[i].object3D.position.x - group[j].object3D.position.x,
              group[i].object3D.position.z - group[j].object3D.position.z,
            ));
          }
        }
        return max;
      };

      const sheepAnchorDistance = maxAnchorDistance(sheep);
      const deerAnchorDistance = maxAnchorDistance(deer);
      const sheepPairDistance = maxPairDistance(sheep);
      const deerPairDistance = maxPairDistance(deer);
      const sheepCalmBounded = sheepAnchorDistance <= expectedSheepRadius + 0.05
        && sheepPairDistance < CREATURE_BEHAVIOR_PROFILES.koyun.packAlertRadiusMeters;
      const deerCalmBounded = deerAnchorDistance <= expectedDeerRadius + 0.05
        && deerPairDistance < CREATURE_BEHAVIOR_PROFILES.geyik.packAlertRadiusMeters;

      const probe = sheep[0];
      const social = probe.object3D.userData.creatureSocial;
      let outwardX = probe.object3D.position.x - social.anchorX;
      let outwardZ = probe.object3D.position.z - social.anchorZ;
      const outwardLength = Math.hypot(outwardX, outwardZ);
      if (outwardLength < 1e-5) {
        outwardX = 1;
        outwardZ = 0;
      } else {
        outwardX /= outwardLength;
        outwardZ /= outwardLength;
      }
      const threat = {
        x: probe.object3D.position.x - outwardX,
        z: probe.object3D.position.z - outwardZ,
      };
      for (let frame = 0; frame < 3 * 30; frame += 1) probe.update(dt, threat, []);
      const threatDistance = Math.hypot(
        probe.object3D.position.x - social.anchorX,
        probe.object3D.position.z - social.anchorZ,
      );
      const threatCanBreakCohesion = threatDistance > expectedSheepRadius + 0.5;

      for (let frame = 0; frame < 45 * 30; frame += 1) probe.update(dt, null, []);
      const recoveryDistance = Math.hypot(
        probe.object3D.position.x - social.anchorX,
        probe.object3D.position.z - social.anchorZ,
      );
      const recoversToSharedAnchor = recoveryDistance <= expectedSheepRadius + 0.05 && probe.isFleeing === false;

      const finitePositions = beings.every((being) => Number.isFinite(being.object3D.position.x)
        && Number.isFinite(being.object3D.position.y)
        && Number.isFinite(being.object3D.position.z));
      beings.forEach((being) => being.dispose());

      return {
        socialMetadataPresent,
        solitaryMetadataAbsent,
        oneSheepAnchor,
        oneDeerAnchor,
        groundHerdEnabled,
        solitaryDisabled,
        flightExcluded,
        radiusTelemetryCorrect,
        sheepCalmBounded,
        deerCalmBounded,
        threatCanBreakCohesion,
        recoversToSharedAnchor,
        finitePositions,
        sheepAnchorDistance: Number(sheepAnchorDistance.toFixed(3)),
        deerAnchorDistance: Number(deerAnchorDistance.toFixed(3)),
        sheepPairDistance: Number(sheepPairDistance.toFixed(3)),
        deerPairDistance: Number(deerPairDistance.toFixed(3)),
        threatDistance: Number(threatDistance.toFixed(3)),
        recoveryDistance: Number(recoveryDistance.toFixed(3)),
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const diagnosticKeys = new Set([
      'sheepAnchorDistance', 'deerAnchorDistance', 'sheepPairDistance', 'deerPairDistance',
      'threatDistance', 'recoveryDistance',
    ]);
    const failed = Object.entries(result).filter(([key, value]) => !diagnosticKeys.has(key) && value !== true);
    if (failed.length) throw new Error(`social fauna cohesion proof failed: ${JSON.stringify(result)}`);
    console.log('CREATURE_SOCIAL_COHESION_BROWSER_PASS', JSON.stringify(result));
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
