function placementAudit(placement, manifest) {
  const verticalError = Math.abs(placement.position.y - placement.groundPosition.y);
  const expectedError = Math.abs(placement.groundPosition.y - placement.expectedGroundY);
  const grounded = placement.grounded && manifest?.groundAligned === true;
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