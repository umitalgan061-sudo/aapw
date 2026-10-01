/**
 * Runtime-facing P0/P4 water/shoreline adoption bridge.
 *
 * Consumes caller-owned depth/coverage samples and returns bounded optical controls for an existing
 * water material. It never creates geometry, changes canonical hydrology/coastline/terrain/collider
 * data, or bypasses the shared model/material placement contract.
 */

const POLICY_ID = 'water-shoreline-adoption-v24';
const DEFAULTS = Object.freeze({
  depthScale: 1,
  shoreBand: 0.18,
  foamBand: 0.08,
  maxRoughness: 0.86,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function normalizeSample(sample = {}) {
  return {
    depth: clamp(finiteOr(sample.depth, 0), 0, 1),
    coverage: clamp(finiteOr(sample.coverage, 0), 0, 1),
    shorelineGradient: clamp(finiteOr(sample.shorelineGradient, 0), 0, 1),
    distanceMeters: Math.max(0, finiteOr(sample.distanceMeters, 0)),
    microCarrierRisk: clamp(finiteOr(sample.microCarrierRisk, 0), 0, 1),
    worldX: finiteOr(sample.worldX, 0),
    worldZ: finiteOr(sample.worldZ, 0),
  };
}

function sampleResponse(sample, options = {}) {
  const s = normalizeSample(sample);
  const depthScale = clamp(finiteOr(options.depthScale, DEFAULTS.depthScale), 0.25, 4);
  const depth = clamp(s.depth * depthScale, 0, 1);
  const wet = s.coverage > 0.5;
  const shore = wet ? clamp((1 - depth) * 0.72 + s.shorelineGradient * 0.58, 0, 1) : 0;
  const foam = wet ? clamp(s.shorelineGradient * 0.76 + (1 - depth) * 0.34, 0, 1) : 0;
  const deep = wet ? clamp(depth * 1.08 - shore * 0.36, 0, 1) : 0;
  const cameraFade = clamp(1 - s.distanceMeters / 16000, 0.18, 1);
  const antiMoire = clamp(1 - s.microCarrierRisk, 0, 1);
  const roughness = clamp(0.34 + deep * 0.30 + shore * 0.12 + (1 - antiMoire) * 0.08, 0.22, DEFAULTS.maxRoughness);
  return Object.freeze({
    policyId: POLICY_ID,
    worldX: s.worldX,
    worldZ: s.worldZ,
    wet,
    deep,
    shore,
    foam,
    wetEdge: shore,
    roughness,
    normalEnergy: clamp((0.62 + deep * 0.25 + shore * 0.1) * cameraFade * antiMoire, 0, 1),
    antiMoire,
    rectangularWaterRisk: wet && s.shorelineGradient < 0.02 ? 1 : 0,
    hardCoverageRisk: wet && depth < 0.03 && s.shorelineGradient < 0.04 ? 1 : 0,
    cameraDistanceFade: cameraFade,
    canonicalHydrologyUnchanged: true,
    canonicalCoastlineUnchanged: true,
  });
}

export function createWaterShorelineAdoptionProfile(samples = [], options = {}) {
  const input = Array.isArray(samples) ? samples : [];
  const profiles = input.map((sample) => sampleResponse(sample, options));
  const risks = profiles.reduce((acc, profile) => ({
    rectangularWaterRisk: acc.rectangularWaterRisk + profile.rectangularWaterRisk,
    hardCoverageRisk: acc.hardCoverageRisk + profile.hardCoverageRisk,
  }), { rectangularWaterRisk: 0, hardCoverageRisk: 0 });
  return Object.freeze({
    policyId: POLICY_ID,
    samples: Object.freeze(profiles),
    sampleCount: profiles.length,
    rectangularWaterRiskCount: risks.rectangularWaterRisk,
    hardCoverageRiskCount: risks.hardCoverageRisk,
    visibleWaterArtifactTarget: 0,
    visibleMoireTarget: 0,
    deterministicKey: profiles.map((profile) => `${profile.worldX}:${profile.worldZ}:${profile.deep}:${profile.shore}`).join('|'),
  });
}

export function applyWaterShorelineAdoptionToMaterial(material, profile = {}) {
  if (!material || typeof material !== 'object') return false;
  const samples = Array.isArray(profile.samples) ? profile.samples : [];
  if (!samples.length) return false;
  const mean = samples.reduce((acc, sample) => ({
    shore: acc.shore + sample.shore,
    foam: acc.foam + sample.foam,
    roughness: acc.roughness + sample.roughness,
    normalEnergy: acc.normalEnergy + sample.normalEnergy,
  }), { shore: 0, foam: 0, roughness: 0, normalEnergy: 0 });
  const count = samples.length;
  material.roughness = clamp(mean.roughness / count, 0.22, DEFAULTS.maxRoughness);
  material.userData = material.userData && typeof material.userData === 'object' ? material.userData : {};
  material.userData.waterShorelineAdoption = Object.freeze({
    policyId: POLICY_ID,
    shoreWeight: clamp(mean.shore / count, 0, 1),
    foamWeight: clamp(mean.foam / count, 0, 1),
    normalEnergy: clamp(mean.normalEnergy / count, 0, 1),
    visibleWaterArtifactTarget: 0,
    visibleMoireTarget: 0,
  });
  return true;
}

export function summarizeWaterShorelineAdoption(profile = {}) {
  return Object.freeze({
    policyId: profile.policyId || POLICY_ID,
    sampleCount: Number.isInteger(profile.sampleCount) ? profile.sampleCount : 0,
    rectangularWaterRiskCount: Number.isInteger(profile.rectangularWaterRiskCount) ? profile.rectangularWaterRiskCount : 0,
    hardCoverageRiskCount: Number.isInteger(profile.hardCoverageRiskCount) ? profile.hardCoverageRiskCount : 0,
    visibleWaterArtifactTarget: 0,
    visibleMoireTarget: 0,
  });
}
