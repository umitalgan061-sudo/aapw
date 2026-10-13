/**
 * Environment observation bridge v40.
 *
 * A deterministic, read-only adapter for shipped-scene observations. The
 * caller remains authoritative for geometry, hydrology, colliders, asset
 * loading, placement and scene attachment. This module only normalizes
 * observations and emits bounded acceptance metadata for P0-P5 adoption.
 */

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const text = (value, fallback = 'unknown') => typeof value === 'string' && value.length ? value : fallback;
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const hash = (value) => {
  let result = 2166136261;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
};

const normalizeSample = (sample = {}) => ({
  id: text(sample.id, 'sample'),
  x: round(sample.x),
  y: round(sample.y),
  z: round(sample.z),
  biome: text(sample.biome),
  surface: text(sample.surface),
  slope: Math.min(90, Math.max(0, finite(sample.slope))),
  elevation: finite(sample.elevation),
  moisture: clamp01(sample.moisture),
  waterDistance: Math.max(0, finite(sample.waterDistance, 9999)),
  waterDepth: Math.max(0, finite(sample.waterDepth)),
  waterCoverage: clamp01(sample.waterCoverage),
  tileBoundaryDistance: Math.max(0, finite(sample.tileBoundaryDistance, 9999)),
  normalVariance: clamp01(sample.normalVariance),
  macroVariance: clamp01(sample.macroVariance),
  textureRepeatRisk: clamp01(sample.textureRepeatRisk),
  blackSkyRisk: clamp01(sample.blackSkyRisk),
  canonicalHeight: finite(sample.canonicalHeight),
  renderedHeight: finite(sample.renderedHeight),
  colliderHeight: finite(sample.colliderHeight),
  roadMask: clamp01(sample.roadMask),
  settlementMask: clamp01(sample.settlementMask),
  permanentSnow: sample.permanentSnow === true,
  assetReady: sample.assetReady !== false,
  visibleSeam: sample.visibleSeam === true,
  visibleRectangularWater: sample.visibleRectangularWater === true,
  visibleWaterMoire: sample.visibleWaterMoire === true,
  visibleFloatingAsset: sample.visibleFloatingAsset === true,
  visibleInterpenetration: sample.visibleInterpenetration === true,
});

const normalizeScene = (scene = {}) => ({
  backgroundLuminance: clamp01(scene.backgroundLuminance),
  exposure: Math.min(4, Math.max(0.1, finite(scene.exposure, 1))),
  fogNear: Math.max(0, finite(scene.fogNear, 50)),
  fogFar: Math.max(0, finite(scene.fogFar, 500)),
  cameraRelativeSky: scene.cameraRelativeSky === true,
});

const parity = (sample) => {
  const renderDelta = Math.abs(sample.renderedHeight - sample.canonicalHeight);
  const colliderDelta = Math.abs(sample.colliderHeight - sample.canonicalHeight);
  return {
    renderDelta: round(renderDelta),
    colliderDelta: round(colliderDelta),
    withinTolerance: renderDelta <= 0.35 && colliderDelta <= 0.35,
  };
};

const materialResponse = (sample) => {
  const steep = clamp01(sample.slope / 55);
  const alpine = clamp01((sample.elevation - 450) / 550);
  const wet = clamp01(sample.moisture * 0.45 + (1 - Math.min(1, sample.waterDistance / 45)) * 0.55);
  const rock = clamp01(steep * 0.75 + alpine * 0.25);
  const scree = clamp01(rock * (0.3 + sample.normalVariance * 0.7));
  const snow = sample.permanentSnow ? 1 : alpine;
  const grass = clamp01((1 - steep) * (1 - snow) * (1 - wet * 0.25));
  const soil = clamp01((1 - grass) * (1 - rock) * 0.9 + sample.macroVariance * 0.1);
  const mud = clamp01(wet * (1 - rock) * 0.8);
  const sand = sample.biome === 'coast' ? clamp01(1 - sample.slope / 24) * (1 - sample.moisture * 0.4) : 0;
  const wetEdge = clamp01(wet * (1 - sample.waterDepth / 8));
  const foam = sample.waterCoverage > 0 ? clamp01(wetEdge * (0.25 + sample.normalVariance * 0.75)) : 0;
  const raw = { grass, soil, mud, sand, rock, scree, snow, wetEdge, foam };
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round(value / total)]));
};

