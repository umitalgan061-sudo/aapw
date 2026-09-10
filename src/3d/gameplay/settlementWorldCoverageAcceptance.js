/**
 * Settlement world-coverage acceptance contract.
 *
 * This module is intentionally caller-owned and read-only. It does not load,
 * hydrate, mutate or attach models. Its job is to turn the evidence emitted by
 * the existing settlement/material/placement runtime into a deterministic
 * acceptance record for the complete settlement loop.
 *
 * Model-bearing runtime integrations remain responsible for using the merged
 * MaterialAssignmentCore + WorldAssetPlacementPipeline contract before scene
 * attachment. LFS pointer files are not treated as missing assets: callers may
 * report `pointer` until the actual loader has hydrated the required object.
 */

export const SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS = Object.freeze({
  services: 8,
  assets: 96,
  placements: 96,
  materials: 128,
  manifests: 96,
  evidence: 128,
  routes: 24,
  interactions: 64,
  cameras: 8,
  text: 180,
});

export const SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES = Object.freeze([
  'gate', 'market', 'tavern', 'blacksmith', 'farm', 'barracks', 'stable', 'house',
]);

export const SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_CAMERAS = Object.freeze([
  'full-world', 'settlement-far', 'settlement-center', 'settlement-northwest',
]);

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const bool = (value, fallback = false) => value === undefined ? fallback : Boolean(value);
const list = (value) => Array.isArray(value) ? value : [];
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const unique = (values) => [...new Set(list(values).map((value) => text(value)).filter(Boolean))];

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

const SERVICE_EVIDENCE = Object.freeze({
  gate: Object.freeze(['door', 'road']),
  market: Object.freeze(['vendor', 'stall']),
  tavern: Object.freeze(['interior', 'npc']),
  blacksmith: Object.freeze(['forge', 'workbench']),
  farm: Object.freeze(['field', 'barn']),
  barracks: Object.freeze(['barracks', 'training']),
  stable: Object.freeze(['stable', 'mount']),
  house: Object.freeze(['house', 'bed']),
});

const REQUIRED_MATERIAL_ROLES = Object.freeze([
  'wall', 'roof', 'wood', 'door', 'window', 'metal', 'stone-trim',
]);

const ALLOWED_ASSET_STATUS = Object.freeze([
  'ready', 'hydrated', 'loaded', 'pointer', 'missing', 'unknown',
]);

const ALLOWED_PLACEMENT_STATUS = Object.freeze([
  'validated', 'grounded', 'attached', 'blocked', 'pending', 'unknown',
]);

const ALLOWED_COVERAGE_STATUS = Object.freeze([
  'covered', 'partial', 'unobserved', 'blocked', 'unknown',
]);

const number = (value, fallback = 0) => finite(value, fallback);
const vector3 = (raw = {}) => ({
  x: number(raw?.x, 0), y: number(raw?.y, 0), z: number(raw?.z, 0),
});
const distance = (a, b) => {
  const left = vector3(a);
  const right = vector3(b);
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

function normalizeAsset(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = text(source.status, 'unknown');
  return {
    id: text(source.id ?? source.assetId),
    family: text(source.family),
    path: text(source.path),
    format: text(source.format),
    status: ALLOWED_ASSET_STATUS.includes(status) ? status : 'unknown',
    lfsPointer: bool(source.lfsPointer),
    hydrated: bool(source.hydrated) || ['ready', 'hydrated', 'loaded'].includes(status),
    bytesKnown: integer(source.bytesKnown, 0, Number.MAX_SAFE_INTEGER, 0),
    materialSlots: integer(source.materialSlots, 0, 64, 0),
    textured: bool(source.textured),
    pbr: bool(source.pbr),
    grounded: bool(source.grounded),
    placementManifestId: text(source.placementManifestId),
  };
}

function normalizeMaterial(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(source.id ?? source.materialId),
    role: text(source.role, 'unknown'),
    kind: text(source.kind, 'pbr'),
    albedo: text(source.albedo),
    normal: text(source.normal),
    roughness: text(source.roughness),
    metalness: text(source.metalness),
    ao: text(source.ao),
    textured: bool(source.textured),
    placeholder: bool(source.placeholder),
    meshCount: integer(source.meshCount, 0, 9999, 0),
    textureSize: integer(source.textureSize, 0, 16384, 0),
  };
}

function normalizePlacement(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = text(source.status, 'unknown');
  return {
    id: text(source.id ?? source.placementId),
    assetId: text(source.assetId),
    serviceId: text(source.serviceId),
    status: ALLOWED_PLACEMENT_STATUS.includes(status) ? status : 'unknown',
    manifestId: text(source.manifestId),
    materialManifestId: text(source.materialManifestId),
    position: vector3(source.position),
    groundPosition: vector3(source.groundPosition),
    expectedGroundY: number(source.expectedGroundY, 0),
    slope: number(source.slope, 0),
    scale: vector3(source.scale ?? { x: 1, y: 1, z: 1 }),
    yaw: number(source.yaw, 0),
    visible: bool(source.visible, true),
    collisionReady: bool(source.collisionReady),
    materialValidated: bool(source.materialValidated),
    grounded: bool(source.grounded),
    overlapRisk: bool(source.overlapRisk),
  };
}

