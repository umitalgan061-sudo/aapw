#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4187;
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
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console:${message.text()}`);
  });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');

      class FakeAssetLoader {
        async loadFBXModel() {
          const group = new THREE.Group();
          group.animations = [];
          return group;
        }
      }

      const groundCollider = { getGroundHeight: () => 0 };
      const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
      const guardAlertChannel = { nextRevision: 1, groups: new Map() };
      const npc = await createNPC({
        assetLoader: new FakeAssetLoader(),
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        walkAnimationUrl: '/assets/animations/peasant_girl/walking.fbx',
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        rotationYRadians: 0,
        name: 'lifecycle-guard',
        displayName: 'Lifecycle Guard',
        groundCollider,
        playerCollider,
        patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: 6 }],
        speedMps: 2,
        pauseSeconds: 0.1,
        turnRateRadiansPerSecond: 8,
        combatStanceTriggerRadiusMeters: 10,
        combatStanceTransitionSeconds: 0.05,
        perceptionEnabled: true,
        guardAlertChannel,
        guardAlertGroupId: 'stannis',
        simulationLodEnabled: true,
        simulationLodNearRadiusMeters: 30,
        simulationLodFarIntervalSeconds: 0.25,
        simulationLodDistantRadiusMeters: 90,
        simulationLodDistantIntervalSeconds: 1,
        simulationLodMaxStepSeconds: 0.25,
      });

      const dt = 1 / 60;
      const tick = (player, frames = 1) => {
        for (let i = 0; i < frames; i += 1) npc.update(dt, player);
      };
      const snapshot = () => ({
        intent: npc.object3D.userData.npcPerception?.intent ?? null,
        suspicion: npc.object3D.userData.npcPerception?.suspicion ?? null,
        reason: npc.object3D.userData.npcPerception?.reason ?? null,
        x: npc.object3D.position.x,
        z: npc.object3D.position.z,
        lod: npc.object3D.userData.simulationLodTier,
        ticks: npc.object3D.userData.simulationTicks,
        skipped: npc.object3D.userData.simulationSkippedTicks,
        combatBlend: npc.object3D.userData.combatStanceBlend,
      });

      const farPlayer = { x: 80, z: 80 };
      tick(farPlayer, 90);
      const patrol = snapshot();
      const patrolMoved = Math.hypot(patrol.x, patrol.z) > 0.05;

      const visiblePlayer = { x: 0, z: 8 };
      tick(visiblePlayer, 1);
      const observe = snapshot();
      tick(visiblePlayer, 16);
      const chase = snapshot();
      const chaseStartDistance = Math.hypot(npc.object3D.position.x - visiblePlayer.x, npc.object3D.position.z - visiblePlayer.z);
      tick(visiblePlayer, 120);
      const combat = snapshot();
      const combatDistance = Math.hypot(npc.object3D.position.x - visiblePlayer.x, npc.object3D.position.z - visiblePlayer.z);

      const lostPlayer = { x: 60, z: -60 };
      let investigate = null;
      let investigateSchedulerFrames = 0;
      for (let i = 0; i < 30; i += 1) {
        npc.update(dt, lostPlayer);
        investigateSchedulerFrames += 1;
        const current = snapshot();
        if (current.intent === 'investigate') {
          investigate = current;
          break;
        }
      }
      const investigateStart = { x: npc.object3D.position.x, z: npc.object3D.position.z };
      tick(lostPlayer, 90);
      const investigateMoved = Math.hypot(
        npc.object3D.position.x - investigateStart.x,
        npc.object3D.position.z - investigateStart.z,
      ) > 0.05;

      let returned = false;
      let returnSnapshot = null;
      for (let i = 0; i < 900; i += 1) {
        npc.update(dt, lostPlayer);
        const current = snapshot();
        if (current.intent === 'patrol') {
          returned = true;
          returnSnapshot = current;
          break;
        }
      }

      const groupAlertReleased = guardAlertChannel.groups.size === 0;
      const boundedTickBudget = npc.object3D.userData.simulationTicks <= 1247;
      const finitePosition = Number.isFinite(npc.object3D.position.x)
        && Number.isFinite(npc.object3D.position.y)
        && Number.isFinite(npc.object3D.position.z);

      npc.dispose();

      return {
        patrolIntent: patrol.intent === 'patrol',
        patrolMoved,
        observeIntent: observe.intent === 'observe',
        chaseIntent: chase.intent === 'chase',
        chaseClosedDistance: combatDistance < chaseStartDistance,
        combatIntent: combat.intent === 'combat',
        combatBlendRaised: combat.combatBlend > 0.5,
        investigateIntent: investigate?.intent === 'investigate',
        investigateObservedWithinBound: investigateSchedulerFrames <= 30,
        investigateMoved,
        returnedToPatrol: returned,
        returnIntent: returnSnapshot?.intent === 'patrol',
        groupAlertReleased,
        boundedTickBudget,
        finitePosition,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`guard lifecycle proof failed: ${JSON.stringify(result)}`);
    console.log('NPC_GUARD_LIFECYCLE_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close();
    await browser.close();
    server.kill('SIGTERM');
  }

  const rawServerLog = serverErrors.join('');
  const fatalServerLog = stripBenignServerNoise(rawServerLog);
  if (/" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) {
    throw new Error(`static server errors: ${fatalServerLog}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
