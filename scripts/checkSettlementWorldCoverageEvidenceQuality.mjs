import { buildSettlementWorldCoverageRuntimeProof } from '../src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runtime = {
  settlementId: 'canonical-settlement',
  snapshot: () => ({ insideSettlement: true, serviceId: 'market', health: 100, fatigue: 0 }),
  getAssetEvidence: () => [
    { id: 'market-vendor', family: 'settlements', assetId: 'market-vendor', status: 'ready', materialSlots: 4, textured: true, grounded: true, lfsPointer: false, placementManifestId: 'place-market-vendor' },
    { id: 'market-stall', family: 'settlements', assetId: 'market-stall', status: 'pointer', materialSlots: 2, textured: true, grounded: true, lfsPointer: true, placementManifestId: 'place-market-stall' },
  ],
  getMaterialEvidence: () => [
    { id: 'mat-vendor-wall', kind: 'pbr', textured: true, textureSize: 2048, role: 'wall', placeholder: false },
    { id: 'mat-vendor-wood', kind: 'pbr', textured: true, textureSize: 2048, role: 'wood', placeholder: false },
  ],
  getPlacementEvidence: () => [
    { id: 'placement-vendor', assetId: 'market-vendor', serviceId: 'market', manifestId: 'place-market-vendor', grounded: true, status: 'grounded', position: { x: 0, y: 0, z: 0 }, groundPosition: { x: 0, y: 0, z: 0 }, expectedGroundY: 0, slope: 2, scale: { x: 1, y: 1, z: 1 }, overlapRisk: false },
    { id: 'placement-stall', assetId: 'market-stall', serviceId: 'market', manifestId: 'place-market-stall', grounded: true, status: 'grounded', position: { x: 1, y: 0, z: 0 }, groundPosition: { x: 1, y: 0, z: 0 }, expectedGroundY: 0, slope: 1, scale: { x: 1, y: 1, z: 1 }, overlapRisk: false },
  ],
  getMaterialManifests: () => [
    { id: 'place-market-vendor', assetId: 'market-vendor', serviceId: 'market', materialManifestId: 'mat-market-vendor', materialIds: ['mat-vendor-wall', 'mat-vendor-wood'], placeholderCount: 0, missingMaterialCount: 0, singleSurfaceRisk: false, groundAligned: true, sceneAttached: true },
    { id: 'place-market-stall', assetId: 'market-stall', serviceId: 'market', materialManifestId: 'mat-market-stall', materialIds: ['mat-vendor-wall', 'mat-vendor-wood'], placeholderCount: 0, missingMaterialCount: 0, singleSurfaceRisk: false, groundAligned: true, sceneAttached: true },
  ],
  getCameraEvidence: () => [
    { profile: 'full-world', width: 1536, height: 1024, projection: 'orthographic', readable: true },
    { profile: 'settlement-far', width: 1536, height: 1024, projection: 'orthographic', readable: true },
    { profile: 'settlement-center', width: 1536, height: 1024, projection: 'orthographic', readable: true },
    { profile: 'settlement-northwest', width: 1536, height: 1024, projection: 'orthographic', readable: true },
  ],
  getInteractionEvidence: () => [
    { id: 'i1', serviceId: 'gate', action: 'enter', ok: true, sequence: 1 },
    { id: 'i2', serviceId: 'market', action: 'trade', ok: true, sequence: 2 },
  ],
};

const first = buildSettlementWorldCoverageRuntimeProof(runtime);
const second = buildSettlementWorldCoverageRuntimeProof(runtime);

assert(first.settlementId === 'canonical-settlement', 'settlement id must remain canonical');
assert(first.fingerprint === second.fingerprint, 'proof fingerprint must be deterministic');
assert(first.acceptance && first.proof, 'acceptance and proof must be present');
assert(first.acceptance.fingerprint && first.proof.fingerprint, 'acceptance/proof fingerprints must be present');
assert(first.acceptance.manifests.placeholderCount === 0, 'manifest placeholder count must be zero');
assert(first.acceptance.manifests.missingMaterialCount === 0, 'missing material count must be zero');
assert(first.acceptance.placements.invalidCount === 0, 'grounded placements must remain valid');
assert(first.acceptance.cameras.valid === true, 'camera evidence must be valid');
assert(Object.isFrozen(first) && Object.isFrozen(first.acceptance), 'proof output must be frozen');

console.log('SETTLEMENT_WORLD_COVERAGE_EVIDENCE_QUALITY_OK', JSON.stringify({ fingerprint: first.fingerprint, manifestSummary: first.acceptance.manifests, placementSummary: first.acceptance.placements }));
