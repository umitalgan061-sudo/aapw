import { buildSettlementWorldCoverageRuntimeProof } from '../src/3d/gameplay/settlementWorldCoverageRuntimeAdapter.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runtime = {
  settlementId: 'canonical-settlement',
  snapshot: () => ({ insideSettlement: true, serviceId: 'market', health: 100, fatigue: 0 }),
  getAssetEvidence: () => [
    { id: 'market-vendor', family: 'settlements', assetId: 'market-vendor', status: 'ready', materialSlots: 4, textured: true, grounded: true, lfsPointer: false },
    { id: 'market-stall', family: 'settlements', assetId: 'market-stall', status: 'pointer', materialSlots: 2, textured: true, grounded: true, lfsPointer: true },
  ],
  getMaterialEvidence: () => [
    { assetId: 'market-vendor', placeholder: false, missing: false, pbr: true, textureSize: 2048, surfaceRoles: ['wall', 'wood', 'metal'] },
    { assetId: 'market-stall', placeholder: false, missing: false, pbr: true, textureSize: 1024, surfaceRoles: ['wood', 'stone'] },
  ],
  getPlacementEvidence: () => [
    { assetId: 'market-vendor', grounded: true, invalid: false, groundError: 0.01, slope: 2, scale: 1 },
    { assetId: 'market-stall', grounded: true, invalid: false, groundError: 0.02, slope: 1, scale: 1 },
  ],
  getMaterialManifests: () => [
    { assetId: 'market-vendor', materialManifestId: 'mat-market-vendor', placementManifestId: 'place-market-vendor' },
    { assetId: 'market-stall', materialManifestId: 'mat-market-stall', placementManifestId: 'place-market-stall' },
  ],
  getCameraEvidence: () => [
    { profile: 'settlement-near', width: 1536, height: 1024, valid: true },
  ],
  getInteractionEvidence: () => [
    { sequence: 1, action: 'enter', ok: true },
    { sequence: 2, action: 'trade', ok: true },
  ],
};

const first = buildSettlementWorldCoverageRuntimeProof(runtime);
const second = buildSettlementWorldCoverageRuntimeProof(runtime);

assert(first.settlementId === 'canonical-settlement', 'settlement id must remain canonical');
assert(first.fingerprint === second.fingerprint, 'proof fingerprint must be deterministic');
assert(first.acceptance && first.proof, 'acceptance and proof must be present');
assert(first.acceptance.fingerprint && first.proof.fingerprint, 'acceptance/proof fingerprints must be present');
assert(first.proof.assetSummary?.pointerCount === 1, 'LFS pointer evidence must remain classified as pointer');
assert(first.proof.assetSummary?.missingCount === 0, 'ready/pointer assets must not be counted as missing');
assert(first.proof.materialSummary?.placeholderCount === 0, 'material evidence must reject placeholders');
assert(first.proof.placementSummary?.invalidCount === 0, 'grounded placements must remain valid');
assert(Object.isFrozen(first) && Object.isFrozen(first.acceptance), 'proof output must be frozen');

console.log('SETTLEMENT_WORLD_COVERAGE_EVIDENCE_QUALITY_OK', JSON.stringify({ fingerprint: first.fingerprint, assetSummary: first.proof.assetSummary, materialSummary: first.proof.materialSummary, placementSummary: first.proof.placementSummary }));
