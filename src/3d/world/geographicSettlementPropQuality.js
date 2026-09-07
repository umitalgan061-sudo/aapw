import * as THREE from 'three';
import { validateMaterialAssignment } from '../materials/MaterialAssignmentCore.js';

/**
 * Runtime quality/context layer for the geographic settlement fringe prop slice.
 * This is intentionally an audit + semantic decoration layer, not a second placement framework.
 * Candidate generation remains owned by geographicSettlementProps.js and surface/material authority
 * remains owned by MaterialAssignmentCore + WorldAssetPlacementPipeline.
 */

export const GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY = Object.freeze({
  version: 1,
  id: 'settlement-fringe-geographic-prop-quality-2026-09-07-v1',
  ringMeters: Object.freeze({ min: 162, max: 204 }),
  minSpacingMeters: 13,
  roadBandsMeters: Object.freeze({ frontage: 14, near: 30, remote: 999999 }),
  biomeTransitionFloor: 0.12,
  requireManifest: true,
  requireWorldPlacementGate: true,
  allowAuthoredPbrPreservation: true,
  requireTextureEvidenceForMappedMaterial: true,
});

const SEMANTIC_ROLE_BY_FAMILY = Object.freeze({
  barrel: 'storage-yard',
  crate: 'storage-yard',
  bench: 'rest-edge',
  bonfire: 'hearth-shelter',
  farmDirt: 'field-edge',
});

const APPROACH_BY_ROLE_AND_ROAD = Object.freeze({
  'storage-yard:frontage': 'road-frontage-cargo',
  'storage-yard:near': 'settlement-edge-cargo',
  'storage-yard:remote': 'outlying-storage',
  'rest-edge:frontage': 'road-rest-stop',
  'rest-edge:near': 'settlement-rest-edge',
  'rest-edge:remote': 'quiet-rest-edge',
  'hearth-shelter:frontage': 'roadside-hearth',
  'hearth-shelter:near': 'sheltered-hearth',
  'hearth-shelter:remote': 'windward-hearth',
  'field-edge:frontage': 'farm-access-edge',
  'field-edge:near': 'field-transition',
  'field-edge:remote': 'outer-field',
});

function finite(value) {
  return Number.isFinite(Number(value));
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function distance2D(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.z) - Number(b?.z));
}

function roadBand(roadDistance) {
  const value = Number(roadDistance);
  if (!Number.isFinite(value)) return 'remote';
  if (value < GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.roadBandsMeters.frontage) return 'frontage';
  if (value < GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.roadBandsMeters.near) return 'near';
  return 'remote';
}

function ringBand(distanceFromSeat) {
  const value = Number(distanceFromSeat);
  const { min, max } = GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.ringMeters;
  if (!Number.isFinite(value)) return 'invalid';
  if (value < min || value > max) return 'invalid';
  const t = clamp01((value - min) / Math.max(max - min, 1));
  if (t < 0.34) return 'inner';
  if (t < 0.72) return 'middle';
  return 'outer';
}

function vectorFromSeat(placement) {
  const dx = Number(placement?.seatX) - Number(placement?.x);
  const dz = Number(placement?.seatZ) - Number(placement?.z);
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 1e-6) return { x: 0, z: 1 };
  return { x: dx / length, z: dz / length };
}

