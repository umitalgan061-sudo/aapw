#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async () => {
    const { createWolf } = await import('/src/3d/gameplay/animals.js');
    const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');
    const species = ANIMAL_CONFIG.SPECIES.wolf;
    const assetLoader = new AssetLoader();
    const groundCollider = { getGroundHeight: () => 0 };
    const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };

    async function makeWolf(extra = {}) {
      return createWolf({
        assetLoader,
        modelUrl: species.modelUrl,
        idleClipName: species.clips.idle,
        stripChildNames: species.stripChildNames,
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        groundCollider,
        playerCollider,
        fleeClipName: species.clips.flee,
        fleeTriggerRadiusMeters: ANIMAL_CONFIG.FLEE_TRIGGER_RADIUS_METERS,
        fleeSpeedMps: ANIMAL_CONFIG.FLEE_SPEED_MPS,
        packAlertRadiusMeters: ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS,
        ...extra,
      });
    }

    const nearPlayer = { x: 0, z: -1 };

    const directWolf = await makeWolf();
    const directBefore = directWolf.object3D.position.clone();
    directWolf.update(3, nearPlayer, []);
    const directMove = directWolf.object3D.position.distanceTo(directBefore);
    const directTelemetry = { ...directWolf.object3D.userData.wildlifeFlee };
    directWolf.update(Number.NaN, nearPlayer, []);
    const nanMove = directWolf.object3D.position.distanceTo(directBefore) - directMove;
    directWolf.dispose();

    const patrolWolf = await makeWolf({
      walkClipName: species.clips.walk,
      patrolWaypoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
      speedMps: ANIMAL_CONFIG.PATROL_SPEED_MPS,
      pauseSeconds: 0,
      turnRateRadiansPerSecond: ANIMAL_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
    });
    patrolWolf.update(1 / 60, { x: 100, z: 100 }, []);
    const patrolBefore = patrolWolf.object3D.position.clone();
    patrolWolf.update(3, { x: 100, z: 100 }, []);
    const patrolMove = patrolWolf.object3D.position.distanceTo(patrolBefore);
    patrolWolf.dispose();

    const packWolf = await makeWolf();
    const packBefore = packWolf.object3D.position.clone();
    packWolf.update(3, undefined, [{ x: -1, z: 0 }, { x: Number.NaN, z: 0 }]);
    const packMove = packWolf.object3D.position.distanceTo(packBefore);
    const packDx = packWolf.object3D.position.x - packBefore.x;
    const packTelemetry = { ...packWolf.object3D.userData.wildlifeFlee };
    packWolf.dispose();

    const malformedPackWolf = await makeWolf();
    const malformedBefore = malformedPackWolf.object3D.position.clone();
    malformedPackWolf.update(0.1, undefined, [{ x: Number.NaN, z: 0 }, { x: 0, z: Infinity }]);
    const malformedMove = malformedPackWolf.object3D.position.distanceTo(malformedBefore);
    const malformedTelemetry = { ...malformedPackWolf.object3D.userData.wildlifeFlee };
    malformedPackWolf.dispose();

    const overlapWolf = await makeWolf({ rotationYRadians: Math.PI / 2 });
    overlapWolf.update(3, { x: 0, z: 0 }, []);
    const overlap = {
      move: Math.hypot(overlapWolf.object3D.position.x, overlapWolf.object3D.position.z),
      x: overlapWolf.object3D.position.x,
      z: overlapWolf.object3D.position.z,
      fleeing: overlapWolf.isFleeing,
    };
    overlapWolf.dispose();

    const invalidColliderWolf = await makeWolf({ playerCollider: { resolveXZ: () => ({ x: Number.NaN, z: Infinity }) } });
    const invalidColliderBefore = invalidColliderWolf.object3D.position.clone();
    invalidColliderWolf.update(0.1, nearPlayer, []);
    const invalidCollider = {
      move: invalidColliderWolf.object3D.position.distanceTo(invalidColliderBefore),
      finite: ['x', 'y', 'z'].every((axis) => Number.isFinite(invalidColliderWolf.object3D.position[axis])),
      fleeing: invalidColliderWolf.isFleeing,
    };
    invalidColliderWolf.dispose();

    const invalidGroundWolf = await makeWolf({ groundY: 7, groundCollider: { getGroundHeight: () => Number.NaN } });
    const invalidGroundBefore = invalidGroundWolf.object3D.position.clone();
    invalidGroundWolf.update(0.1, nearPlayer, []);
    const invalidGround = {
      move: invalidGroundWolf.object3D.position.distanceTo(invalidGroundBefore),
      finite: ['x', 'y', 'z'].every((axis) => Number.isFinite(invalidGroundWolf.object3D.position[axis])),
    };
    invalidGroundWolf.dispose();

    const recoveryWolf = await makeWolf({
      walkClipName: species.clips.walk,
      patrolWaypoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
      speedMps: ANIMAL_CONFIG.PATROL_SPEED_MPS,
      pauseSeconds: 0,
    });
    recoveryWolf.update(0.1, nearPlayer, []);
    const triggerRadius = recoveryWolf.object3D.userData.wildlifeFlee.triggerRadiusMeters;
    const releaseRadius = recoveryWolf.object3D.userData.wildlifeFlee.releaseRadiusMeters;
    const recoveryOrigin = recoveryWolf.object3D.position.clone();
    recoveryWolf.update(0.1, { x: recoveryOrigin.x, z: recoveryOrigin.z - (triggerRadius + 1) }, []);
    const recoverTelemetry = { ...recoveryWolf.object3D.userData.wildlifeFlee };
    const releaseOrigin = recoveryWolf.object3D.position.clone();
    recoveryWolf.update(0.1, { x: releaseOrigin.x, z: releaseOrigin.z - (releaseRadius + 1) }, []);
    const releaseTelemetry = { ...recoveryWolf.object3D.userData.wildlifeFlee };
    const releasePatrolMove = recoveryWolf.object3D.position.distanceTo(releaseOrigin);
    recoveryWolf.dispose();

    return {
      modelUrl: species.modelUrl,
      directMove,
      directTelemetry,
      nanMove,
      patrolMove,
      packMove,
      packDx,
      packTelemetry,
      malformedMove,
      malformedTelemetry,
      overlap,
      invalidCollider,
      invalidGround,
      triggerRadius,
      releaseRadius,
      recoverTelemetry,
      releaseTelemetry,
      releasePatrolMove,
    };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.match(proof.modelUrl, /assets\/models\/animals\/wolf\/.+\.glb$/i, 'real configured wolf GLB must be used');
  assert.equal(proof.directTelemetry.phase, 'flee');
  assert.ok(proof.directMove > 0 && proof.directMove <= 0.45 + 1e-6, `direct flee escaped 100 ms budget: ${proof.directMove}`);
  assert.ok(Math.abs(proof.nanMove) <= 1e-9, `NaN delta moved wolf: ${proof.nanMove}`);
  assert.ok(proof.patrolMove > 0 && proof.patrolMove <= 0.22 + 1e-6, `patrol escaped 100 ms budget: ${proof.patrolMove}`);
  assert.equal(proof.packTelemetry.phase, 'pack-flee', 'finite fleeing packmate must propagate without player position');
  assert.equal(proof.packTelemetry.direct, false);
  assert.equal(proof.packTelemetry.pack, true);
  assert.equal(proof.packTelemetry.distanceMeters, null);
  assert.ok(proof.packMove > 0 && proof.packMove <= 0.45 + 1e-6, `pack flee escaped 100 ms budget: ${proof.packMove}`);
  assert.ok(proof.packDx > 0.44, `nearest packmate must drive deterministic +X separation: ${proof.packDx}`);
  assert.equal(proof.malformedTelemetry.pack, false, 'malformed packmates must fail closed');
  assert.equal(proof.malformedMove, 0, 'malformed packmates must not move static wolf');
  assert.equal(proof.overlap.fleeing, true);
  assert.ok(proof.overlap.move > 0 && proof.overlap.move <= 0.45 + 1e-6);
  assert.ok(proof.overlap.x > 0.44 && Math.abs(proof.overlap.z) <= 1e-6, 'exact direct overlap must use deterministic yaw fallback');
  assert.equal(proof.invalidCollider.fleeing, true, 'movement adapter failure must not erase valid threat classification');
  assert.equal(proof.invalidCollider.finite, true);
  assert.equal(proof.invalidCollider.move, 0, 'invalid collider output must fail closed');
  assert.equal(proof.invalidGround.finite, true);
  assert.equal(proof.invalidGround.move, 0, 'invalid ground output must fail closed');
  assert.ok(proof.releaseRadius > proof.triggerRadius);
  assert.equal(proof.recoverTelemetry.phase, 'recover');
  assert.equal(proof.releaseTelemetry.phase, 'patrol');
  assert.ok(proof.releasePatrolMove > 0 && proof.releasePatrolMove <= 0.22 + 1e-6, `released patrol escaped budget: ${proof.releasePatrolMove}`);

  console.log('WILDLIFE_PACK_LONG_FRAME_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
