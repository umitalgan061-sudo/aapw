#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4191;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripBenignServerNoise(log) {
  return String(log)
    .replace(/^Traceback \(most recent call last\):\s*$/gm, '')
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
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(`console:${message.text()}`); });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');
      class FakeAssetLoader {
        async loadFBXModel() { const group = new THREE.Group(); group.animations = []; return group; }
      }
      const channel = { nextRevision: 1, groups: new Map() };
      // Model a thin deterministic wall around z=-3. LOS samples crossing the wall are displaced,
      // while movement/collision resolution at the stationary sentry position remains unchanged.
      const hearingOccluder = {
        resolveXZ: (x, z) => (z < -2.5 && z > -3.5 ? { x: x + 0.5, z } : { x, z }),
      };
      const npc = await createNPC({
        assetLoader: new FakeAssetLoader(),
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        worldX: 0, worldZ: 0, groundY: 0, rotationYRadians: 0,
        name: 'hearing-guard', displayName: 'Hearing Guard',
        groundCollider: { getGroundHeight: () => 0 },
        playerCollider: hearingOccluder,
        // Keep this proof about hearing/memory rather than allowing investigation movement to carry
        // the guard into close-awareness range, where direct sight is expected to take ownership.
        speedMps: 0, combatStanceTriggerRadiusMeters: 10,
        combatStanceTransitionSeconds: 0.05, perceptionEnabled: true,
        guardAlertChannel: channel, guardAlertGroupId: 'stannis',
        simulationLodEnabled: true, simulationLodNearRadiusMeters: 30,
        simulationLodFarIntervalSeconds: 0.25, simulationLodDistantRadiusMeters: 90,
        simulationLodDistantIntervalSeconds: 1, simulationLodMaxStepSeconds: 0.25,
      });

      const dt = 1 / 60;
      npc.update(dt, { x: 0, z: -6 });
      let heardFrames = 0;
      let maxSuspicion = 0;
      let everChased = false;
      let everCombat = false;
      let everPublished = false;
      let heardInvestigate = false;
      for (let i = 0; i < 36; i += 1) {
        const player = { x: i % 2 === 0 ? 0.22 : -0.22, z: -6 };
        npc.update(dt, player);
        const perception = npc.object3D.userData.npcPerception ?? {};
        if (perception.heard === true) heardFrames += 1;
        if (perception.heard === true && perception.intent === 'investigate' && perception.reason === 'hearing') heardInvestigate = true;
        maxSuspicion = Math.max(maxSuspicion, perception.suspicion ?? 0);
        everChased ||= perception.intent === 'chase';
        everCombat ||= perception.intent === 'combat';
        everPublished ||= channel.groups.has('stannis');
      }

      const stoppedPlayer = { x: 0, z: -6 };
      npc.update(dt, stoppedPlayer);
      npc.update(dt, stoppedPlayer);
      const afterNoise = { ...(npc.object3D.userData.npcPerception ?? {}) };
      const hearingStopped = afterNoise.heard === false;
      const memoryContinuesInvestigation = afterNoise.intent === 'investigate'
        && afterNoise.lastKnown?.z === -6
        && afterNoise.investigationRemaining > 0;

      // speedMps=0 deliberately isolates perception; the authored memory denominator clamps to 0.25,
      // so 30 wall-clock seconds safely covers the <=25.25s hearing investigation horizon.
      let returnFrames = null;
      for (let i = 0; i < 1800; i += 1) {
        npc.update(dt, stoppedPlayer);
        const perception = npc.object3D.userData.npcPerception;
        if (perception?.intent === 'patrol' && perception?.heard === false) {
          returnFrames = i + 1;
          break;
        }
      }
      const noAlertAfterRecovery = channel.groups.size === 0 && channel.nextRevision === 1;
      npc.dispose();

      return {
        hearingActuallyTriggered: heardFrames >= 10,
        heardInvestigate,
        suspicionRaised: maxSuspicion > 0,
        neverChased: !everChased,
        neverCombat: !everCombat,
        neverPublished: !everPublished,
        hearingStopped,
        memoryContinuesInvestigation,
        returnedToPatrol: returnFrames != null,
        returnBounded: returnFrames != null && returnFrames <= 1800,
        noAlertAfterRecovery,
        registryCleanAfterDispose: channel.groups.size === 0,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`guard hearing lifecycle proof failed: ${JSON.stringify(result)}`);
    console.log('NPC_GUARD_HEARING_LIFECYCLE_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close(); await browser.close(); server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
  if (/" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) throw new Error(`static server errors: ${fatalServerLog}`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
