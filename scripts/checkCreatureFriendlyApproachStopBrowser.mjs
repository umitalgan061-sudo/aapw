#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const proof = await page.evaluate(async () => {
    const { createCreatureBeing } = await import('/src/3d/gameplay/creatureBrain.js');
    const { wrapCreatureWithThreatMemory } = await import('/src/3d/gameplay/livingWorldSpawner.js');
    const { mulberry32 } = await import('/src/3d/world/terrain.js');
    const groundCollider = { getGroundHeight: () => 5 };
    const createBeing = (speciesId, spawnId, x = 0, playerCollider = null) => createCreatureBeing({
      speciesId, spawnId, worldX: x, worldZ: 0, groundY: 5, rotationYRadians: Math.PI / 2,
      groundCollider, playerCollider, mulberry32,
    });
    const distanceTo = (controller, point) => Math.hypot(
      controller.object3D.position.x - point.x, controller.object3D.position.z - point.z,
    );
    const positionOf = ({ object3D }) => ({ x: object3D.position.x, y: object3D.position.y, z: object3D.position.z });
    const player = { x: 3, z: 0 };
    const dog = createBeing('kopek', 'friendly-stop-boundary');
    const before = distanceTo(dog, player);
    dog.update(0.25, player);
    const after = distanceTo(dog, player);
    const position = positionOf(dog);
    dog.dispose();
    const exactStopDog = createBeing('kopek', 'friendly-stop-stable', 0.5);
    exactStopDog.update(0.25, player);
    const exactStopDistance = distanceTo(exactStopDog, player);
    exactStopDog.dispose();
    let colliderCalls = 0;
    const colliderDog = createBeing('kopek', 'friendly-stop-after-collider', 0, {
      resolveXZ: (x, z) => ({ x: ++colliderCalls === 1 ? x + 0.5 : x, z }),
    });
    colliderDog.update(0.25, player);
    const afterCollider = distanceTo(colliderDog, player);
    const rejectedPosition = positionOf(colliderDog);
    colliderDog.update(0.25, player);
    const recoveredDistance = distanceTo(colliderDog, player);
    const colliderPosition = positionOf(colliderDog);
    colliderDog.dispose();
    const outwardDog = createBeing('kopek', 'friendly-stop-outward-collider', 0, {
      resolveXZ: (x, z) => ({ x: x - 0.25, z }),
    });
    outwardDog.update(0.25, player);
    const outwardDistance = distanceTo(outwardDog, player);
    outwardDog.dispose();
    const herdRegistry = new Map();
    const wrapDeer = (raw, sourceId) => wrapCreatureWithThreatMemory(raw, {
      triggerRadiusMeters: 15, reactiveDirection: 'away', memorySeconds: 1.25,
      speciesId: 'geyik', packAlertRadiusMeters: 18, herdRegistry, sourceId,
    });
    const leader = wrapDeer(createBeing('geyik', 'herd-boundary-leader'), 'leader');
    const follower = wrapDeer(createBeing('geyik', 'herd-boundary-follower'), 'follower');
    leader.update(0.1, { x: 0, z: 1 });
    follower.object3D.position.set(leader.object3D.position.x + 18, 5, leader.object3D.position.z);
    const herdExactBoundaryFleeing = follower.isFleeing;
    follower.object3D.position.x -= 0.001;
    const herdInsideBoundaryFleeing = follower.isFleeing;
    leader.dispose(); follower.dispose();
    const farLeader = wrapDeer(createBeing('geyik', 'herd-nearest-far', 10), 'far');
    const nearLeader = wrapDeer(createBeing('geyik', 'herd-nearest-near', -3), 'near');
    const nearestFollower = wrapDeer(createBeing('geyik', 'herd-nearest-follower'), 'nearest');
    farLeader.update(0.1, { x: 10, z: 1 }); nearLeader.update(0.1, { x: -3, z: 1 });
    nearestFollower.update(0.1, { x: 100, z: 100 });
    const nearestHerdDeltaX = nearestFollower.object3D.position.x; farLeader.dispose(); nearLeader.dispose(); nearestFollower.dispose();
    const ecologyRegistry = new Map();
    const wrapEcology = (raw, speciesId, sourceId, predatorSpeciesIds = [], predatorThreatRadiusMeters = 0) => wrapCreatureWithThreatMemory(raw, { triggerRadiusMeters: 15, reactiveDirection: 'away', memorySeconds: 1.25, speciesId, sourceId, predatorSpeciesIds, predatorThreatRadiusMeters, ecologyRegistry });
    const rightPredator = wrapEcology(createBeing('aslan', 'predator-tie-right', 5), 'aslan', 'right'); const leftPredator = wrapEcology(createBeing('aslan', 'predator-tie-left', -5), 'aslan', 'left');
    const tiedPrey = wrapEcology(createBeing('geyik', 'predator-tie-prey'), 'geyik', 'prey', ['aslan'], 24); tiedPrey.update(0.1, { x: 100, z: 100 });
    const tiedPredatorDeltaX = tiedPrey.object3D.position.x; rightPredator.dispose(); leftPredator.dispose(); tiedPrey.dispose();
    return {
      before, after, position, exactStopDistance, afterCollider, rejectedPosition, recoveredDistance,
      colliderCalls, colliderPosition, outwardDistance, herdExactBoundaryFleeing, herdInsideBoundaryFleeing, nearestHerdDeltaX, tiedPredatorDeltaX,
    };
  });
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('\n')}`);
  assert.ok(proof.before > 2.5, `precondition failed: ${proof.before}`);
  assert.ok(Math.abs(proof.after - 2.5) <= 1e-6, `friendly approach missed stop distance: ${proof.after}`);
  assert.ok(Object.values(proof.position).every(Number.isFinite), 'friendly approach published a non-finite transform');
  assert.ok(Math.abs(proof.exactStopDistance - 2.5) <= 1e-6, `friendly creature drifted at stop distance: ${proof.exactStopDistance}`);
  assert.ok(proof.afterCollider >= 2.5 - 1e-6, `collider correction crossed friendly stop distance: ${proof.afterCollider}`);
  assert.deepEqual(proof.rejectedPosition, { x: 0, y: 5, z: 0 }, 'rejected collider correction partially published transform state');
  assert.ok(Math.abs(proof.recoveredDistance - 2.5) <= 1e-6, `friendly approach did not recover: ${proof.recoveredDistance}`);
  assert.deepEqual(proof.colliderPosition, { x: 0.5, y: 5, z: 0 }, 'friendly recovery missed grounded authored stop boundary');
  assert.equal(proof.colliderCalls, 2, 'friendly approach should retry collider resolution on the next valid tick');
  assert.ok(proof.outwardDistance > 2.5, `safe outward collider correction was rejected: ${proof.outwardDistance}`);
  assert.equal(proof.herdExactBoundaryFleeing, false, 'herd alert must stay strict at the exact radius boundary');
  assert.equal(proof.herdInsideBoundaryFleeing, true, 'herd alert must wake an epsilon-inside same-species neighbor');
  assert.ok(proof.nearestHerdDeltaX > 0, `herd reaction followed insertion order instead of nearest source: ${proof.nearestHerdDeltaX}`);
  assert.ok(proof.tiedPredatorDeltaX > 0, `equal-distance predator choice followed insertion order: ${proof.tiedPredatorDeltaX}`);
  console.log('Creature friendly/pack boundary browser proof PASS', proof);
} finally {
  await browser.close();
}