function normalizeManifest(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(source.id ?? source.manifestId),
    assetId: text(source.assetId),
    serviceId: text(source.serviceId),
    materialManifestId: text(source.materialManifestId),
    status: text(source.status, 'unknown'),
    surfaceRoles: unique(source.surfaceRoles).slice(0, 32),
    materialIds: unique(source.materialIds).slice(0, 32),
    placeholderCount: integer(source.placeholderCount, 0, 999, 0),
    missingMaterialCount: integer(source.missingMaterialCount, 0, 999, 0),
    singleSurfaceRisk: bool(source.singleSurfaceRisk),
    groundAligned: bool(source.groundAligned),
    sceneAttached: bool(source.sceneAttached),
    sourceAsset: text(source.sourceAsset),
  };
}

function normalizeCamera(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const profile = text(source.profile, 'full-world');
  return {
    profile: SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_CAMERAS.includes(profile) ? profile : 'full-world',
    width: integer(source.width, 1, 8192, 1536),
    height: integer(source.height, 1, 8192, 1024),
    projection: text(source.projection, 'orthographic'),
    center: vector3(source.center),
    span: number(source.span, 0),
    readable: bool(source.readable),
    blackSkyRisk: bool(source.blackSkyRisk),
    seamRisk: bool(source.seamRisk),
    clippingRisk: bool(source.clippingRisk),
  };
}

function normalizeInteraction(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    id: text(source.id ?? source.interactionId),
    serviceId: text(source.serviceId),
    action: text(source.action),
    nodeId: text(source.nodeId),
    ok: bool(source.ok),
    reason: text(source.reason),
    sequence: integer(source.sequence, 0, 999999, 0),
    at: number(source.at, 0),
  };
}

function normalizeAll(input = {}) {
  const assets = list(input.assets).slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.assets).map(normalizeAsset).filter((asset) => asset.id);
  const materials = list(input.materials).slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.materials).map(normalizeMaterial).filter((material) => material.id);
  const placements = list(input.placements).slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.placements).map(normalizePlacement).filter((placement) => placement.id);
  const manifests = list(input.manifests).slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.manifests).map(normalizeManifest).filter((manifest) => manifest.id);
  const cameras = list(input.cameras).slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.cameras).map(normalizeCamera);
  const interactions = list(input.interactions).slice(0, SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.interactions).map(normalizeInteraction).filter((interaction) => interaction.id || interaction.action);
  return { assets, materials, placements, manifests, cameras, interactions };
}

function materialsForManifest(manifest, materials) {
  const ids = new Set(manifest.materialIds);
  return materials.filter((material) => ids.has(material.id));
}

function materialAudit(manifest, materials) {
  const referenced = materialsForManifest(manifest, materials);
  const roles = new Set(referenced.map((material) => material.role));
  const roleCoverage = Object.fromEntries(REQUIRED_MATERIAL_ROLES.map((role) => [role, roles.has(role)]));
  const placeholder = referenced.filter((material) => material.placeholder).length;
  const textured = referenced.filter((material) => material.textured && material.textureSize > 0).length;
  const pbr = referenced.filter((material) => material.kind === 'pbr' && material.textured).length;
  const singleSurface = manifest.singleSurfaceRisk || (referenced.length <= 1 && manifest.surfaceRoles.length > 1);
  return {
    referenced: referenced.length,
    roles: roleCoverage,
    roleCount: roles.size,
    placeholderCount: placeholder + manifest.placeholderCount,
    texturedCount: textured,
    pbrCount: pbr,
    missingRoleCount: REQUIRED_MATERIAL_ROLES.filter((role) => !roles.has(role)).length,
    singleSurfaceRisk: singleSurface,
    valid: placeholder === 0 && manifest.missingMaterialCount === 0 && !singleSurface,
  };
}

function placementAudit(placement, manifest) {
  const verticalError = Math.abs(placement.position.y - placement.groundPosition.y);
  const expectedError = Math.abs(placement.groundPosition.y - placement.expectedGroundY);
  const grounded = placement.grounded || manifest?.groundAligned === true;
  const manifestAligned = manifest?.id === placement.manifestId;
  const materialAligned = manifest?.materialManifestId === placement.materialManifestId || !placement.materialManifestId;
  const scaleValid = [placement.scale.x, placement.scale.y, placement.scale.z].every((value) => value > 0 && value <= 50);
  const slopeValid = placement.slope >= 0 && placement.slope <= 75;
  const visibleFailure = placement.visible && !grounded && placement.status === 'attached';
  return {
    verticalError,
    expectedError,
    grounded,
    manifestAligned,
    materialAligned,
    scaleValid,
    slopeValid,
    overlapRisk: placement.overlapRisk,
    visibleFailure,
    collisionReady: placement.collisionReady,
    valid: grounded && manifestAligned && materialAligned && scaleValid && slopeValid && !placement.overlapRisk && !visibleFailure,
  };
}