function normalizeAngle(angle) {
  let value = Number(angle);
  if (!Number.isFinite(value)) return 0;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function angleFromSeat(placement) {
  return Math.atan2(Number(placement?.z) - Number(placement?.seatZ), Number(placement?.x) - Number(placement?.seatX));
}

function semanticRoleForFamily(family) {
  return SEMANTIC_ROLE_BY_FAMILY[String(family ?? '')] || 'edge-detail';
}

function approachFor(family, roadDistance) {
  const role = semanticRoleForFamily(family);
  return APPROACH_BY_ROLE_AND_ROAD[`${role}:${roadBand(roadDistance)}`] || 'settlement-edge-detail';
}

function materialArray(mesh) {
  if (!mesh) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function textureDescriptor(texture, property, materialIndex, meshName) {
  if (!texture?.isTexture) return null;
  const image = texture.image;
  const width = Number(image?.width ?? image?.naturalWidth ?? 0);
  const height = Number(image?.height ?? image?.naturalHeight ?? 0);
  const src = String(texture.userData?.sourceFile || image?.currentSrc || image?.src || '');
  return Object.freeze({
    property,
    materialIndex,
    meshName: meshName || '',
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
    source: src,
    hasDimensions: width > 0 && height > 0,
  });
}

export function collectGeographicPropMaterialEvidence(root) {
  const meshes = [];
  const surfaces = [];
  const textures = [];
  const mappedMaterials = new Set();
  const generatedMaterials = new Set();
  const authoredPbrMaterials = new Set();
  const textureProperties = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'];

  root?.traverse?.((node) => {
    if (!node?.isMesh && !node?.isInstancedMesh) return;
    meshes.push(node);
    for (const [materialIndex, material] of materialArray(node).entries()) {
      const record = {
        meshName: node.name || '',
        materialIndex,
        materialName: material?.name || '',
        paletteId: material?.userData?.paletteId || null,
        generated: Boolean(material?.userData?.generatedByTextureFactory || material?.userData?.layeredMaterial),
        mapped: false,
      };
      for (const property of textureProperties) {
        const descriptor = textureDescriptor(material?.[property], property, materialIndex, node.name || '');
        if (!descriptor) continue;
        record.mapped = true;
        textures.push(descriptor);
      }
      if (record.mapped) mappedMaterials.add(material);
      if (record.generated) generatedMaterials.add(material);
      if (record.mapped && !record.generated) authoredPbrMaterials.add(material);
      surfaces.push(Object.freeze(record));
    }
  });

  const uvMeshCount = meshes.filter((mesh) => Boolean(mesh.geometry?.attributes?.uv)).length;
  const textureSizes = textures
    .map((texture) => texture.width > 0 && texture.height > 0 ? `${texture.width}x${texture.height}` : 'unknown')
    .sort();

  return Object.freeze({
    meshCount: meshes.length,
    surfaceCount: surfaces.length,
    materialSlotCount: surfaces.length,
    uvMeshCount,
    mappedMaterialCount: mappedMaterials.size,
    generatedMaterialCount: generatedMaterials.size,
    authoredPbrMaterialCount: authoredPbrMaterials.size,
    authoredPbrEvidence: authoredPbrMaterials.size > 0,
    textures: Object.freeze(textures.slice().sort((a, b) => `${a.meshName}:${a.property}`.localeCompare(`${b.meshName}:${b.property}`))),
    textureSizes: Object.freeze([...new Set(textureSizes)]),
    allMappedTexturesSized: textures.every((texture) => texture.hasDimensions),
    surfaces: Object.freeze(surfaces),
  });
}

export function deriveGeographicSettlementPropContext(placement = {}) {
  const family = String(placement.family || '');
  const role = semanticRoleForFamily(family);
  const roadDistance = Number(placement.roadDistance);
  const distanceFromSeat = Number(placement.distanceFromSeat);
  const biomeInfluence = clamp01(placement.influence);
  const seatVector = vectorFromSeat(placement);
  const approach = approachFor(family, roadDistance);
  return Object.freeze({
    family,
    semanticRole: role,
    biomeId: placement.biomeId || null,
    biomeKind: placement.biomeKind || null,
    biomeInfluence,
    roadDistance: finite(roadDistance) ? roadDistance : null,
    roadBand: roadBand(roadDistance),
    ringBand: ringBand(distanceFromSeat),
    distanceFromSeat: finite(distanceFromSeat) ? distanceFromSeat : null,
    approach,
    orientationIntent: role === 'storage-yard'
      ? 'road-aligned-cargo'
      : role === 'rest-edge'
        ? 'settlement-facing-rest'
        : role === 'hearth-shelter'
          ? 'sheltered-hearth'
          : role === 'field-edge'
            ? 'field-axis'
            : 'radial-settlement-edge',
    inwardVector: Object.freeze({ x: seatVector.x, z: seatVector.z }),
    radialAngleRadians: angleFromSeat(placement),
    sourceAsset: placement.asset?.src || null,
    contextVersion: GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.version,
  });
}

export function scoreGeographicSettlementPropContext(placement = {}) {
  const context = deriveGeographicSettlementPropContext(placement);
  const family = context.family;
  let score = 0;
  const reasons = [];
  if (context.ringBand === 'inner') { score += 18; reasons.push('inner-fringe'); }
  else if (context.ringBand === 'middle') { score += 24; reasons.push('middle-fringe'); }
  else if (context.ringBand === 'outer') { score += 10; reasons.push('outer-fringe'); }
  else { score -= 100; reasons.push('invalid-ring'); }
  if (context.roadBand === 'frontage') { score += family === 'barrel' || family === 'crate' ? 16 : 8; reasons.push('road-frontage'); }
  else if (context.roadBand === 'near') { score += 8; reasons.push('road-near'); }
  else { score += family === 'bench' || family === 'bonfire' ? 5 : 2; reasons.push('remote-edge'); }
  if ((context.biomeInfluence || 0) >= 0.62) { score += 10; reasons.push('strong-biome-fit'); }
  else if ((context.biomeInfluence || 0) >= GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.biomeTransitionFloor) { score += 4; reasons.push('transition-biome-fit'); }
  else { score -= 3; reasons.push('weak-biome-fit'); }
  if (family === 'farmDirt' && !['fertile', 'temperate'].includes(placement.roleId)) { score -= 30; reasons.push('field-family-biome-risk'); }
  if (family === 'bonfire' && !['cold', 'mountain'].includes(placement.roleId)) { score -= 18; reasons.push('hearth-family-region-risk'); }
  if ((family === 'barrel' || family === 'crate') && context.roadBand !== 'remote') { score += 5; reasons.push('cargo-access'); }
  return Object.freeze({ score, context, reasons: Object.freeze(reasons) });
}

export function decorateGeographicSettlementPropGroup(group, plan = []) {
  if (!group) return Object.freeze({ ok: false, error: 'missing-group' });
  const placements = (plan || []).flatMap((seat) => seat?.placements || []);
  const propChildren = [];
  group.traverse?.((child) => {
    if (child?.userData?.geographicSettlementProp) propChildren.push(child);
  });
  let decoratedCount = 0;
  const seenFamilies = new Set();
  for (let index = 0; index < propChildren.length; index += 1) {
    const child = propChildren[index];
    const placement = placements[index] || {
      seatId: child.userData.geographicSeatId,
      x: child.position.x,
      z: child.position.z,
      seatX: child.userData.geographicPlacement?.seatX,
      seatZ: child.userData.geographicPlacement?.seatZ,
      family: child.userData.geographicFamily || child.userData.geographicManifest?.metadata?.id,
      roleId: child.userData.geographicRole,
      distanceFromSeat: child.userData.geographicPlacement?.distanceFromSeat,
      roadDistance: child.userData.geographicPlacement?.roadDistance,
      biomeId: child.userData.geographicBiomeId,
      biomeKind: child.userData.geographicBiomeKind,
      influence: child.userData.geographicBiomeInfluence,
      asset: { src: child.userData.geographicSourceAsset },
    };
    const scored = scoreGeographicSettlementPropContext(placement);
    child.userData.geographicSemanticRole = scored.context.semanticRole;
    child.userData.geographicApproach = scored.context.approach;
    child.userData.geographicOrientationIntent = scored.context.orientationIntent;
    child.userData.geographicContext = scored.context;
    child.userData.geographicContextScore = scored.score;
    child.userData.geographicContextReasons = scored.reasons;
    seenFamilies.add(scored.context.semanticRole);
    decoratedCount += 1;
  }
  group.userData.geographicSettlementPropQuality = Object.freeze({
    policyId: GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.id,
    decoratedCount,
    semanticRoleCount: seenFamilies.size,
    planPlacementCount: placements.length,
  });
  return Object.freeze({ ok: true, decoratedCount, semanticRoleCount: seenFamilies.size, planPlacementCount: placements.length });
}

function transformIsFinite(object) {
  const values = [
    object?.position?.x, object?.position?.y, object?.position?.z,
    object?.rotation?.x, object?.rotation?.y, object?.rotation?.z,
    object?.scale?.x, object?.scale?.y, object?.scale?.z,
  ];
  return values.every((value) => Number.isFinite(Number(value)));
}

function auditPlacementRecord(placement, seatPlacements, index) {
  const errors = [];
  const warnings = [];
  if (!placement?.asset?.src) errors.push(`placement-${index}:missing-source-asset`);
  if (!finite(placement?.x) || !finite(placement?.z)) errors.push(`placement-${index}:non-finite-coordinates`);
  if (!finite(placement?.distanceFromSeat) || placement.distanceFromSeat < 162 || placement.distanceFromSeat > 204) errors.push(`placement-${index}:ring`);
  if (!finite(placement?.slopeDegrees) || placement.slopeDegrees > 22) errors.push(`placement-${index}:slope`);
  if (!finite(placement?.waterDepth) || placement.waterDepth > 0.02) errors.push(`placement-${index}:water`);
  if (!finite(placement?.roadDistance) || placement.roadDistance < 6) errors.push(`placement-${index}:road`);
  const role = semanticRoleForFamily(placement.family);
  if (role === 'field-edge' && !['fertile', 'temperate'].includes(placement.roleId)) warnings.push(`placement-${index}:field-role-outside-core-region`);
  if (role === 'hearth-shelter' && !['cold', 'mountain'].includes(placement.roleId)) warnings.push(`placement-${index}:hearth-role-outside-core-region`);
  for (let j = 0; j < seatPlacements.length; j += 1) {
    if (j === index) continue;
    const other = seatPlacements[j];
    if (distance2D(placement, other) < GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.minSpacingMeters) errors.push(`placement-${index}:spacing-with-${j}`);
  }
  const contextScore = scoreGeographicSettlementPropContext(placement);
  if (contextScore.score < 0) warnings.push(`placement-${index}:low-context-score`);
  return { errors, warnings, contextScore };
}

export function auditGeographicSettlementPropPlan(plan = []) {
  const errors = [];
  const warnings = [];
  const familyIds = new Set();
  const semanticRoles = new Set();
  let placementCount = 0;
  let lowScoreCount = 0;
  let exactAdjacentRepeats = 0;
  for (const seat of plan || []) {
    const placements = Array.isArray(seat?.placements) ? seat.placements : [];
    const localFamilies = [];
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      const audit = auditPlacementRecord(placement, placements, index);
      errors.push(...audit.errors.map((error) => `${seat?.seatId || 'seat'}:${error}`));
      warnings.push(...audit.warnings.map((warning) => `${seat?.seatId || 'seat'}:${warning}`));
      familyIds.add(String(placement?.family || ''));
      semanticRoles.add(audit.contextScore.context.semanticRole);
      localFamilies.push(String(placement?.family || ''));
      if (audit.contextScore.score < 0) lowScoreCount += 1;
      placementCount += 1;
    }
    for (let index = 1; index < localFamilies.length; index += 1) if (localFamilies[index] === localFamilies[index - 1]) exactAdjacentRepeats += 1;
    if (placements.length > 1 && new Set(localFamilies).size < 2 && seat?.targetCount >= 2) warnings.push(`${seat?.seatId || 'seat'}:single-family-plan`);
  }
  if (placementCount > 0 && familyIds.size < 2) warnings.push('global:insufficient-family-variety');
  if (exactAdjacentRepeats > 0) errors.push(`global:adjacent-family-repeat-count=${exactAdjacentRepeats}`);
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    placementCount,
    familyIds: Object.freeze([...familyIds].filter(Boolean).sort()),
    semanticRoles: Object.freeze([...semanticRoles].filter(Boolean).sort()),
    lowScoreCount,
    exactAdjacentRepeats,
  });
}

