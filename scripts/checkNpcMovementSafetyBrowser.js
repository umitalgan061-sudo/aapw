#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4198;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'],
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
    const proof = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');

      class FakeAssetLoader {
        async loadFBXModel() {
          const group = new THREE.Group();
          group.animations = [];
          return group;
        }
      }

      const makeNpc = (groundCollider, playerCollider, name) => createNPC({
        assetLoader: new FakeAssetLoader(),
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        walkAnimationUrl: '/assets/animations/peasant_girl/walking.fbx',
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        name,
        groundCollider,
        playerCollider,
        patrolWaypoints: [{ x: 0, z: 4 }, { x: 0, z: 8 }],
        speedMps: 2,
        pauseSeconds: 0,
        turnRateRadiansPerSecond: 8,
        simulationLodMaxStepSeconds: 0.25,
      });

      const invalidColliderNpc = await makeNpc(
        { getGroundHeight: () => 0 },
        { resolveXZ: () => ({ x: Number.NaN, z: Infinity }) },
        'invalid-collider-guard',
      );
      invalidColliderNpc.update(0.25, { x: 100, z: 100 });
      const colliderPosition = invalidColliderNpc.object3D.position.clone();
      invalidColliderNpc.dispose();

      let groundValid = false;
      const groundNpc = await makeNpc(
        { getGroundHeight: () => (groundValid ? 0 : Number.NaN) },
        { resolveXZ: (x, z) => ({ x, z }) },
        'invalid-ground-guard',
      );
      groundNpc.update(0.25, { x: 100, z: 100 });
      const blockedGroundPosition = groundNpc.object3D.position.clone();
      groundValid = true;
      groundNpc.update(0.25, { x: 100, z: 100 });
      const recoveredGroundPosition = groundNpc.object3D.position.clone();
      groundNpc.dispose();

      const resumeNpc = await makeNpc(
        { getGroundHeight: () => 0 },
        { resolveXZ: (x, z) => ({ x, z }) },
        'resume-delta-guard',
      );
      resumeNpc.update(30, { x: 100, z: 100 });
      const boundedResumePosition = resumeNpc.object3D.position.clone();
      const beforeInvalidDelta = resumeNpc.object3D.position.clone();
      resumeNpc.update(Number.NaN, { x: 100, z: 100 });
      const afterInvalidDelta = resumeNpc.object3D.position.clone();
      const skippedAfterInvalidDelta = resumeNpc.object3D.userData.simulationSkippedTicks;
      resumeNpc.dispose();

      const occlusionNpc = await createNPC({
        assetLoader: new FakeAssetLoader(),
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        walkAnimationUrl: '/assets/animations/peasant_girl/walking.fbx',
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        rotationYRadians: 0,
        name: 'invalid-los-guard',
        groundCollider: { getGroundHeight: () => 0 },
        playerCollider: { resolveXZ: () => ({ x: Number.NaN, z: Infinity }) },
        patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: 4 }],
        speedMps: 2,
        pauseSeconds: 0,
        combatStanceTriggerRadiusMeters: 10,
        perceptionEnabled: true,
        simulationLodMaxStepSeconds: 0.25,
      });
      for (let i = 0; i < 30; i += 1) occlusionNpc.update(1 / 60, { x: 0, z: 8 });
      const perception = { ...(occlusionNpc.object3D.userData.npcPerception ?? {}) };
      const occlusionPosition = occlusionNpc.object3D.position.clone();
      occlusionNpc.dispose();

      return {
        colliderFinite: [colliderPosition.x, colliderPosition.y, colliderPosition.z].every(Number.isFinite),
        colliderStayedPut: colliderPosition.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-9,
        groundFinite: [blockedGroundPosition.x, blockedGroundPosition.y, blockedGroundPosition.z].every(Number.isFinite),
        groundStayedPut: blockedGroundPosition.distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-9,
        groundRecovered: recoveredGroundPosition.z > 0 && [recoveredGroundPosition.x, recoveredGroundPosition.y, recoveredGroundPosition.z].every(Number.isFinite),
        resumeDeltaBounded: boundedResumePosition.z > 0 && boundedResumePosition.z <= 0.500001,
        invalidDeltaIgnored: afterInvalidDelta.distanceTo(beforeInvalidDelta) < 1e-9 && skippedAfterInvalidDelta >= 1,
        losFailedClosed: perception.lineOfSight === false && perception.reason === 'occluded',
        invalidLosDidNotAlert: perception.intent === 'patrol' && perception.suspicion === 0,
        occlusionFinite: [occlusionPosition.x, occlusionPosition.y, occlusionPosition.z].every(Number.isFinite),
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(proof).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`NPC movement safety proof failed: ${JSON.stringify(proof)}`);
    console.log('NPC_MOVEMENT_SAFETY_BROWSER_PASS', JSON.stringify(proof));
  } finally {
    await page.close();
    await browser.close();
    server.kill('SIGTERM');
  }

  const fatalServerLog = serverErrors.join('')
    .replace(/BrokenPipeError: \[Errno 32\] Broken pipe/g, '')
    .replace(/ConnectionResetError: \[Errno 104\] Connection reset by peer/g, '');
  if (/\" [45]\d\d |(?:^|\n)[A-Za-z_][\w.]*(?:Error|Exception):/m.test(fatalServerLog)) {
    throw new Error(`static server errors: ${fatalServerLog}`);
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });