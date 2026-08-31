#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const transformOf = ({ x, y, z, finite }) => ({ x, y, z, finite });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async () => {
    const { createCreatureBeing, spawnConfiguredCreatures } = await import('/src/3d/gameplay/creatureBrain.js');
    const { scatterCreatures } = await import('/src/3d/gameplay/creatureSpawner.js');
    const { mulberry32 } = await import('/src/3d/world/terrain.js');

    const snapshot = (controller) => ({
      x: controller.object3D.position.x,
      y: controller.object3D.position.y,
      z: controller.object3D.position.z,
      finite: [controller.object3D.position.x, controller.object3D.position.y, controller.object3D.position.z].every(Number.isFinite),
      reacting: controller.isFleeing,
    });

    const configuredGroundSamples = [];
    const configuredGroundCollider = {
      getGroundHeight(x) {
        configuredGroundSamples.push(x);
        if (x === 10) return Number.NaN;
        if (x === 20) throw new Error('synthetic configured creature terrain failure');
        return 5;
      },
    };
    const configuredSpawns = [
      { id: 'creature-valid-a', speciesId: 'kedi', x: 0, z: 0 },
      { id: 'creature-nan-ground', speciesId: 'kedi', x: 10, z: 0 },
      { id: 'creature-throw-ground', speciesId: 'kedi', x: 20, z: 0 },
      { id: 'creature-invalid-world', speciesId: 'kedi', x: Number.POSITIVE_INFINITY, z: 0 },
      { id: 'creature-invalid-species', speciesId: 'missing-species', x: 30, z: 0 },
      { id: 'creature-valid-b', speciesId: 'kopek', x: 40, z: 0 },
    ];
    const configured = spawnConfiguredCreatures({
      spawns: configuredSpawns,
      groundCollider: configuredGroundCollider,
      playerCollider: null,
      mulberry32,
    });
    const configuredSnapshot = configured.map((controller) => ({
      name: controller.object3D.name,
      ...snapshot(controller),
    }));
    for (const controller of configured) controller.dispose();

    let recoveringHeightCalls = 0;
    const recoveringScatter = scatterCreatures({
      sampleHeightMeters() {
        recoveringHeightCalls += 1;
        if (recoveringHeightCalls === 1) throw new Error('synthetic first scatter terrain failure');
        return 10;
      },
      seaLevelMeters: 0,
      seats: [],
      roadEdges: [],
      seed: 12345,
      seedTag: 0x43525346,
      mulberry32,
      centerX: 0,
      centerZ: 0,
      radiusMeters: 100,
      speciesCounts: { domuz: 1 },
    });

    let allThrowHeightCalls = 0;
    const unavailableScatter = scatterCreatures({
      sampleHeightMeters() {
        allThrowHeightCalls += 1;
        throw new Error('synthetic unavailable scatter terrain');
      },
      seaLevelMeters: 0,
      seats: [],
      roadEdges: [],
      seed: 12345,
      seedTag: 0x43525347,
      mulberry32,
      centerX: 0,
      centerZ: 0,
      radiusMeters: 100,
      speciesCounts: { domuz: 1 },
    });

    let nonFiniteCenterHeightCalls = 0;
    const nonFiniteCenterScatter = scatterCreatures({
      sampleHeightMeters() {
        nonFiniteCenterHeightCalls += 1;
        return 10;
      },
      seaLevelMeters: 0,
      seats: [],
      roadEdges: [],
      seed: 12345,
      seedTag: 0x43525348,
      mulberry32,
      centerX: Number.POSITIVE_INFINITY,
      centerZ: 0,
      radiusMeters: 100,
      speciesCounts: { domuz: 1 },
    });

    let groundMode = 'collider-throw';
    const movementCollider = {
      resolveXZ(x, z) {
        if (groundMode === 'collider-throw') throw new Error('synthetic creature collider failure');
        if (groundMode === 'collider-nonfinite') return { x: Number.NaN, z };
        return { x, z };
      },
    };
    const movementGround = {
      getGroundHeight() {
        if (groundMode === 'ground-throw') throw new Error('synthetic creature ground failure');
        if (groundMode === 'ground-nonfinite') return Number.POSITIVE_INFINITY;
        return 5;
      },
    };
    const groundBeing = createCreatureBeing({
      speciesId: 'kedi',
      spawnId: 'movement-ground-safety',
      worldX: 0,
      worldZ: 0,
      groundY: 5,
      groundCollider: movementGround,
      playerCollider: movementCollider,
      mulberry32,
    });
    const groundStart = snapshot(groundBeing);
    const groundFailures = [];
    for (const mode of ['collider-throw', 'collider-nonfinite', 'ground-throw', 'ground-nonfinite']) {
      groundMode = mode;
      groundBeing.update(0.1, { x: 1, z: 0 });
      groundFailures.push({ mode, ...snapshot(groundBeing) });
    }
    groundMode = 'ok';
    groundBeing.update(0.1, { x: 1, z: 0 });
    const groundRecovered = snapshot(groundBeing);
    groundBeing.dispose();

    let flightMode = 'throw';
    let airbornePlayerColliderCalls = 0;
    const faultFlightGround = {
      getGroundHeight() {
        if (flightMode === 'throw') throw new Error('synthetic flight terrain failure');
        if (flightMode === 'nonfinite') return Number.NaN;
        return 5;
      },
    };
    const controlFlightGround = { getGroundHeight: () => 5 };
    const forbiddenAirborneCollider = {
      resolveXZ(x, z) {
        airbornePlayerColliderCalls += 1;
        return { x, z };
      },
    };
    const makeBird = (spawnId, groundCollider, playerCollider = null) => createCreatureBeing({
      speciesId: 'tavuk',
      spawnId,
      worldX: 0,
      worldZ: 0,
      groundY: 5,
      groundCollider,
      playerCollider,
      mulberry32,
    });
    const faultBird = makeBird('movement-flight-fault', faultFlightGround, forbiddenAirborneCollider);
    const controlBird = makeBird('movement-flight-control', controlFlightGround);
    const flightStart = snapshot(faultBird);
    const player = { x: 1, z: 0 };

    faultBird.update(0.1, player);
    const failedTakeoffThrow = snapshot(faultBird);
    flightMode = 'nonfinite';
    faultBird.update(0.1, player);
    const failedTakeoffNonFinite = snapshot(faultBird);

    flightMode = 'ok';
    faultBird.update(0.1, player);
    controlBird.update(0.1, player);
    const recoveredTakeoffFault = snapshot(faultBird);
    const recoveredTakeoffControl = snapshot(controlBird);

    flightMode = 'throw';
    const beforeAirborneFailure = snapshot(faultBird);
    faultBird.update(0.1, player);
    const afterAirborneFailure = snapshot(faultBird);
    flightMode = 'ok';
    faultBird.update(0.1, player);
    controlBird.update(0.1, player);
    const recoveredAirborneFault = snapshot(faultBird);
    const recoveredAirborneControl = snapshot(controlBird);

    let previousY = faultBird.object3D.position.y;
    let landingObserved = false;
    let landingFailureStable = null;
    let landingRecoveryMatches = null;
    for (let i = 0; i < 80 && !landingObserved; i += 1) {
      faultBird.update(0.1, player);
      controlBird.update(0.1, player);
      const currentY = faultBird.object3D.position.y;
      if (currentY < previousY - 1e-9) {
        landingObserved = true;
        const before = snapshot(faultBird);
        flightMode = 'throw';
        faultBird.update(0.1, player);
        const after = snapshot(faultBird);
        landingFailureStable = JSON.stringify(before) === JSON.stringify(after);
        flightMode = 'ok';
        faultBird.update(0.1, player);
        controlBird.update(0.1, player);
        landingRecoveryMatches = JSON.stringify(snapshot(faultBird)) === JSON.stringify(snapshot(controlBird));
      }
      previousY = currentY;
    }

    faultBird.dispose();
    controlBird.dispose();

    const livingWorldSource = await fetch('/src/3d/gameplay/livingWorldSpawner.js').then((response) => response.text());
    return {
      configuredSnapshot,
      configuredGroundSamples,
      recoveringHeightCalls,
      recoveringScatter,
      allThrowHeightCalls,
      unavailableScatterCount: unavailableScatter.length,
      nonFiniteCenterHeightCalls,
      nonFiniteCenterScatterCount: nonFiniteCenterScatter.length,
      groundStart,
      groundFailures,
      groundRecovered,
      flightStart,
      failedTakeoffThrow,
      failedTakeoffNonFinite,
      recoveredTakeoffFault,
      recoveredTakeoffControl,
      beforeAirborneFailure,
      afterAirborneFailure,
      recoveredAirborneFault,
      recoveredAirborneControl,
      landingObserved,
      landingFailureStable,
      landingRecoveryMatches,
      airbornePlayerColliderCalls,
      usesIdStableMapping: livingWorldSource.includes('creatureSpawnById.get(creature.object3D.name)'),
      usesShiftProneIndexMapping: livingWorldSource.includes('creatureSpawns[index]?.speciesId'),
    };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(
    proof.configuredSnapshot.map(({ name }) => name),
    ['creature-valid-a', 'creature-valid-b'],
    `unsafe configured creatures must be rejected independently: ${JSON.stringify(proof.configuredSnapshot)}`,
  );
  assert.ok(proof.configuredSnapshot.every((entry) => entry.finite && entry.y === 5), 'surviving configured rigs must have finite terrain-relative transforms');
  assert.deepEqual(proof.configuredGroundSamples, [0, 10, 20, 40], 'invalid coordinates/species must be rejected before terrain sampling while later valid entries still spawn');

  assert.equal(proof.recoveringScatter.length, 1, 'one transient terrain exception must reject only that scatter candidate, not the whole population');
  assert.ok(Number.isFinite(proof.recoveringScatter[0]?.x) && Number.isFinite(proof.recoveringScatter[0]?.z), 'recovered scatter candidate must be finite');
  assert.ok(proof.recoveringHeightCalls >= 5, `scatter must retry after the first terrain exception: ${proof.recoveringHeightCalls}`);
  assert.equal(proof.unavailableScatterCount, 0, 'an unavailable terrain sampler must exhaust the bounded candidate budget without throwing');
  assert.equal(proof.allThrowHeightCalls, 10, 'one creature with permanently unavailable terrain must stay bounded to 10 attempts');
  assert.equal(proof.nonFiniteCenterScatterCount, 0, 'non-finite scatter centers must fail closed');
  assert.equal(proof.nonFiniteCenterHeightCalls, 0, 'non-finite scatter coordinates must be rejected before terrain sampling');

  for (const failed of proof.groundFailures) {
    assert.deepEqual(transformOf(failed), transformOf(proof.groundStart), `ground ${failed.mode} must leave the complete transform unchanged`);
    assert.equal(failed.reacting, true, `ground ${failed.mode} must preserve the live reaction state for retry`);
  }
  assert.equal(proof.groundRecovered.finite, true, 'ground movement must recover to a finite transform');
  assert.notDeepEqual(
    { x: proof.groundRecovered.x, z: proof.groundRecovered.z },
    { x: proof.groundStart.x, z: proof.groundStart.z },
    'a later valid ground tick must retry and move rather than permanently latching failure',
  );

  assert.deepEqual(transformOf(proof.failedTakeoffThrow), transformOf(proof.flightStart), 'throwing takeoff terrain must not partially move the bird');
  assert.deepEqual(transformOf(proof.failedTakeoffNonFinite), transformOf(proof.flightStart), 'non-finite takeoff terrain must not partially move the bird');
  assert.equal(proof.failedTakeoffThrow.reacting, true, 'failed takeoff must preserve the direct reaction for retry');
  assert.equal(proof.failedTakeoffNonFinite.reacting, true, 'non-finite takeoff must preserve the direct reaction for retry');
  assert.deepEqual(proof.recoveredTakeoffFault, proof.recoveredTakeoffControl, 'takeoff after failed terrain ticks must match a clean deterministic controller');
  assert.deepEqual(proof.afterAirborneFailure, proof.beforeAirborneFailure, 'airborne terrain failure must freeze the entire transform for that tick');
  assert.deepEqual(proof.recoveredAirborneFault, proof.recoveredAirborneControl, 'failed airborne tick must not advance hidden flight timer/altitude state');
  assert.equal(proof.landingObserved, true, 'flight proof must reach the real landing phase');
  assert.equal(proof.landingFailureStable, true, 'landing terrain failure must not partially descend or publish a new transform');
  assert.equal(proof.landingRecoveryMatches, true, 'landing must resume deterministically after terrain recovery');
  assert.equal(proof.airbornePlayerColliderCalls, 0, 'airborne flight must continue to bypass the ground/player collider');

  assert.equal(proof.usesIdStableMapping, true, 'living-world ecology wrapping must resolve filtered controllers by object spawn id');
  assert.equal(proof.usesShiftProneIndexMapping, false, 'filtered controllers must not inherit species metadata from a shifted spawn-array index');

  console.log('CONFIGURED_CREATURE_SPAWN_GROUND_SAFETY_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
