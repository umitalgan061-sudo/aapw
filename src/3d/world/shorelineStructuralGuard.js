const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash2 = (x, y, seed) => {
  let n = Math.imul(Math.floor(x * 15731) ^ Math.floor(y * 789221) ^ Math.floor(seed * 1376312589), 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
};
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

export function classifyShorelineStructuralRisk(input = {}) {
  const x = finite(input.x);
  const y = finite(input.y);
  const seed = finite(input.seed, 1);
  const waterConfidence = clamp(input.waterConfidence, 0, 1);
  const shorelineDistance = Math.abs(finite(input.shorelineDistance, 999));
  const depth = Math.max(0, finite(input.depth));
  const sampleSpacing = Math.max(0.001, finite(input.sampleSpacing, 8));
  const neighbourDelta = Math.max(0, finite(input.neighbourDelta));
  const tileSize = Math.max(0.001, finite(input.tileSize, 64));
  const edgeProximity = Math.min(x % tileSize, tileSize - (x % tileSize), y % tileSize, tileSize - (y % tileSize));
  const seamRisk = smoothstep(sampleSpacing * 0.35, sampleSpacing * 1.4, neighbourDelta) * (edgeProximity < sampleSpacing ? 1 : 0.25);
  const blockRisk = waterConfidence > 0.7 && shorelineDistance < sampleSpacing * 1.5 && depth > 0.02 ? smoothstep(0.7, 0.98, waterConfidence) : 0;
  const moireCarrier = (hash2(x / sampleSpacing, y / sampleSpacing, seed) + hash2(y / sampleSpacing, x / sampleSpacing, seed + 11)) * 0.5;
  const stripeRisk = Math.min(1, Math.abs(moireCarrier - 0.5) * 2) * (depth > 0.05 ? 0.35 : 0.12);
  const confidence = clamp(1 - (seamRisk * 0.45 + blockRisk * 0.4 + stripeRisk * 0.15), 0, 1);
  return deepFreeze({
    schema: 'buzul-muhafizi.shoreline-structural-guard.v21',
    seamRisk: Number(seamRisk.toFixed(6)),
    rectangularWaterRisk: Number(blockRisk.toFixed(6)),
    moireRisk: Number(stripeRisk.toFixed(6)),
    visibilityTarget: { visibleSeam: 0, visibleRectangularWater: 0, visibleMoireStripe: 0 },
    confidence: Number(confidence.toFixed(6)),
    renderHints: deepFreeze({
      blendAcrossTileEdge: seamRisk > 0.2,
      suppressHardWaterMask: blockRisk > 0.15,
      rotateMicroCarriers: stripeRisk > 0.18,
      preserveCanonicalHydrology: true
    })
  });
}

export function summarizeShorelineStructuralRisk(samples = []) {
  const rows = Array.isArray(samples) ? samples.map(classifyShorelineStructuralRisk) : [];
  const max = (key) => rows.reduce((value, row) => Math.max(value, row[key]), 0);
  return deepFreeze({
    schema: 'buzul-muhafizi.shoreline-structural-guard-summary.v21',
    sampleCount: rows.length,
    maxSeamRisk: Number(max('seamRisk').toFixed(6)),
    maxRectangularWaterRisk: Number(max('rectangularWaterRisk').toFixed(6)),
    maxMoireRisk: Number(max('moireRisk').toFixed(6)),
    acceptance: rows.length > 0 && max('seamRisk') === 0 && max('rectangularWaterRisk') === 0 && max('moireRisk') === 0 ? 'clean' : 'guarded'
  });
}

export default { classifyShorelineStructuralRisk, summarizeShorelineStructuralRisk };
