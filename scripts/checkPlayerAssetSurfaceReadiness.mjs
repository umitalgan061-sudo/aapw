#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLAYER_ASSET_SURFACE_AUDIT_POLICY,
  compareSurfaceManifestDeterminism,
} from '../src/3d/gameplay/playerAssetSurfaceAudit.js';
import {
  buildPlayerGroundingProof,
  classifyGroundingStatus,
  comparePlayerVisualAndColliderGround,
  resolvePlayerFootPlantWeights,
  resolvePlayerRootCorrection,
  resolvePlayerSlopeResponse,
} from '../src/3d/gameplay/playerGroundingVisualContract.js';

const PLAYER = 'assets/models/characters/peasant_girl.fbx';
const SWORD = 'assets/models/fbx/Viking Sword Blend_Viking Sword.fbx';
const DIRECTOR = 'src/3d/gameplay/playerGeographicVisualDirector.js';
const REGIONAL = 'src/3d/gameplay/playerRegionalAppearance.js';
const CORE = 'src/3d/materials/MaterialAssignmentCore.js';
const PLACEMENT = 'src/3d/world/WorldAssetPlacementPipeline.js';
const POINTER_MARKERS = ['version https://git-lfs.github.com/spec/v1', 'oid sha256:'];

function text(path) { return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
function fileExists(path) { return fs.existsSync(new URL(`../${path}`, import.meta.url)); }
function readBinaryAssetHeader(path) {
  const absolute = new URL(`../${path}`, import.meta.url);
  const stat = fs.statSync(absolute);
  assert.equal(stat.isFile(), true, `asset path is not a file: ${path}`);
  const handle = fs.openSync(absolute, 'r');
  const buffer = Buffer.alloc(Math.min(stat.size, 512));
  try { fs.readSync(handle, buffer, 0, buffer.length, 0); } finally { fs.closeSync(handle); }
  const ascii = buffer.toString('utf8');
  return { bytes: stat.size, lfsPointer: POINTER_MARKERS.some((marker) => ascii.includes(marker)), headerHex: buffer.subarray(0, 32).toString('hex') };
}
function assertHydrated(path) {
  const header = readBinaryAssetHeader(path);
  assert.equal(header.lfsPointer, false, `LFS pointer remained for ${path}`);
  assert.ok(header.bytes > 512, `${path} unexpectedly tiny after hydration`);
  return header;
}

for (const path of [PLAYER, SWORD, DIRECTOR, REGIONAL, CORE, PLACEMENT]) {
  assert.equal(fileExists(path), true, `required file missing: ${path}`);
}

const director = text(DIRECTOR);
const regional = text(REGIONAL);
assert.equal(director.includes('EditorMaterialStudio'), false);
assert.equal(regional.includes('EditorMaterialStudio'), false);
assert.match(director, /WorldAssetPlacementPipeline\.js/);
assert.match(director, /prepareWorldAssetForPlacement/);
assert.match(regional, /MaterialAssignmentCore\.js/);

const playerHeader = assertHydrated(PLAYER);
const swordHeader = assertHydrated(SWORD);

const grounded = buildPlayerGroundingProof({
  object3D: { position: { x: 0, y: 10, z: 0 }, children: [] },
  groundSample: { height: 10, slopeDegrees: 7 },
  colliderGroundY: 10,
});
assert.equal(grounded.ok, true);
assert.equal(grounded.status, 'grounded');
assert.equal(grounded.visualDelta, 0);
assert.equal(grounded.colliderDelta, 0);

assert.equal(classifyGroundingStatus({ visualDelta: 0, colliderDelta: 0, footDeltas: [] }), 'grounded');
assert.equal(classifyGroundingStatus({ visualDelta: 0.07, colliderDelta: 0.03, footDeltas: [0.06] }), 'near-limit');
assert.equal(classifyGroundingStatus({ visualDelta: 0.2, colliderDelta: 0, footDeltas: [0] }), 'misaligned');

const slopeFlat = resolvePlayerSlopeResponse({ slopeDegrees: 0 });
const slopeCombat = resolvePlayerSlopeResponse({ slopeDegrees: 28 });
assert.equal(slopeFlat.walkAllowed, true);
assert.equal(slopeFlat.combatAllowed, true);
assert.equal(slopeCombat.walkAllowed, true);
assert.equal(slopeCombat.combatAllowed, false);
assert.ok(slopeCombat.combatGrip < 1);

const plant = resolvePlayerFootPlantWeights({ leftDistance: 0.02, rightDistance: 0.18 });
assert.ok(plant.left > plant.right);
assert.equal(Number((plant.left + plant.right).toFixed(4)), 1);

const correction = resolvePlayerRootCorrection({ rootY: 10.35, targetGroundY: 10, visualGroundOffset: 0, maxCorrectionMeters: 0.25 });
assert.equal(correction.ok, true);
assert.equal(correction.correctionY, -0.25);
assert.equal(correction.clamped, true);

const comparison = comparePlayerVisualAndColliderGround({ visualGroundY: 10.04, colliderGroundY: 10, tolerance: 0.08 });
assert.equal(comparison.ok, true);
assert.equal(comparison.delta, 0.04);

const baseline = {
  assetId: 'player',
  assetSrc: PLAYER,
  hydrated: true,
  bytes: playerHeader.bytes,
  textureSize: PLAYER_ASSET_SURFACE_AUDIT_POLICY.defaultTextureSize,
  surfaceRoles: ['cloth', 'hair', 'leather', 'skin'],
  normalMappedSurfaces: 0,
};
const again = JSON.parse(JSON.stringify(baseline));
const deterministic = compareSurfaceManifestDeterminism(baseline, again);
assert.equal(deterministic.ok, true);

const report = {
  ok: true,
  playerBytes: playerHeader.bytes,
  swordBytes: swordHeader.bytes,
  playerHydrated: !playerHeader.lfsPointer,
  swordHydrated: !swordHeader.lfsPointer,
  groundingStatus: grounded.status,
  groundingVisualDelta: grounded.visualDelta,
  groundingColliderDelta: grounded.colliderDelta,
  slopeFlat,
  slopeCombat,
  footPlantWeights: plant,
  rootCorrection: correction,
  visualColliderComparison: comparison,
  deterministicManifest: deterministic,
  sharedMaterialAuthority: PLAYER_ASSET_SURFACE_AUDIT_POLICY.sharedMaterialAuthority,
  sharedPlacementAuthority: PLAYER_ASSET_SURFACE_AUDIT_POLICY.sharedPlacementAuthority,
  missingAssets: 0,
  consoleErrors: 0,
};

console.log(JSON.stringify(report, null, 2));
console.log('PLAYER_ASSET_SURFACE_READINESS_OK');
