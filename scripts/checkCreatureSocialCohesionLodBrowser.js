#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4194;
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
      const { spawnConfiguredCreatures, CREATURE_BEHAVIOR_PROFILES } = await import('/src/3d/gameplay/creatureBrain.js');
      const { wrapCreatureWithSimulationLod } = await import('/src/3d/gameplay/creatureSpawner.js');
      const { wrapCreatureWithThreatMemory } = await import('/src/3d/gameplay/livingWorldSpawner.js');
      const { mulberry32 } = await import('/src/3d/world/terrain.js');

      const anchor = Object.freeze({ x: 0, z: 0 });
      const spawns = [
        { id: 'creature-koyun-publisher', speciesId: 'koyun', x: 0, z: 0, socialAnchorX: 0, socialAnchorZ: 0 },
        { id: 'creature-koyun-receiver', speciesId: 'koyun', x: 3.5, z: 0, socialAnchorX: 0, socialAnchorZ: 0 },
        { id: 'creature-koyun-no-relay', speciesId: 'koyun', x: 8.5, z: 0, socialAnchorX: 0, socialAnchorZ: 0 },
      ];
      const groundCollider = { getGroundHeight: () => 0 };
      const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
      const raw = spawnConfiguredCreatures({ spawns, groundCollider, playerCollider, mulberry32 });
      const herdRegistry = new Map();
      const profile = CREATURE_BEHAVIOR_PROFILES.koyun;
      const threatAware = raw.map((creature, index) => wrapCreatureWithThreatMemory(creature, {
        triggerRadiusMeters: profile.reactiveTriggerRadiusMeters,
        reactiveDirection: profile.reactiveDirection,
        memorySeconds: 0.5,
        speciesId: 'koyun',
        packAlertRadiusMeters: profile.packAlertRadiusMeters,
        herdRegistry,
        sourceId: spawns[index].id,
      }));
      const controllers = threatAware.map((creature, index) => wrapCreatureWithSimulationLod(creature, {
        id: spawns[index].id,
        nearRadiusMeters: 4,
        farIntervalSeconds: 0.25,
        distantRadiusMeters: 5.5,
        distantIntervalSeconds: 1,
        maxStepSeconds: 0.25,
      }));
      const [publisher, receiver, noRelay] = controllers;
      const dt = 1 / 60;
      const farPlayer = { x: 100, z: 100 };

      for (let frame = 0; frame < 180; frame += 1) {
        publisher.update(dt, farPlayer);
        receiver.update(dt, farPlayer);
        noRelay.update(dt, farPlayer);
      }
      const receiverTicksBeforeThreat = receiver.object3D.userData.simulationTicks;
      const initiallyDistant = receiver.object3D.userData.simulationLodTier === 'distant'
        && receiver.object3D.userData.simulationSkippedTicks > receiverTicksBeforeThreat;
      const cohesionTelemetrySurvivesWrappers = receiver.object3D.userData.creatureSocial?.enabled === true
        && receiver.object3D.userData.creatureSocial?.anchorX === anchor.x
        && receiver.object3D.userData.creatureSocial?.anchorZ === anchor.z;

      const threatPlayer = { x: -3, z: 0 };
      publisher.update(dt, threatPlayer);
      const publisherThreat = { ...publisher.object3D.userData.creatureThreat };
      const receiverXBefore = receiver.object3D.position.x;
      receiver.update(dt, threatPlayer);
      const receiverThreat = { ...receiver.object3D.userData.creatureThreat };
      const receiverTierDuringThreat = receiver.object3D.userData.simulationLodTier;
      noRelay.update(dt, threatPlayer);
      const noRelayThreat = { ...noRelay.object3D.userData.creatureThreat };

      const publisherDirect = publisherThreat.direct === true && publisherThreat.phase === 'flee';
      const receiverWokeUrgentSameFrame = receiverTierDuringThreat === 'urgent'
        && receiver.object3D.userData.simulationTicks === receiverTicksBeforeThreat + 1;
      const receiverUsedHerdOnly = receiverThreat.direct === false
        && receiverThreat.herd === true
        && receiverThreat.phase === 'herd-flee';
      const receiverMovedAway = receiver.object3D.position.x > receiverXBefore;
      const relayBlocked = noRelayThreat.direct === false && noRelayThreat.herd === false
        && noRelay.object3D.userData.simulationLodTier !== 'urgent';

      let settledFrame = null;
      for (let frame = 0; frame < 240; frame += 1) {
        publisher.update(dt, farPlayer);
        receiver.update(dt, farPlayer);
        noRelay.update(dt, farPlayer);
        const publisherState = publisher.object3D.userData.creatureThreat;
        const receiverState = receiver.object3D.userData.creatureThreat;
        if (publisherState?.direct === false
          && publisherState?.memoryRemainingSeconds === 0
          && receiverState?.herd === false
          && receiver.object3D.userData.simulationLodTier === 'distant') {
          settledFrame = frame + 1;
          break;
        }
      }
      const alarmReleasedBounded = settledFrame != null;
      const ticksBeforeCadenceProbe = receiver.object3D.userData.simulationTicks;
      const skippedBeforeCadenceProbe = receiver.object3D.userData.simulationSkippedTicks;
      for (let frame = 0; frame < 180; frame += 1) receiver.update(dt, farPlayer);
      const cadenceTicks = receiver.object3D.userData.simulationTicks - ticksBeforeCadenceProbe;
      const cadenceSkips = receiver.object3D.userData.simulationSkippedTicks - skippedBeforeCadenceProbe;
      const distantCadenceRestored = receiver.object3D.userData.simulationLodTier === 'distant'
        && cadenceTicks >= 2 && cadenceTicks <= 4
        && cadenceSkips >= 170;
      const noUrgentPin = receiver.object3D.userData.creatureThreat?.herd === false
        && receiver.object3D.userData.creatureThreat?.direct === false;

      controllers.forEach((controller) => controller.dispose());
      const registryCleanAfterDispose = herdRegistry.size === 0;

      return {
        initiallyDistant,
        cohesionTelemetrySurvivesWrappers,
        publisherDirect,
        receiverWokeUrgentSameFrame,
        receiverUsedHerdOnly,
        receiverMovedAway,
        relayBlocked,
        alarmReleasedBounded,
        distantCadenceRestored,
        noUrgentPin,
        registryCleanAfterDispose,
        settledFrame,
        cadenceTicks,
        cadenceSkips,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const diagnostics = new Set(['settledFrame', 'cadenceTicks', 'cadenceSkips']);
    const failed = Object.entries(result).filter(([key, value]) => !diagnostics.has(key) && value !== true);
    if (failed.length) throw new Error(`social cohesion LOD proof failed: ${JSON.stringify(result)}`);
    console.log('CREATURE_SOCIAL_COHESION_LOD_BROWSER_PASS', JSON.stringify(result));
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
