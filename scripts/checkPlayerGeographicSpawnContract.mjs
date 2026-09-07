#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAYER_GEOGRAPHIC_SPAWN_POLICY,
  applyPlayerGeographicSpawn,
  auditPlayerGeographicSpawn,
  buildPlayerGeographicSpawnProof,
  resolvePlayerGeographicSpawn,
} from '../src/3d/gameplay/playerGeographicSpawnContract.js';

const SPAWN = { x: 128, z: -256 };
const MAP_BOUNDS = { minX: 0, maxX: 1536, minY: 0, maxY: 1024 };
const MPM = 1;

const source = fs.readFileSync(new URL('../src/3d/gameplay/playerGeographicSpawnContract.js', import.meta.url), 'utf8');
assert.match(source, /worldXZToCanonicalMap/);
assert.match(source, /getGroundHeight/);
assert.match(source, /playerGeographicSpawn/);
assert.equal(source.includes('EditorMaterialStudio'), false);

const groundCollider = {
  getGroundHeight(x, z) {
    return 12 + x * 0.001 - z * 0.0005;
  },
};
const playerCollider = {
  getGroundHeight(x, z) {
    return 12 + x * 0.001 - z * 0.0005;
  },
};

const resolution = resolvePlayerGeographicSpawn({
  spawn: SPAWN,
  mapBounds: MAP_BOUNDS,
  metersPerMapUnit: MPM,
  groundCollider,
  playerCollider,
});
assert.equal(resolution.ok, true);
assert.equal(resolution.spawn.x, SPAWN.x);
assert.equal(resolution.spawn.z, SPAWN.z);
assert.ok(resolution.normalized.x >= 0 && resolution.normalized.x <= 1);
assert.ok(resolution.normalized.y >= 0 && resolution.normalized.y <= 1);
assert.equal(resolution.ground.height, resolution.collider.height);
assert.equal(resolution.colliderDelta, 0);

const object3D = { position: { x: 0, y: 0, z: 0 }, userData: {} };
const applied = applyPlayerGeographicSpawn(object3D, resolution);
assert.equal(applied.ok, true);
assert.equal(object3D.position.x, SPAWN.x);
assert.equal(object3D.position.z, SPAWN.z);
assert.equal(object3D.position.y, resolution.rootY);
assert.equal(object3D.userData.playerGeographicSpawn.normalizedX, resolution.normalized.x);

const audit = auditPlayerGeographicSpawn(object3D, { groundCollider, playerCollider });
assert.equal(audit.ok, true);
assert.equal(audit.errors.length, 0);
assert.ok(audit.ground?.ok);
assert.ok(audit.collider?.ok);

const proof = buildPlayerGeographicSpawnProof(object3D, { groundCollider, playerCollider });
assert.equal(proof.ok, true);
assert.equal(proof.spawn.worldX, SPAWN.x);
assert.equal(proof.spawn.worldZ, SPAWN.z);
assert.equal(proof.spawn.colliderDelta, 0);
assert.equal(proof.missingAssets, 0);
assert.equal(proof.consoleErrors, 0);

const noCollider = resolvePlayerGeographicSpawn({ spawn: SPAWN, mapBounds: MAP_BOUNDS, metersPerMapUnit: MPM, groundCollider: null });
assert.throws(() => noCollider, /groundCollider/);

const badSlope = resolvePlayerGeographicSpawn({
  spawn: SPAWN,
  mapBounds: MAP_BOUNDS,
  metersPerMapUnit: MPM,
  groundCollider: { getGroundSample: () => ({ height: 12, slopeDegrees: 70 }) },
});
assert.equal(badSlope.ok, false);
assert.match(badSlope.error, /spawn-slope-out-of-contract/);

const badCollider = resolvePlayerGeographicSpawn({
  spawn: SPAWN,
  mapBounds: MAP_BOUNDS,
  metersPerMapUnit: MPM,
  groundCollider,
  playerCollider: { getGroundHeight: () => 19 },
});
assert.equal(badCollider.ok, false);
assert.match(badCollider.error, /spawn-collider-delta/);

const driftedObject = { position: { x: SPAWN.x + 0.2, y: resolution.rootY + 0.2, z: SPAWN.z }, userData: { playerGeographicSpawn: object3D.userData.playerGeographicSpawn } };
const driftAudit = auditPlayerGeographicSpawn(driftedObject, { groundCollider, playerCollider });
assert.equal(driftAudit.ok, false);
assert.ok(driftAudit.errors.some((error) => /spawn-x-drift/.test(error)));
assert.ok(driftAudit.errors.some((error) => /spawn-ground-drift/.test(error)));

assert.equal(PLAYER_GEOGRAPHIC_SPAWN_POLICY.canonicalMapRequired, true);
assert.equal(PLAYER_GEOGRAPHIC_SPAWN_POLICY.terrainOwnerUnchanged, true);
assert.equal(PLAYER_GEOGRAPHIC_SPAWN_POLICY.colliderOwnerUnchanged, true);
assert.equal(PLAYER_GEOGRAPHIC_SPAWN_POLICY.groundToleranceMeters, 0.08);

const report = {
  ok: true,
  version: PLAYER_GEOGRAPHIC_SPAWN_POLICY.version,
  spawn: resolution.spawn,
  normalized: resolution.normalized,
  groundY: resolution.ground.height,
  colliderY: resolution.collider.height,
  colliderDelta: resolution.colliderDelta,
  auditOk: audit.ok,
  proofOk: proof.ok,
  badSlopeRejected: !badSlope.ok,
  badColliderRejected: !badCollider.ok,
  driftRejected: !driftAudit.ok,
  missingAssets: 0,
  consoleErrors: 0,
};

console.log(JSON.stringify(report, null, 2));
console.log('PLAYER_GEOGRAPHIC_SPAWN_CONTRACT_OK');
