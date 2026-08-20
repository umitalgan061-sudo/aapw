#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4188;
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
      const loader = new FakeAssetLoader();
      const groundCollider = { getGroundHeight: () => 0 };
      const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
      const channel = { nextRevision: 1, groups: new Map() };
      const common = {
        assetLoader: loader,
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        walkAnimationUrl: '/assets/animations/peasant_girl/walking.fbx',
        groundY: 0,
        rotationYRadians: 0,
        groundCollider,
        playerCollider,
        speedMps: 2,
        pauseSeconds: 0.1,
        turnRateRadiansPerSecond: 8,
        combatStanceTriggerRadiusMeters: 10,
        combatStanceTransitionSeconds: 0.05,
        perceptionEnabled: true,
        guardAlertChannel: channel,
        guardAlertGroupId: 'stannis',
        simulationLodEnabled: true,
        simulationLodNearRadiusMeters: 30,
        simulationLodFarIntervalSeconds: 0.25,
        simulationLodDistantRadiusMeters: 90,
        simulationLodDistantIntervalSeconds: 1,
        simulationLodMaxStepSeconds: 0.25,
      };
      const leader = await createNPC({
        ...common, worldX: 0, worldZ: 0, name: 'leader', displayName: 'Leader',
        patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: -6 }],
      });
      const wingman = await createNPC({
        ...common, worldX: 24, worldZ: 0, name: 'wingman', displayName: 'Wingman',
        patrolWaypoints: [{ x: 24, z: 0 }, { x: 24, z: -6 }],
      });
      const outsider = await createNPC({
        ...common, worldX: 24, worldZ: 2, name: 'outsider', displayName: 'Outsider',
        guardAlertGroupId: 'cersei',
        patrolWaypoints: [{ x: 24, z: 2 }, { x: 24, z: -4 }],
      });

      const dt = 1 / 60;
      const player = { x: 0, z: 8 };
      for (let i = 0; i < 18; i += 1) leader.update(dt, player);
      const alert = channel.groups.get('stannis');
      const leaderPublished = Boolean(alert && alert.sourceId === 'leader' && alert.lastKnown?.z === 8);

      wingman.update(dt, { x: 100, z: 100 });
      outsider.update(dt, { x: 100, z: 100 });
      const wingmanPerception = { ...wingman.object3D.userData.npcPerception };
      const outsiderPerception = { ...outsider.object3D.userData.npcPerception };
      const wingmanStart = { x: wingman.object3D.position.x, z: wingman.object3D.position.z };
      for (let i = 0; i < 60; i += 1) wingman.update(dt, { x: 100, z: 100 });
      const wingmanMoved = Math.hypot(
        wingman.object3D.position.x - wingmanStart.x,
        wingman.object3D.position.z - wingmanStart.z,
      ) > 0.05;

      const playerGone = { x: -80, z: -80 };
      leader.update(dt, playerGone);
      const leaderReleased = !channel.groups.has('stannis');

      let wingmanReturned = false;
      for (let i = 0; i < 900; i += 1) {
        wingman.update(dt, playerGone);
        if (wingman.object3D.userData.npcPerception?.intent === 'patrol') {
          wingmanReturned = true;
          break;
        }
      }

      const groupRevisionBounded = channel.nextRevision === 2;
      const outsiderStayedIsolated = outsiderPerception.assisted === false
        && outsiderPerception.intent === 'patrol';
      const registryCleanBeforeDispose = !channel.groups.has('stannis') && !channel.groups.has('cersei');
      leader.dispose();
      wingman.dispose();
      outsider.dispose();
      const registryCleanAfterDispose = channel.groups.size === 0;

      return {
        leaderPublished,
        wingmanAssisted: wingmanPerception.assisted === true,
        wingmanInvestigates: wingmanPerception.intent === 'investigate',
        wingmanSourceCorrect: wingmanPerception.assistSourceId === 'leader',
        wingmanMoved,
        outsiderStayedIsolated,
        leaderReleased,
        wingmanReturned,
        groupRevisionBounded,
        registryCleanBeforeDispose,
        registryCleanAfterDispose,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`guard group lifecycle proof failed: ${JSON.stringify(result)}`);
    console.log('NPC_GUARD_GROUP_LIFECYCLE_BROWSER_PASS', JSON.stringify(result));
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
