#!/usr/bin/env node
import assert from 'node:assert/strict';
import { BIOME_ASSET_RUNTIME_ADAPTER_POLICY, mapContextToWorld, mapWorldToContext, roundTripCanonicalWorldPosition, createPlayerGeographicAppearanceContext } from '../src/3d/world/biomeAssetRuntimeAdapter.js';
import { BIOME_ASSET_DISTRIBUTION_POLICY } from '../src/3d/world/biomeAssetDistribution.js';

const bounds = { minX: 0, maxX: 1536, minY: 0, maxY: 1024 };
assert.equal(BIOME_ASSET_RUNTIME_ADAPTER_POLICY.deterministic, true);
assert.equal(BIOME_ASSET_RUNTIME_ADAPTER_POLICY.canonicalMapAuthority, 'worldReferenceMap.js');
assert.equal(BIOME_ASSET_RUNTIME_ADAPTER_POLICY.alignmentAuthority, 'worldReferenceAlignment.js');
assert.equal(BIOME_ASSET_RUNTIME_ADAPTER_POLICY.materialAuthority, 'MaterialAssignmentCore.js');
assert.equal(BIOME_ASSET_RUNTIME_ADAPTER_POLICY.placementAuthority, 'WorldAssetPlacementPipeline.js');
assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.deterministic, true);
const roundTrip = roundTripCanonicalWorldPosition({ normalizedX: 0.66, normalizedY: 0.68, mapBounds: bounds, metersPerMapUnit: 2 });
assert.ok(roundTrip.error.x < 1e-12 && roundTrip.error.y < 1e-12);
const world = mapContextToWorld({ normalizedReference: { x: 0.5, y: 0.5 } }, bounds, 2);
assert.deepEqual(world, { x: 0, z: 0 });
const reverse = mapWorldToContext(world.x, world.z, bounds, 2, 'seam', 'vegetation');
assert.deepEqual(reverse.normalized, { x: 0.5, y: 0.5 });
const terrain = () => 20;
const player = createPlayerGeographicAppearanceContext({ normalizedX: 0.145, normalizedY: 0.115, seed: 'player' });
assert.equal(player.kind, 'player-appearance');
assert.ok(player.profileId);
assert.equal(player.material.textureSize, 256);
console.log(JSON.stringify({ ok: true, policyId: BIOME_ASSET_RUNTIME_ADAPTER_POLICY.id, profileId: player.profileId, roundTrip: roundTrip.error }));
console.log('BIOME_ASSET_RUNTIME_ADAPTER_OK');