function serviceCoverage(serviceId, assets, manifests, placements) {
  const expected = SERVICE_EVIDENCE[serviceId] ?? [];
  const relevantManifests = manifests.filter((manifest) => manifest.serviceId === serviceId);
  const relevantAssets = assets.filter((asset) => asset.placementManifestId && relevantManifests.some((manifest) => manifest.id === asset.placementManifestId));
  const evidence = expected.map((token) => {
    const asset = relevantAssets.find((candidate) => candidate.id.toLowerCase().includes(token));
    const manifest = relevantManifests.find((candidate) => candidate.assetId === asset?.id || candidate.id.toLowerCase().includes(token));
    return { id: token, ok: Boolean(asset || manifest), assetId: asset?.id ?? '', manifestId: manifest?.id ?? '', assetStatus: asset?.status ?? 'missing' };
  });
  const servicePlacements = placements.filter((placement) => placement.serviceId === serviceId);
  return {
    serviceId,
    status: evidence.every((item) => item.ok) ? 'covered' : (relevantManifests.length || relevantAssets.length || servicePlacements.length) ? 'partial' : 'unobserved',
    evidence,
    assets: relevantAssets.length,
    manifests: relevantManifests.length,
    placements: servicePlacements.length,
    groundedPlacements: servicePlacements.filter((placement) => placement.grounded).length,
    attachedPlacements: servicePlacements.filter((placement) => placement.status === 'attached').length,
  };
}

function cameraAudit(cameras) {
  const profiles = new Map(cameras.map((camera) => [camera.profile, camera]));
  const missing = SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_CAMERAS.filter((profile) => !profiles.has(profile));
  const invalid = cameras.filter((camera) => camera.projection !== 'orthographic' || camera.width < 1 || camera.height < 1 || camera.blackSkyRisk || camera.seamRisk || camera.clippingRisk);
  const expectedDimensions = cameras.filter((camera) => camera.width === 1536 && camera.height === 1024).length;
  return {
    count: cameras.length,
    missingProfiles: missing,
    invalidCount: invalid.length,
    expectedDimensions,
    readableCount: cameras.filter((camera) => camera.readable).length,
    valid: missing.length === 0 && invalid.length === 0 && expectedDimensions >= 1,
  };
}

function interactionAudit(interactions) {
  const services = new Set(interactions.map((interaction) => interaction.serviceId).filter(Boolean));
  const failed = interactions.filter((interaction) => !interaction.ok);
  const ordered = interactions.every((interaction, index) => index === 0 || interaction.sequence >= interactions[index - 1].sequence);
  return {
    count: interactions.length,
    uniqueServices: services.size,
    failedCount: failed.length,
    lastFailure: failed.length ? clone(failed[failed.length - 1]) : null,
    monotonicSequence: ordered,
    valid: ordered && failed.length === 0,
  };
}

function manifestAudit(manifests, materials) {
  const rows = manifests.map((manifest) => {
    const audit = materialAudit(manifest, materials);
    return { id: manifest.id, serviceId: manifest.serviceId, ...audit, status: manifest.status, grounded: manifest.groundAligned, attached: manifest.sceneAttached };
  });
  return {
    count: rows.length,
    invalidCount: rows.filter((row) => !row.valid).length,
    placeholderCount: rows.reduce((sum, row) => sum + row.placeholderCount, 0),
    missingMaterialCount: manifests.reduce((sum, manifest) => sum + manifest.missingMaterialCount, 0),
    singleSurfaceRiskCount: rows.filter((row) => row.singleSurfaceRisk).length,
    rows,
  };
}

function placementAuditSet(placements, manifests) {
  const rows = placements.map((placement) => {
    const manifest = manifests.find((candidate) => candidate.id === placement.manifestId);
    return { id: placement.id, serviceId: placement.serviceId, assetId: placement.assetId, ...placementAudit(placement, manifest) };
  });
  return {
    count: rows.length,
    invalidCount: rows.filter((row) => !row.valid).length,
    floatingCount: rows.filter((row) => row.verticalError > 0.15 || !row.grounded).length,
    overlapCount: rows.filter((row) => row.overlapRisk).length,
    rows,
  };
}

