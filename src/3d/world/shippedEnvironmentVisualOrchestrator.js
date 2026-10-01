/**
 * Shipped Environment Visual Orchestrator
 *
 * Read-only, deterministic orchestration layer for the existing world bootstrap.
 * It consumes caller-owned canonical/rendered observations and returns an
 * acceptance-oriented plan. It never creates geometry, mutates terrain,
 * hydrology, colliders, roads, settlements or placement state.
 */

const FINITE_DEFAULT = 0;
const MAX_SAMPLES = 512;
const MAX_STRING = 160;
const EPSILON = 1e-6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = FINITE_DEFAULT) =>
  Number.isFinite(value) ? value : fallback;
const bool = (value) => value === true;
const text = (value, fallback = "") =>
  typeof value === "string" ? value.slice(0, MAX_STRING) : fallback;

const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const stableCompare = (a, b) =>
  String(a).localeCompare(String(b), "en", { numeric: true });

const freezeDeep = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freezeDeep);
  return value;
};

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort(stableCompare).map((key) =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
};

const digest = (value) => {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const normalizeCoordinate = (sample, index) => ({
  x: round(finite(sample?.x)),
  y: round(finite(sample?.y)),
  z: round(finite(sample?.z)),
  index,
});

const normalizeSample = (sample, index) => ({
  id: text(sample?.id, `sample-${index}`),
  coordinate: normalizeCoordinate(sample, index),
  biome: text(sample?.biome, "unknown").toLowerCase(),
  height: round(finite(sample?.height)),
  slope: round(clamp(finite(sample?.slope), 0, 90)),
  aspect: round(((finite(sample?.aspect) % 360) + 360) % 360),
  moisture: round(clamp(finite(sample?.moisture), 0, 1)),
  temperature: round(finite(sample?.temperature)),
  waterDistance: round(Math.max(0, finite(sample?.waterDistance, 999999))),
  roadDistance: round(Math.max(0, finite(sample?.roadDistance, 999999))),
  settlementDistance: round(Math.max(0, finite(sample?.settlementDistance, 999999))),
  canonicalHeight: round(finite(sample?.canonicalHeight)),
  renderedHeight: round(finite(sample?.renderedHeight)),
  colliderHeight: round(finite(sample?.colliderHeight)),
  waterCoverage: round(clamp(finite(sample?.waterCoverage), 0, 1)),
  shorelineGradient: round(clamp(finite(sample?.shorelineGradient), 0, 1)),
  skyLuminance: round(clamp(finite(sample?.skyLuminance), 0, 1)),
  frameTimeMs: round(Math.max(0, finite(sample?.frameTimeMs))),
  placeholder: bool(sample?.placeholder),
  missingAsset: bool(sample?.missingAsset),
  materialMismatch: bool(sample?.materialMismatch),
  floatingAsset: bool(sample?.floatingAsset),
  interpenetratingAsset: bool(sample?.interpenetratingAsset),
  textureRepeatRisk: round(clamp(finite(sample?.textureRepeatRisk), 0, 1)),
  waterStripeRisk: round(clamp(finite(sample?.waterStripeRisk), 0, 1)),
  rectangularWaterRisk: round(clamp(finite(sample?.rectangularWaterRisk), 0, 1)),
  seamRisk: round(clamp(finite(sample?.seamRisk), 0, 1)),
  blackSkyRisk: round(clamp(finite(sample?.blackSkyRisk), 0, 1)),
  forestDensity: round(clamp(finite(sample?.forestDensity), 0, 1)),
  rockExposure: round(clamp(finite(sample?.rockExposure), 0, 1)),
  snowCoverage: round(clamp(finite(sample?.snowCoverage), 0, 1)),
  reliefVariance: round(clamp(finite(sample?.reliefVariance), 0, 1)),
});

const sortSamples = (samples) =>
  [...samples]
    .sort((a, b) => stableCompare(`${a.id}:${a.coordinate.index}`, `${b.id}:${b.coordinate.index}`))
    .slice(0, MAX_SAMPLES);

const normalizeSamples = (samples) => {
  if (!Array.isArray(samples)) return [];
  return sortSamples(samples.map(normalizeSample));
};

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const maxOf = (values) => values.length ? Math.max(...values) : 0;
const ratio = (value, denominator) => denominator > EPSILON ? value / denominator : 0;

const heightParity = (sample) => ({
  renderedCanonical: round(Math.abs(sample.renderedHeight - sample.canonicalHeight)),
  colliderCanonical: round(Math.abs(sample.colliderHeight - sample.canonicalHeight)),
  renderedCollider: round(Math.abs(sample.renderedHeight - sample.colliderHeight)),
});

const classifySurface = (sample) => {
  const alpine = sample.height > 0.72 || sample.temperature < -4 || sample.biome.includes("alpine");
  const wet = sample.moisture > 0.68 || sample.waterDistance < 12;
  const steep = sample.slope > 42;
  const snow = sample.snowCoverage > 0.58 || sample.temperature < -8;
  const water = sample.waterCoverage > 0.5;
  const shore = !water && sample.waterDistance < 16 && sample.shorelineGradient > 0.15;
  if (water) return "water";
  if (shore && wet) return "wet-shore";
  if (snow && steep) return "snow-scree";
  if (snow) return "snow";
  if (steep && sample.rockExposure > 0.25) return "rock";
  if (wet) return "wet-ground";
  if (alpine) return "alpine-ground";
  return "ground";
};

const surfaceWeights = (sample) => {
  const steepFactor = clamp(sample.slope / 60, 0, 1);
  const alpineFactor = clamp((sample.height - 0.55) / 0.45, 0, 1);
  const snowFactor = clamp(sample.snowCoverage + alpineFactor * 0.35, 0, 1);
  const wetFactor = clamp(sample.moisture * 0.7 + (sample.waterDistance < 14 ? 0.3 : 0), 0, 1);
  const rock = clamp(sample.rockExposure * 0.8 + steepFactor * 0.2, 0, 1);
  const scree = clamp(rock * 0.55 + alpineFactor * 0.35, 0, 1);
  const grass = clamp((1 - snowFactor) * (1 - rock * 0.65) * (1 - wetFactor * 0.15), 0, 1);
  const soil = clamp((1 - grass) * (1 - snowFactor) * (1 - rock * 0.3), 0, 1);
  const mud = clamp(wetFactor * (1 - rock) * (1 - snowFactor), 0, 1);
  const sand = clamp(sample.biome.includes("coast") || sample.biome.includes("desert") ? 0.45 : 0, 0, 1);
  const snow = clamp(snowFactor * (1 - sample.waterCoverage), 0, 1);
  const wetEdge = clamp((sample.waterDistance < 10 ? 0.7 : 0) + sample.shorelineGradient * 0.3, 0, 1);
  const sum = grass + soil + mud + sand + rock + scree + snow + wetEdge || 1;
  return {
    grass: round(grass / sum),
    soil: round(soil / sum),
    mud: round(mud / sum),
    sand: round(sand / sum),
    rock: round(rock / sum),
    scree: round(scree / sum),
    snow: round(snow / sum),
    wetEdge: round(wetEdge / sum),
  };
};

const p0Signals = (sample) => ({
  visibleGridSeam: sample.seamRisk > 0.18 ? 1 : 0,
  visibleRectangularWaterBlock: sample.rectangularWaterRisk > 0.18 ? 1 : 0,
  visibleWaterMoire: sample.waterStripeRisk > 0.18 ? 1 : 0,
  visibleBlackSky: sample.blackSkyRisk > 0.18 || sample.skyLuminance < 0.06 ? 1 : 0,
});

const p1Signals = (sample, parity) => ({
  heightMismatch: parity.renderedCanonical > 0.075 || parity.colliderCanonical > 0.075 ? 1 : 0,
  cliffWallRisk: sample.slope > 55 && sample.reliefVariance < 0.12 ? 1 : 0,
  flatSnowRisk: sample.snowCoverage > 0.72 && sample.rockExposure < 0.12 ? 1 : 0,
  missingTalusRisk: sample.slope > 35 && sample.rockExposure < 0.16 ? 1 : 0,
});

const p2Signals = (sample) => ({
  flatMaterialRisk: sample.textureRepeatRisk > 0.28 ? 1 : 0,
  lowMacroBreakup: sample.reliefVariance < 0.12 ? 1 : 0,
  weakRockExposure: sample.slope > 38 && sample.rockExposure < 0.2 ? 1 : 0,
});

const p3Signals = (sample) => ({
  placeholder: sample.placeholder ? 1 : 0,
  missingAsset: sample.missingAsset ? 1 : 0,
  materialMismatch: sample.materialMismatch ? 1 : 0,
  floatingAsset: sample.floatingAsset ? 1 : 0,
  interpenetratingAsset: sample.interpenetratingAsset ? 1 : 0,
  forestVoid: sample.forestDensity < 0.08 && !sample.biome.includes("desert") && sample.waterCoverage < 0.3 ? 1 : 0,
});

const p4Signals = (sample) => ({
  hardCoverage: sample.rectangularWaterRisk > 0.15 || sample.waterCoverage > 0.75 ? 1 : 0,
  stripe: sample.waterStripeRisk > 0.15 ? 1 : 0,
  weakWetEdge: sample.waterDistance < 12 && sample.shorelineGradient > 0.2 && sample.moisture < 0.35 ? 1 : 0,
});

const p5Signals = (sample) => ({
  blackSky: sample.blackSkyRisk > 0.15 || sample.skyLuminance < 0.06 ? 1 : 0,
  overBudget: sample.frameTimeMs > 33.4 ? 1 : 0,
});

const aggregateSignals = (signalObjects) => {
  const result = {};
  signalObjects.forEach((signals) => {
    Object.entries(signals).forEach(([key, value]) => {
      result[key] = (result[key] || 0) + value;
    });
  });
  return result;
};

const riskScore = (signals, sampleCount) => {
  const divisor = Math.max(1, sampleCount);
  const weighted = Object.entries(signals).reduce((sum, [key, value]) => {
    const weight = key.includes("water") || key.includes("Seam") || key.includes("Sky") ? 2 : 1;
    return sum + value * weight;
  }, 0);
  return round(clamp(weighted / (divisor * 18), 0, 1));
};

const acceptanceTargets = {
  visibleGridSeam: 0,
  visibleRectangularWaterBlock: 0,
  visibleWaterMoire: 0,
  visibleBlackSky: 0,
  placeholder: 0,
  missingAsset: 0,
  materialMismatch: 0,
  floatingAsset: 0,
  interpenetratingAsset: 0,
};

const cameraProfiles = [
  { id: "full-world", projection: "orthographic", width: 1536, height: 1024, range: "full" },
  { id: "terrain-far", projection: "orthographic", width: 1536, height: 1024, range: "far" },
  { id: "terrain-near-center", projection: "perspective", width: 1536, height: 1024, range: "near-center" },
  { id: "terrain-near-northwest", projection: "perspective", width: 1536, height: 1024, range: "near-northwest" },
];

const deriveMaterialPlan = (samples) => {
  const bySurface = {};
  samples.forEach((sample) => {
    const surface = classifySurface(sample);
    bySurface[surface] = (bySurface[surface] || 0) + 1;
  });
  return Object.fromEntries(Object.entries(bySurface).sort(([a], [b]) => stableCompare(a, b)));
};

const deriveVegetationPlan = (samples) => {
  const eligible = samples.filter((sample) =>
    sample.waterCoverage < 0.25 &&
    sample.slope < 48 &&
    sample.snowCoverage < 0.85 &&
    sample.floatingAsset === false &&
    sample.interpenetratingAsset === false
  );
  const clusterHints = eligible
    .map((sample) => ({
      id: sample.id,
      biome: sample.biome,
      density: round(clamp(0.15 + sample.moisture * 0.5 + (1 - sample.slope / 90) * 0.35, 0.05, 1)),
      lodBias: round(clamp(sample.frameTimeMs > 24 ? 0.35 : 0.1, 0, 1)),
      instanced: true,
      clearingRadius: round(clamp(2 + sample.roadDistance / 32, 2, 18)),
    }))
    .sort((a, b) => stableCompare(a.id, b.id));
  return { eligibleCount: eligible.length, clusterHints };
};

const deriveWaterPlan = (samples) => samples
  .filter((sample) => sample.waterCoverage > 0.05 || sample.waterDistance < 16)
  .map((sample) => ({
    id: sample.id,
    depthBlend: round(clamp(sample.waterCoverage * 0.8 + 0.2, 0, 1)),
    shallowBlend: round(clamp(1 - sample.waterCoverage, 0, 1)),
    wetEdge: round(clamp(sample.shorelineGradient * 0.7 + (sample.waterDistance < 10 ? 0.3 : 0), 0, 1)),
    moireSuppression: round(clamp(sample.waterStripeRisk + sample.rectangularWaterRisk, 0, 1)),
    foamSuppression: round(clamp(sample.waterCoverage < 0.18 ? 0.35 : 0.05, 0, 1)),
    rotatedMicroCarrier: sample.waterStripeRisk > 0.18,
  }))
  .sort((a, b) => stableCompare(a.id, b.id));

const deriveAtmospherePlan = (samples) => {
  const skyFloor = Math.max(0.08, average(samples.map((sample) => sample.skyLuminance)));
  const maxFrame = maxOf(samples.map((sample) => sample.frameTimeMs));
  return {
    cameraRelativeSky: true,
    skyLuminanceFloor: round(skyFloor),
    exposureFloor: round(skyFloor < 0.12 ? 0.85 : 0.55),
    fogLift: round(clamp(samples.filter((sample) => sample.blackSkyRisk > 0.15).length / Math.max(1, samples.length), 0, 1)),
    framePressure: round(clamp(ratio(maxFrame, 50), 0, 1)),
    weatherReadable: skyFloor > 0.05,
  };
};

const deriveParityPlan = (samples) => {
  const parity = samples.map(heightParity);
  return {
    sampleCount: parity.length,
    maxRenderedCanonical: round(maxOf(parity.map((item) => item.renderedCanonical))),
    maxColliderCanonical: round(maxOf(parity.map((item) => item.colliderCanonical))),
    maxRenderedCollider: round(maxOf(parity.map((item) => item.renderedCollider))),
    meanRenderedCanonical: round(average(parity.map((item) => item.renderedCanonical))),
    meanColliderCanonical: round(average(parity.map((item) => item.colliderCanonical))),
    sameCoordinate: true,
  };
};

const buildSampleReports = (samples) => samples.map((sample) => {
  const parity = heightParity(sample);
  const report = {
    id: sample.id,
    coordinate: sample.coordinate,
    surface: classifySurface(sample),
    weights: surfaceWeights(sample),
    parity,
    p0: p0Signals(sample),
    p1: p1Signals(sample, parity),
    p2: p2Signals(sample),
    p3: p3Signals(sample),
    p4: p4Signals(sample),
    p5: p5Signals(sample),
  };
  return report;
});

const buildAcceptance = (reports) => {
  const p0 = aggregateSignals(reports.map((report) => report.p0));
  const p1 = aggregateSignals(reports.map((report) => report.p1));
  const p2 = aggregateSignals(reports.map((report) => report.p2));
  const p3 = aggregateSignals(reports.map((report) => report.p3));
  const p4 = aggregateSignals(reports.map((report) => report.p4));
  const p5 = aggregateSignals(reports.map((report) => report.p5));
  const all = { ...p0, ...p1, ...p2, ...p3, ...p4, ...p5 };
  const failures = Object.entries(all)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => stableCompare(a, b))
    .map(([id, count]) => ({ id, count }));
  return {
    targets: acceptanceTargets,
    p0,
    p1,
    p2,
    p3,
    p4,
    p5,
    failures,
    riskScore: riskScore(all, reports.length),
    pass: failures.length === 0,
  };
};

