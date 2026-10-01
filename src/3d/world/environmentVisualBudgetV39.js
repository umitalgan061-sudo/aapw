/**
 * Environment Visual Budget v39
 *
 * Runtime-facing, DOM-free projection for caller-owned shipped-scene samples.
 * It does not create geometry, hydrate assets, mutate canonical terrain or
 * replace the shared MaterialAssignmentCore/WorldAssetPlacementPipeline.
 */

const FINITE = Number.isFinite;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => (FINITE(value) ? value : fallback);
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const bool = (value) => value === true;
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const hash = (input) => {
  let h = 2166136261;
  const value = String(input);
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};

const normalizePoint = (sample = {}) => ({
  id: text(sample.id, 'sample'),
  x: round(finite(sample.x)),
  y: round(finite(sample.y)),
  z: round(finite(sample.z)),
  biome: text(sample.biome, 'unknown'),
  surface: text(sample.surface, 'unknown'),
  slope: clamp(finite(sample.slope), 0, 90),
  elevation: finite(sample.elevation),
  moisture: clamp(finite(sample.moisture), 0, 1),
  waterDistance: Math.max(0, finite(sample.waterDistance, 9999)),
  distanceToCamera: Math.max(0, finite(sample.distanceToCamera, 0)),
  canonicalHeight: finite(sample.canonicalHeight),
  renderedHeight: finite(sample.renderedHeight),
  colliderHeight: finite(sample.colliderHeight),
  tileBoundaryDistance: Math.max(0, finite(sample.tileBoundaryDistance, 9999)),
  waterCoverage: clamp(finite(sample.waterCoverage), 0, 1),
  waterDepth: Math.max(0, finite(sample.waterDepth)),
  normalVariance: clamp(finite(sample.normalVariance), 0, 1),
  macroVariance: clamp(finite(sample.macroVariance), 0, 1),
  textureRepeatRisk: clamp(finite(sample.textureRepeatRisk), 0, 1),
  blackSkyRisk: clamp(finite(sample.blackSkyRisk), 0, 1),
  visibleSeam: bool(sample.visibleSeam),
  visibleRectangularWater: bool(sample.visibleRectangularWater),
  visibleWaterMoire: bool(sample.visibleWaterMoire),
  visibleFloatingAsset: bool(sample.visibleFloatingAsset),
  visibleInterpenetration: bool(sample.visibleInterpenetration),
  roadMask: clamp(finite(sample.roadMask), 0, 1),
  settlementMask: clamp(finite(sample.settlementMask), 0, 1),
  permanentSnow: bool(sample.permanentSnow),
  assetReady: sample.assetReady !== false,
});

const normalizeSamples = (samples) => (Array.isArray(samples) ? samples : [])
  .map(normalizePoint)
  .sort((a, b) => a.id.localeCompare(b.id));

const parity = (sample) => {
  const renderDelta = Math.abs(sample.renderedHeight - sample.canonicalHeight);
  const colliderDelta = Math.abs(sample.colliderHeight - sample.canonicalHeight);
  return {
    renderDelta: round(renderDelta),
    colliderDelta: round(colliderDelta),
    withinTolerance: renderDelta <= 0.35 && colliderDelta <= 0.35,
  };
};

const materialBudget = (sample) => {
  const steep = clamp(sample.slope / 55, 0, 1);
  const wet = clamp((1 - sample.waterDistance / 40) * 0.65 + sample.moisture * 0.35, 0, 1);
  const alpine = clamp((sample.elevation - 480) / 520, 0, 1);
  const snowline = sample.permanentSnow ? 1 : alpine;
  const rock = clamp(steep * 0.7 + alpine * 0.3, 0, 1);
  const scree = clamp(rock * (0.35 + sample.normalVariance * 0.65), 0, 1);
  const grass = clamp((1 - steep) * (1 - alpine) * (1 - wet * 0.35), 0, 1);
  const soil = clamp((1 - grass) * (1 - rock) * 0.8 + sample.macroVariance * 0.2, 0, 1);
  const mud = clamp(wet * (1 - rock) * 0.8, 0, 1);
  const sand = sample.biome === 'coast' ? clamp(1 - sample.slope / 25, 0, 1) * (1 - sample.moisture * 0.45) : 0;
  const wetEdge = clamp(wet * (1 - sample.waterDepth / 8), 0, 1);
  const foam = sample.waterCoverage > 0 ? clamp(wetEdge * (0.25 + sample.normalVariance * 0.75), 0, 1) : 0;
  const raw = { grass, soil, mud, sand, rock, scree, snow: snowline, wetEdge, foam };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round(value / total)]));
};

const vegetationBudget = (sample) => {
  const reasons = [];
  if (!sample.assetReady) reasons.push('asset-not-ready');
  if (sample.waterCoverage > 0.2 || sample.waterDistance < 1.5) reasons.push('water');
  if (sample.slope > 48) reasons.push('steep-cliff');
  if (sample.permanentSnow || sample.elevation > 780) reasons.push('permanent-snow');
  if (sample.roadMask > 0.45) reasons.push('road-clearance');
  if (sample.settlementMask > 0.45) reasons.push('settlement-clearance');
  if (sample.visibleFloatingAsset || sample.visibleInterpenetration) reasons.push('grounding-failure');
  const eligible = reasons.length === 0;
  const density = eligible ? round(clamp((1 - sample.slope / 60) * (0.55 + sample.moisture * 0.45), 0, 1)) : 0;
  const lod = sample.distanceToCamera < 45 ? 'near' : sample.distanceToCamera < 140 ? 'mid' : 'far';
  return { eligible, reasons, density, lod, instancing: eligible && sample.distanceToCamera > 18 };
};