const vegetation = (sample) => {
  const reasons = [];
  if (!sample.assetReady) reasons.push('asset-not-ready');
  if (sample.waterCoverage > 0.2 || sample.waterDistance < 1.5) reasons.push('water');
  if (sample.slope > 48) reasons.push('steep-cliff');
  if (sample.permanentSnow) reasons.push('permanent-snow');
  if (sample.roadMask > 0.25) reasons.push('road-clearance');
  if (sample.settlementMask > 0.5) reasons.push('settlement-clearance');
  const eligible = reasons.length === 0;
  return {
    eligible,
    reasons,
    density: eligible ? round(clamp01((1 - sample.slope / 55) * (1 - sample.waterDistance / 180) * (0.55 + sample.moisture * 0.45))) : 0,
    lodBias: round(Math.min(1, sample.waterDistance / 220)),
    instancingGroup: eligible ? `${sample.biome}:${sample.surface}` : null,
  };
};

export const createEnvironmentObservation = (input = {}) => {
  const scene = normalizeScene(input.scene);
  const samples = (Array.isArray(input.samples) ? input.samples : [])
    .map(normalizeSample)
    .sort((left, right) => left.id.localeCompare(right.id));
  const rows = samples.map((sample) => ({
    sample,
    parity: parity(sample),
    materials: materialResponse(sample),
    vegetation: vegetation(sample),
    risks: {
      seam: sample.visibleSeam || sample.tileBoundaryDistance < 0.5,
      rectangularWater: sample.visibleRectangularWater,
      waterMoire: sample.visibleWaterMoire,
      floatingOrInterpenetrating: sample.visibleFloatingAsset || sample.visibleInterpenetration,
      textureRepeat: sample.textureRepeatRisk > 0.65,
      blackSky: sample.blackSkyRisk > 0.5,
    },
  }));
  const totals = rows.reduce((accumulator, row) => {
    Object.entries(row.risks).forEach(([key, value]) => { accumulator[key] += value ? 1 : 0; });
    return accumulator;
  }, { seam: 0, rectangularWater: 0, waterMoire: 0, floatingOrInterpenetrating: 0, textureRepeat: 0, blackSky: 0 });
  const acceptance = {
    p0: totals.seam === 0 && totals.rectangularWater === 0 && totals.waterMoire === 0,
    p1: rows.every((row) => row.parity.withinTolerance),
    p2: rows.every((row) => row.sample.textureRepeatRisk < 0.8),
    p3: rows.every((row) => !row.vegetation.reasons.includes('water')),
    p4: totals.rectangularWater === 0 && totals.waterMoire === 0,
    p5: totals.blackSky === 0 && scene.fogFar > scene.fogNear,
  };
  const payload = {
    version: 'environment-observation-bridge-v40',
    camera: { width: 1536, height: 1024, projection: 'orthographic', frustum: 90, deterministic: true },
    scene,
    rows,
    totals,
    acceptance,
    digest: hash(stable({ scene, rows, totals, acceptance })),
  };
  return deepFreeze(payload);
};

export const applyEnvironmentObservation = (scene = {}, payload = {}) => {
  const next = { ...scene };
  if (Number.isFinite(payload.scene?.backgroundLuminance)) next.backgroundLuminance = Math.max(0.12, payload.scene.backgroundLuminance);
  if (Number.isFinite(payload.scene?.fogNear)) next.fogNear = Math.max(0, payload.scene.fogNear);
  if (Number.isFinite(payload.scene?.fogFar)) next.fogFar = Math.max(next.fogNear + 1, payload.scene.fogFar);
  next.cameraRelativeSky = payload.scene?.cameraRelativeSky === true;
  return next;
};

export { stable };