export function auditGeographicSettlementPropPlanAgainstCanonicalSeats(plan, seats = []) {
  const errors = [];
  const seatById = new Map((seats || []).map((seat) => [String(seat?.id ?? ''), seat]));
  for (const seatPlan of plan || []) {
    const seat = seatById.get(String(seatPlan?.seatId ?? ''));
    if (!seat) {
      errors.push(`${seatPlan?.seatId || 'unknown'}:missing-canonical-seat`);
      continue;
    }
    for (const [index, placement] of (seatPlan.placements.entries()) ) {
      const radialDistance = Math.hypot(Number(placement.x) - Number(seat.x), Number(placement.z) - Number(seat.z));
      if (Math.abs(radialDistance - Number(placement.distanceFromSeat)) > 1e-5) errors.push(`${seatPlan.seatId}:${index}:seat-distance-mismatch`);
      if (Math.abs(Number(placement.seatX) - Number(seat.x)) > 1e-5 || Math.abs(Number(placement.seatZ) - Number(seat.z)) > 1e-5) errors.push(`${seatPlan.seatId}:${index}:seat-anchor-mismatch`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function auditGeographicSettlementPropGroup(group, plan = []) {
  const errors = [];
  const warnings = [];
  const materialEvidence = [];
  let renderableCount = 0;
  let manifestCount = 0;
  let materialReadyCount = 0;
  let placementGateCount = 0;
  let placeholderCount = 0;
  let transformErrorCount = 0;

  const propChildren = [];
  group?.traverse?.((child) => {
    if (!child?.userData?.geographicSettlementProp) return;
    propChildren.push(child);
    renderableCount += 1;
    if (child.userData?.worldPlacementManifest || child.userData?.geographicManifest) manifestCount += 1;
    if (child.userData?.materialReadyForWorld === true) materialReadyCount += 1;
    if (child.userData?.worldPlacementSurface) placementGateCount += 1;
    if (child.userData?.isPlaceholder) placeholderCount += 1;
    if (!transformIsFinite(child)) transformErrorCount += 1;

    const validation = validateMaterialAssignment(child, { requireGeneratedTexture: false });
    if (!validation.ok) errors.push(`${child.name || 'prop'}:final-material:${validation.errors.join(',')}`);
    warnings.push(...validation.warnings.map((warning) => `${child.name || 'prop'}:final-material:${warning}`));
    if (!child.userData?.worldPlacementManifest?.placement) errors.push(`${child.name || 'prop'}:placement-manifest-missing`);
    materialEvidence.push({
      name: child.name || '',
      sourceAsset: child.userData?.geographicSourceAsset || null,
      evidence: collectGeographicPropMaterialEvidence(child),
    });
  });

  if (GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireManifest && renderableCount !== manifestCount) errors.push(`manifest-coverage:${manifestCount}/${renderableCount}`);
  if (GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireWorldPlacementGate && renderableCount !== materialReadyCount) errors.push(`material-ready-coverage:${materialReadyCount}/${renderableCount}`);
  if (GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireWorldPlacementGate && renderableCount !== placementGateCount) errors.push(`placement-surface-coverage:${placementGateCount}/${renderableCount}`);
  if (placeholderCount) errors.push(`placeholder-count:${placeholderCount}`);
  if (transformErrorCount) errors.push(`transform-error-count:${transformErrorCount}`);

  const assetEvidence = materialEvidence.map((entry) => entry.evidence);
  const mappedAssetCount = assetEvidence.filter((entry) => entry.authoredPbrEvidence || entry.mappedMaterialCount > 0).length;
  const textureEvidenceMissingCount = assetEvidence.filter((entry) => entry.mappedMaterialCount > 0 && entry.textures.length === 0).length;
  const textureDimensionErrorCount = assetEvidence.filter((entry) => entry.textures.length > 0 && !entry.allMappedTexturesSized).length;
  if (GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireTextureEvidenceForMappedMaterial && textureEvidenceMissingCount) errors.push(`mapped-material-without-texture-evidence:${textureEvidenceMissingCount}`);
  if (GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.requireTextureEvidenceForMappedMaterial && textureDimensionErrorCount) errors.push(`texture-dimension-evidence-missing:${textureDimensionErrorCount}`);

  const planAudit = auditGeographicSettlementPropPlan(plan);
  errors.push(...planAudit.errors);
  warnings.push(...planAudit.warnings);
  const seatAudit = auditGeographicSettlementPropPlanAgainstCanonicalSeats(plan, plan.map((entry) => ({ id: entry.seatId, x: entry.placements?.[0]?.seatX, z: entry.placements?.[0]?.seatZ })));

  const contexts = propChildren.map((child) => child.userData?.geographicContext).filter(Boolean);
  const report = Object.freeze({
    ok: errors.length === 0,
    policyId: GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.id,
    renderableCount,
    manifestCount,
    materialReadyCount,
    placementGateCount,
    placeholderCount,
    transformErrorCount,
    mappedAssetCount,
    textureEvidenceMissingCount,
    textureDimensionErrorCount,
    planAudit,
    seatAudit,
    materialEvidence: Object.freeze(materialEvidence),
    contexts: Object.freeze(contexts),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
  if (group) group.userData.geographicSettlementPropQualityReport = report;
  return report;
}

export function buildGeographicSettlementPropRuntimeSummary({ result, plan = [], quality = null, seats = [] } = {}) {
  const planAudit = auditGeographicSettlementPropPlan(plan);
  const seatAudit = auditGeographicSettlementPropPlanAgainstCanonicalSeats(plan, seats);
  const group = result?.group || null;
  const groupAudit = quality || (group ? auditGeographicSettlementPropGroup(group, plan) : null);
  return Object.freeze({
    policyId: GEOGRAPHIC_SETTLEMENT_PROP_QUALITY_POLICY.id,
    ok: Boolean(result?.ok) && planAudit.ok && seatAudit.ok && Boolean(groupAudit?.ok ?? true),
    runtime: Object.freeze({
      resultOk: Boolean(result?.ok),
      placementCount: result?.stats?.placementCount ?? group?.children?.length ?? 0,
      hydratedAssetFamilies: Object.freeze([...(result?.hydratedAssetFamilies || [])].sort()),
      failedAssetFamilies: Object.freeze([...(result?.failedAssetFamilies || [])].sort()),
    }),
    planAudit,
    seatAudit,
    groupAudit,
  });
}

export function buildStablePropFingerprint(plan = []) {
  const entries = [];
  for (const seat of plan || []) for (const placement of seat?.placements || []) entries.push([
    placement.seatId, placement.family, Number(placement.x).toFixed(4), Number(placement.z).toFixed(4), Number(placement.distanceFromSeat).toFixed(4), Number(placement.roadDistance).toFixed(4), placement.biomeId || '', placement.roleId || '',
  ].join('|'));
  entries.sort();
  let hash = 2166136261;
  for (const entry of entries) hash = Math.imul(hash ^ hashString(entry), 16777619) >>> 0;
  return `${entries.length}:${hash.toString(16).padStart(8, '0')}`;
}

export function summarizeGeographicSettlementPropMaterialEvidence(group) {
  const byAsset = new Map();
  group?.traverse?.((child) => {
    if (!child?.userData?.geographicSettlementProp) return;
    const source = child.userData?.geographicSourceAsset || 'unknown';
    if (!byAsset.has(source)) byAsset.set(source, []);
    byAsset.get(source).push(collectGeographicPropMaterialEvidence(child));
  });
  return Object.freeze([...byAsset.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([source, entries]) => Object.freeze({
    source,
    instanceCount: entries.length,
    meshCount: Math.max(...entries.map((entry) => entry.meshCount), 0),
    surfaceCount: Math.max(...entries.map((entry) => entry.surfaceCount), 0),
    mappedMaterialCount: Math.max(...entries.map((entry) => entry.mappedMaterialCount), 0),
    authoredPbrEvidence: entries.some((entry) => entry.authoredPbrEvidence),
    generatedMaterialCount: Math.max(...entries.map((entry) => entry.generatedMaterialCount), 0),
  })));
}

export function assertGeographicSettlementPropQuality(report) {
  if (!report?.ok) throw new Error(`Geographic settlement prop quality gate failed: ${(report?.errors || []).join('; ')}`);
  return report;
}

export function deterministicContextKey(placement = {}) {
  const context = deriveGeographicSettlementPropContext(placement);
  return `${context.family}|${context.biomeKind || ''}|${context.roadBand}|${context.ringBand}|${context.approach}`;
}

export function semanticRoleForGeographicSettlementPropFamily(family) {
  return semanticRoleForFamily(family);
}

export function geographicSettlementPropRolePalette(family) {
  switch (semanticRoleForFamily(family)) {
    case 'storage-yard': return 'wood-cargo';
    case 'rest-edge': return 'stone-rest';
    case 'hearth-shelter': return 'iron-earth-hearth';
    case 'field-edge': return 'earth-field';
    default: return 'mixed-edge';
  }
}

export function contextOrientationAngleRadians(placement = {}) {
  const role = semanticRoleForFamily(placement.family);
  if (role === 'rest-edge' || role === 'hearth-shelter') return normalizeAngle(angleFromSeat(placement));
  return normalizeAngle(Number(placement.yaw));
}

export function contextSummaryForPlacement(placement = {}) {
  const score = scoreGeographicSettlementPropContext(placement);
  return Object.freeze({
    key: deterministicContextKey(placement),
    score: score.score,
    semanticRole: score.context.semanticRole,
    approach: score.context.approach,
    reasons: score.reasons,
  });
}

export const __QUALITY_TEST_HOOKS = Object.freeze({ clamp01, distance2D, roadBand, ringBand, hashString, normalizeAngle });
