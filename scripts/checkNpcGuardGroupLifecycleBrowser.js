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
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(`console:${message.text()}`); });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');
      class FakeAssetLoader {
        async loadFBXModel() { const group = new THREE.Group(); group.animations = []; return group; }
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
        groundY: 0, rotationYRadians: 0, groundCollider, playerCollider,
        speedMps: 2, pauseSeconds: 0.1, turnRateRadiansPerSecond: 8,
        combatStanceTriggerRadiusMeters: 10, combatStanceTransitionSeconds: 0.05,
        perceptionEnabled: true, guardAlertChannel: channel, guardAlertGroupId: 'stannis',
        simulationLodEnabled: true, simulationLodNearRadiusMeters: 30,
        simulationLodFarIntervalSeconds: 0.25, simulationLodDistantRadiusMeters: 90,
        simulationLodDistantIntervalSeconds: 1, simulationLodMaxStepSeconds: 0.25,
      };
      const leader = await createNPC({ ...common, worldX: 0, worldZ: 0, name: 'leader', displayName: 'Leader', patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: -6 }] });
      const wingman = await createNPC({ ...common, worldX: 24, worldZ: 0, name: 'wingman', displayName: 'Wingman', patrolWaypoints: [{ x: 24, z: 0 }, { x: 24, z: -6 }] });
      const outsider = await createNPC({ ...common, worldX: 24, worldZ: 2, name: 'outsider', displayName: 'Outsider', guardAlertGroupId: 'cersei', patrolWaypoints: [{ x: 24, z: 2 }, { x: 24, z: -4 }] });

      const dt = 1 / 60;
      const threatPlayer = { x: 0, z: 8 };
      const quietPlayer = { x: 50, z: 50 };
      const distantPlayer = { x: 100, z: 100 };

      for (let i = 0; i < 18; i += 1) leader.update(dt, threatPlayer);
      const alert = channel.groups.get('stannis');
      const firstRevision = alert?.revision ?? null;
      const leaderPublished = Boolean(alert && alert.sourceId === 'leader' && alert.lastKnown?.z === 8);

      wingman.update(dt, distantPlayer);
      const wingmanPerception = { ...wingman.object3D.userData.npcPerception };
      const wingmanStart = { x: wingman.object3D.position.x, z: wingman.object3D.position.z };
      for (let i = 0; i < 60; i += 1) wingman.update(dt, distantPlayer);
      const wingmanMoved = Math.hypot(wingman.object3D.position.x - wingmanStart.x, wingman.object3D.position.z - wingmanStart.z) > 0.05;

      const outsiderTicksBefore = outsider.object3D.userData.simulationTicks;
      let outsiderObservedOnRealTick = false;
      for (let i = 0; i < 180; i += 1) {
        outsider.update(dt, distantPlayer);
        if (outsider.object3D.userData.simulationTicks > outsiderTicksBefore && outsider.object3D.userData.npcPerception) { outsiderObservedOnRealTick = true; break; }
      }
      const outsiderPerception = { ...(outsider.object3D.userData.npcPerception ?? {}) };
      const outsiderStayedIsolated = outsiderObservedOnRealTick && outsiderPerception.assisted === false
        && outsiderPerception.assistSourceId == null && outsiderPerception.intent === 'patrol' && !channel.groups.has('cersei');

      let leaderReleaseFrames = null;
      for (let i = 0; i < 240; i += 1) { leader.update(dt, quietPlayer); if (!channel.groups.has('stannis')) { leaderReleaseFrames = i + 1; break; } }
      const leaderReleased = leaderReleaseFrames != null;

      let wingmanReturnFrames = null;
      for (let i = 0; i < 1800; i += 1) {
        wingman.update(dt, quietPlayer);
        const perception = wingman.object3D.userData.npcPerception;
        if (perception?.intent === 'patrol' && perception?.assisted === false) { wingmanReturnFrames = i + 1; break; }
      }
      const wingmanReturned = wingmanReturnFrames != null;

      const replacementThreat = { x: wingman.object3D.position.x, z: wingman.object3D.position.z + 2 };
      let replacementPublishFrames = null;
      for (let i = 0; i < 120; i += 1) {
        wingman.update(dt, replacementThreat);
        if (channel.groups.get('stannis')?.sourceId === 'wingman') { replacementPublishFrames = i + 1; break; }
      }
      const replacement = channel.groups.get('stannis');
      const replacementPublished = replacementPublishFrames != null && replacement?.sourceId === 'wingman' && replacement?.revision === firstRevision + 1;

      leader.dispose();
      const staleLeaderDisposePreservesReplacement = channel.groups.get('stannis')?.sourceId === 'wingman';

      const reserve = await createNPC({
        ...common,
        worldX: wingman.object3D.position.x + 24, worldZ: wingman.object3D.position.z,
        name: 'reserve', displayName: 'Reserve',
        patrolWaypoints: [
          { x: wingman.object3D.position.x + 24, z: wingman.object3D.position.z },
          { x: wingman.object3D.position.x + 24, z: wingman.object3D.position.z - 6 },
        ],
      });
      reserve.update(dt, distantPlayer);
      const reservePerception = { ...(reserve.object3D.userData.npcPerception ?? {}) };
      const reserveAcceptedReplacement = reservePerception.assisted === true && reservePerception.intent === 'investigate' && reservePerception.assistSourceId === 'wingman';

      let replacementReleaseFrames = null;
      for (let i = 0; i < 240; i += 1) { wingman.update(dt, quietPlayer); if (!channel.groups.has('stannis')) { replacementReleaseFrames = i + 1; break; } }
      const replacementReleased = replacementReleaseFrames != null;

      let reserveReturnFrames = null;
      for (let i = 0; i < 1800; i += 1) {
        reserve.update(dt, quietPlayer);
        const perception = reserve.object3D.userData.npcPerception;
        if (perception?.intent === 'patrol' && perception?.assisted === false) { reserveReturnFrames = i + 1; break; }
      }
      const reserveReturned = reserveReturnFrames != null;

      const revisionsSequential = firstRevision === 1 && channel.nextRevision === 3;
      const registryCleanBeforeDispose = !channel.groups.has('stannis') && !channel.groups.has('cersei');
      wingman.dispose(); outsider.dispose(); reserve.dispose();
      const registryCleanAfterDispose = channel.groups.size === 0;

      return {
        leaderPublished,
        wingmanAssisted: wingmanPerception.assisted === true,
        wingmanInvestigates: wingmanPerception.intent === 'investigate',
        wingmanSourceCorrect: wingmanPerception.assistSourceId === 'leader',
        wingmanMoved, outsiderStayedIsolated, outsiderObservedOnRealTick, leaderReleased,
        leaderReleaseBounded: leaderReleaseFrames != null && leaderReleaseFrames <= 240,
        wingmanReturned, wingmanReturnBounded: wingmanReturnFrames != null && wingmanReturnFrames <= 1800,
        replacementPublished, replacementPublishBounded: replacementPublishFrames != null && replacementPublishFrames <= 120,
        staleLeaderDisposePreservesReplacement, reserveAcceptedReplacement, replacementReleased,
        replacementReleaseBounded: replacementReleaseFrames != null && replacementReleaseFrames <= 240,
        reserveReturned, reserveReturnBounded: reserveReturnFrames != null && reserveReturnFrames <= 1800,
        revisionsSequential, registryCleanBeforeDispose, registryCleanAfterDispose,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`guard group lifecycle proof failed: ${JSON.stringify(result)}`);
    console.log('NPC_GUARD_GROUP_LIFECYCLE_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close(); await browser.close(); server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
  if (/\" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) throw new Error(`static server errors: ${fatalServerLog}`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