const waterBudget = (sample) => {
  const shoreline = clamp(sample.waterCoverage * (1 - sample.waterDepth / 14), 0, 1);
  const deep = clamp(sample.waterCoverage * (sample.waterDepth / 14), 0, 1);
  const hardCoverage = sample.visibleRectangularWater || (sample.waterCoverage > 0.92 && sample.tileBoundaryDistance < 4);
  const moire = sample.visibleWaterMoire || sample.textureRepeatRisk > 0.75;
  return {
    deep: round(deep),
    shoreline: round(shoreline),
    wetEdge: round(clamp(shoreline * 0.85 + sample.moisture * 0.15, 0, 1)),
    foam: round(clamp(shoreline * (0.3 + sample.normalVariance * 0.7), 0, 1)),
    suppressHardCoverage: hardCoverage,
    suppressMoire: moire,
  };
};

const atmosphereBudget = (scene = {}) => {
  const luminance = clamp(finite(scene.backgroundLuminance, 0.22), 0, 1);
  const exposure = clamp(finite(scene.exposure, 1), 0.55, 1.35);
  const fogNear = Math.max(0.1, finite(scene.fogNear, 35));
  const fogFar = Math.max(fogNear + 1, finite(scene.fogFar, 900));
  const cameraRelativeSky = scene.cameraRelativeSky !== false;
  return {
    luminanceFloor: round(Math.max(0.12, luminance)),
    exposure: round(exposure),
    fogNear: round(fogNear),
    fogFar: round(fogFar),
    cameraRelativeSky,
    blackSkyFailure: luminance < 0.08,
  };
};

export function createEnvironmentVisualBudget(input = {}) {
  const samples = normalizeSamples(input.samples);
  const scene = atmosphereBudget(input.scene);
  const rows = samples.map((sample) => {
    const p = parity(sample);
    const materials = materialBudget(sample);
    const vegetation = vegetationBudget(sample);
    const water = waterBudget(sample);
    const visibleFailures = [
      sample.visibleSeam && 'seam',
      sample.visibleRectangularWater && 'rectangular-water',
      sample.visibleWaterMoire && 'water-moire',
      sample.visibleFloatingAsset && 'floating-asset',
      sample.visibleInterpenetration && 'interpenetration',
      sample.blackSkyRisk > 0.7 && 'black-sky',
      sample.textureRepeatRisk > 0.8 && 'texture-repeat',
      !p.withinTolerance && 'render-collider-parity',
    ].filter(Boolean);
    return { sample, parity: p, materials, vegetation, water, visibleFailures };
  });
  const totals = {
    sampleCount: rows.length,
    visibleSeam: rows.filter((row) => row.sample.visibleSeam).length,
    visibleRectangularWater: rows.filter((row) => row.sample.visibleRectangularWater).length,
    visibleWaterMoire: rows.filter((row) => row.sample.visibleWaterMoire).length,
    visibleGroundingFailure: rows.filter((row) => row.vegetation.reasons.includes('grounding-failure')).length,
    parityFailure: rows.filter((row) => !row.parity.withinTolerance).length,
    textureRepeatRisk: rows.filter((row) => row.sample.textureRepeatRisk > 0.8).length,
    blackSkyFailure: scene.blackSkyFailure ? 1 : 0,
  };
  const acceptance = {
    p0: totals.visibleSeam + totals.visibleRectangularWater + totals.visibleWaterMoire === 0,
    p1: totals.parityFailure === 0,
    p2: totals.textureRepeatRisk === 0,
    p3: totals.visibleGroundingFailure === 0,
    p4: totals.visibleRectangularWater + totals.visibleWaterMoire === 0,
    p5: totals.blackSkyFailure === 0,
  };
  const payload = {
    version: 'v39',
    contract: 'environment-visual-budget',
    camera: { width: 1536, height: 1024, projection: 'orthographic', fov: 90 },
    rows,
    scene,
    totals,
    acceptance,
  };
  payload.digest = hash(stable(payload));
  return deepFreeze(payload);
}

export function applyEnvironmentVisualBudget(scene = {}, budget = {}) {
  const next = { ...scene };
  const adoption = budget.scene || {};
  next.backgroundLuminance = Math.max(finite(scene.backgroundLuminance, 0.22), adoption.luminanceFloor ?? 0.12);
  next.exposure = clamp(finite(scene.exposure, 1), 0.55, 1.35);
  next.fogNear = Math.max(0.1, finite(scene.fogNear, 35));
  next.fogFar = Math.max(next.fogNear + 1, finite(scene.fogFar, 900));
  next.cameraRelativeSky = scene.cameraRelativeSky !== false;
  return next;
}

export { stable, hash };
