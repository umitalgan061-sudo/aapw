import assert from 'node:assert/strict';
import {
  LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY,
  classifyGeographicSurfaceContext,
  geographicSurfaceAcceptance,
  geographicSurfaceDigest,
  resolveLivingWorldActorSurfaceProfile,
  summarizeGeographicSurfaceAudit,
  validateGeographicActorSurfaceContext,
} from '../src/3d/gameplay/livingWorldGeographicSurfaceContract.js';

const seats = [{ x: 100, z: 100 }];
const roads = [{ points: [{ x: -100, z: 0 }, { x: 100, z: 0 }] }];
const edge = classifyGeographicSurfaceContext({ position: { x: 80, z: 20 }, slopeDegrees: 7, waterDepth: 0, settlementSeats: seats, roadEdges: roads, moisture: 0.4, region: 'reach' });
assert.equal(edge.ok, true);
assert.equal(edge.region, 'reach');
assert.ok(['settlement-edge', 'road-corridor', 'wilderness', 'open-field'].includes(edge.zone));

const riparian = classifyGeographicSurfaceContext({ position: { x: 300, z: 300 }, slopeDegrees: 4, waterDepth: 0.10, settlementSeats: seats, roadEdges: roads, moisture: 0.1, region: 'temperate' });
assert.equal(riparian.zone, 'riparian');

const steep = classifyGeographicSurfaceContext({ position: { x: 300, z: 300 }, slopeDegrees: 32, waterDepth: 0, region: 'mountain' });
assert.equal(steep.zone, 'steep-exposure');

const profile = resolveLivingWorldActorSurfaceProfile({
  worldX: 10, worldZ: 20, role: 'guard', groundHeight: 40, slopeDegrees: 6, waterDepth: 0,
  settlementSeats: [{ x: 1000, z: 1000 }], roadEdges: [], moisture: 0.3, seed: 123,
});
assert.ok(profile.region);
assert.ok(profile.materialRoles.assetCandidates.length > 0);
assert.ok(profile.materialRoles.surfaceRoles.includes('skin'));
assert.ok(profile.placement.requireSurfaceContext);

const contract = validateGeographicActorSurfaceContext({ profile });
assert.equal(contract.ok, true, contract.errors.join(','));
assert.equal(contract.policyId, LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.id);

const rejected = validateGeographicActorSurfaceContext({ profile, maxSlopeDegrees: 4 });
assert.equal(rejected.ok, false);
assert.ok(rejected.errors.includes('slope-limit'));

const audit = summarizeGeographicSurfaceAudit({
  ok: true,
  profile,
  manifest: { material: { audit: { semanticCoverage: 1, texturedMaterialRatio: 1, missingRoles: [] } } },
  errors: [],
});
assert.equal(audit.region, profile.region);
assert.equal(audit.semanticCoverage, 1);
assert.deepEqual(geographicSurfaceAcceptance({
  ok: true,
  profile,
  manifest: { material: { audit: { semanticCoverage: 1, texturedMaterialRatio: 1, missingRoles: [] } } },
  errors: [],
}).pass, true);
assert.equal(geographicSurfaceDigest({ profile, manifest: { asset: { src: 'assets/models/characters/dreyar.fbx' }, material: { roles: ['skin', 'clothing'] } } }), geographicSurfaceDigest({ profile, manifest: { asset: { src: 'assets/models/characters/dreyar.fbx' }, material: { roles: ['skin', 'clothing'] } } }));

console.log(JSON.stringify({ ok: true, policy: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.id, region: profile.region, zone: profile.surface.zone }));
console.log('LIVING_WORLD_GEOGRAPHIC_SURFACE_CONTRACT_PASS');
