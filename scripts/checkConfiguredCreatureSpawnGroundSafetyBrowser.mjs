#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async () => {
    const { spawnConfiguredCreatures } = await import('/src/3d/gameplay/creatureBrain.js');
    const { scatterCreatures } = await import('/src/3d/gameplay/creatureSpawner.js');
    const { mulberry32 } = await import('/src/3d/world/terrain.js');

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
      x: controller.object3D.position.x,
      y: controller.object3D.position.y,
      z: controller.object3D.position.z,
      finite: [controller.object3D.position.x, controller.object3D.position.y, controller.object3D.position.z].every(Number.isFinite),
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

  assert.equal(proof.usesIdStableMapping, true, 'living-world ecology wrapping must resolve filtered controllers by object spawn id');
  assert.equal(proof.usesShiftProneIndexMapping, false, 'filtered controllers must not inherit species metadata from a shifted spawn-array index');

  console.log('CONFIGURED_CREATURE_SPAWN_GROUND_SAFETY_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