function acceptanceFlags(model) {
  return {
    noMissingAssets: model.assets.filter((asset) => asset.status === 'missing').length === 0,
    noPlaceholderMaterials: model.manifests.placeholderCount === 0,
    noMissingMaterials: model.manifests.missingMaterialCount === 0,
    noSingleSurfaceRisk: model.manifests.singleSurfaceRiskCount === 0,
    noPlacementRisk: model.placements.invalidCount === 0,
    camerasValid: model.cameras.valid,
    interactionsValid: model.interactions.valid,
    servicesCovered: model.services.every((row) => row.status === 'covered'),
  };
}

function scoreFlags(flags) {
  const values = Object.values(flags).map(Boolean);
  return values.length ? Math.round((values.filter(Boolean).length / values.length) * 100) / 100 : 0;
}

export function createSettlementWorldCoverageAcceptance(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = normalizeAll(source);
  const model = {
    version: SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_VERSION,
    settlementId: text(source.settlementId, 'settlement'),
    assets: normalized.assets,
    manifests: manifestAudit(normalized.manifests, normalized.materials),
    placements: placementAuditSet(normalized.placements, normalized.manifests),
    services: SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES.map((serviceId) => serviceCoverage(serviceId, normalized.assets, normalized.manifests, normalized.placements)),
    cameras: cameraAudit(normalized.cameras),
    interactions: interactionAudit(normalized.interactions),
    materials: {
      count: normalized.materials.length,
      texturedCount: normalized.materials.filter((material) => material.textured && material.textureSize > 0).length,
      pbrCount: normalized.materials.filter((material) => material.kind === 'pbr').length,
      placeholderCount: normalized.materials.filter((material) => material.placeholder).length,
      roleCount: new Set(normalized.materials.map((material) => material.role).filter(Boolean)).size,
    },
  };
  model.flags = acceptanceFlags(model);
  model.score = scoreFlags(model.flags);
  model.status = model.score === 1 ? 'green' : model.score >= 0.75 ? 'warning' : 'blocked';
  model.fingerprint = digest({ version:model.version, settlementId:model.settlementId, assets:model.assets, manifests:model.manifests, placements:model.placements, services:model.services, cameras:model.cameras, interactions:model.interactions, flags:model.flags });
  return deepFreeze(model);
}

export function validateSettlementWorldCoverageAcceptance(input = {}) {
  const result = createSettlementWorldCoverageAcceptance(input);
  const errors = [];
  if (result.assets.length > SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.assets) errors.push('asset-limit-exceeded');
  if (result.manifests.count > SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.manifests) errors.push('manifest-limit-exceeded');
  if (result.placements.count > SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.placements) errors.push('placement-limit-exceeded');
  if (result.services.length !== SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_LIMITS.services) errors.push('service-count');
  for (const row of result.services) {
    if (!ALLOWED_COVERAGE_STATUS.includes(row.status)) errors.push(`invalid-service-status:${row.serviceId}`);
  }
  if (!result.interactions.monotonicSequence) errors.push('interaction-sequence');
  return deepFreeze({ ok: errors.length === 0, errors, status: result.status, score: result.score, fingerprint: result.fingerprint });
}

export function createSettlementWorldCoverageProof(input = {}) {
  const acceptance = createSettlementWorldCoverageAcceptance(input);
  const proof = {
    version: SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_VERSION,
    settlementId: acceptance.settlementId,
    generatedAt: finite(input.generatedAt, 0),
    acceptance: {
      status: acceptance.status,
      score: acceptance.score,
      flags: clone(acceptance.flags),
      fingerprint: acceptance.fingerprint,
    },
    serviceProof: acceptance.services.map((service) => ({
      serviceId: service.serviceId,
      status: service.status,
      evidence: clone(service.evidence),
      placementCount: service.placements,
      groundedPlacements: service.groundedPlacements,
      attachedPlacements: service.attachedPlacements,
    })),
    visualProof: {
      cameras: clone(acceptance.cameras),
      requiredProfiles: [...SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_CAMERAS],
      expectedResolution: { width: 1536, height: 1024 },
    },
    materialProof: clone(acceptance.manifests),
    placementProof: clone(acceptance.placements),
    assetProof: {
      total: acceptance.assets.length,
      missing: acceptance.assets.filter((asset) => asset.status === 'missing').length,
      pointers: acceptance.assets.filter((asset) => asset.status === 'pointer').length,
      hydrated: acceptance.assets.filter((asset) => asset.hydrated).length,
    },
  };
  proof.fingerprint = digest(proof);
  return deepFreeze(proof);
}

export const SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_VERSION,
  services: [...SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_SERVICES],
  cameras: [...SETTLEMENT_WORLD_COVERAGE_ACCEPTANCE_CAMERAS],
  materialRoles: [...REQUIRED_MATERIAL_ROLES],
  assetStatuses: [...ALLOWED_ASSET_STATUS],
  placementStatuses: [...ALLOWED_PLACEMENT_STATUS],
});