export function buildShippedEnvironmentPlan(input = {}) {
  const samples = normalizeSamples(input.samples);
  const reports = buildSampleReports(samples);
  const acceptance = buildAcceptance(reports);
  const plan = {
    schema: "buzul-muhafizi/shipped-environment-plan/v29",
    readOnly: true,
    canonicalAuthorityPreserved: true,
    geometryCreated: false,
    geographyInvented: false,
    editorImported: false,
    sharedPlacementContract: "MaterialAssignmentCore+WorldAssetPlacementPipeline",
    cameras: cameraProfiles,
    sampleCount: samples.length,
    reports,
    acceptance,
    materialPlan: deriveMaterialPlan(samples),
    vegetationPlan: deriveVegetationPlan(samples),
    waterPlan: deriveWaterPlan(samples),
    atmospherePlan: deriveAtmospherePlan(samples),
    parityPlan: deriveParityPlan(samples),
    stableDigest: "",
  };
  plan.stableDigest = digest(plan);
  return freezeDeep(plan);
}

export function evaluateShippedEnvironmentDelta(before = {}, after = {}) {
  const beforePlan = buildShippedEnvironmentPlan(before);
  const afterPlan = buildShippedEnvironmentPlan(after);
  const byFailure = (plan) => Object.fromEntries(plan.acceptance.failures.map(({ id, count }) => [id, count]));
  const beforeFailures = byFailure(beforePlan);
  const afterFailures = byFailure(afterPlan);
  const ids = [...new Set([...Object.keys(beforeFailures), ...Object.keys(afterFailures)])].sort(stableCompare);
  const failures = ids.map((id) => ({
    id,
    before: beforeFailures[id] || 0,
    after: afterFailures[id] || 0,
    delta: (afterFailures[id] || 0) - (beforeFailures[id] || 0),
  }));
  return freezeDeep({
    schema: "buzul-muhafizi/shipped-environment-delta/v29",
    beforeDigest: beforePlan.stableDigest,
    afterDigest: afterPlan.stableDigest,
    riskScoreBefore: beforePlan.acceptance.riskScore,
    riskScoreAfter: afterPlan.acceptance.riskScore,
    riskScoreDelta: round(afterPlan.acceptance.riskScore - beforePlan.acceptance.riskScore),
    failures,
    improved: afterPlan.acceptance.riskScore < beforePlan.acceptance.riskScore,
    beforePass: beforePlan.acceptance.pass,
    afterPass: afterPlan.acceptance.pass,
  });
}

export const SHIPPED_ENVIRONMENT_CAMERA_PROFILES = freezeDeep([...cameraProfiles]);
export const SHIPPED_ENVIRONMENT_ACCEPTANCE_TARGETS = freezeDeep({ ...acceptanceTargets });
