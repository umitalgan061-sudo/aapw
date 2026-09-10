/**
 * Buzul Muhafızı — Shoreline-aware Environment Adoption v62
 *
 * Read-only runtime contract for caller-owned createScene observations.
 * It does not create geometry, hydrate assets, mutate canonical world state,
 * or import editor code. Model-bearing callers stay on merged #590.
 */
const VERSION = 'v62';
const CAMERA = Object.freeze({
  width: 1536,
  height: 1024,
  orthoDegrees: 90,
  profiles: Object.freeze(['full-world', 'far', 'terrain-near', 'northwest-near']),
});
const LIMITS = Object.freeze({ maxSamples: 256, maxInstances: 2048, maxFoam: 0.55, maxEdgeWidth: 24 });
const clamp = (v, min, max, fallback = min) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : fallback));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a || 1), 0, 1); return t * t * (3 - 2 * t); };
const normalize = (values) => { const total = Object.values(values).reduce((sum, value) => sum + value, 0) || 1; return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value / total])); };
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (text) => { let hash = 2166136261; for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); };
function deepFreeze(value) { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child); return value; }
function sample(raw = {}) {
  const surface = raw.surface || raw;
  return {
    x: finite(raw.x), z: finite(raw.z), canonicalY: finite(raw.canonicalY), renderedY: finite(raw.renderedY), colliderY: finite(raw.colliderY),
    slope: clamp(surface.slope, 0, 1), elevation: clamp(surface.elevation, 0, 1), moisture: clamp(surface.moisture, 0, 1), snow: clamp(surface.snow, 0, 1),
    waterDepth: Math.max(0, finite(surface.waterDepth)), waterDistance: Math.max(0, finite(surface.waterDistance, 9999)), waterClass: String(surface.waterClass || 'land'),
    biome: String(surface.biome || 'temperate'), roadDistance: Math.max(0, finite(surface.roadDistance, 9999)), settlementDistance: Math.max(0, finite(surface.settlementDistance, 9999)),
    tileEdgeDistance: Math.max(0, finite(raw.tileEdgeDistance, 9999)), cameraDistance: Math.max(0, finite(raw.cameraDistance)), confidence: clamp(raw.confidence, 0, 1, 1), assetReady: raw.assetReady !== false,
  };
}
function shoreline(s) {
  const shore = clamp(1 - s.waterDistance / LIMITS.maxEdgeWidth, 0, 1);
  const deep = clamp(s.waterDepth / 8, 0, 1);
  const shallow = shore * (1 - deep);
  const wetBand = smooth(0.12, 0.82, shore) * (1 - deep * 0.7);
  return {
    class: s.waterClass === 'river' ? 'river' : s.waterClass === 'lake' ? 'lake' : s.waterClass === 'sea' ? 'sea' : 'land',
    shore, deep, shallow, wetBand,
    foam: clamp(shallow * (0.28 + s.moisture * 0.22), 0, LIMITS.maxFoam),
    cyanSuppression: clamp(0.62 + shallow * 0.28, 0, 1),
    moireRisk: clamp((s.tileEdgeDistance < 2 ? 0.9 : 0) + (shallow > 0.8 && s.waterDistance < 1 ? 0.25 : 0), 0, 1),
    rectangularRisk: s.waterClass !== 'land' && s.waterDistance < 1 ? 0.95 : 0,
  };
}
function surface(s, water) {
  const steep = smooth(0.28, 0.78, s.slope);
  const alpine = smooth(0.62, 0.88, s.elevation) * (0.45 + s.snow * 0.55);
  const wet = smooth(0.48, 0.9, s.moisture);
  return normalize({
    grass: (1 - steep) * (1 - s.snow) * (1 - water.shore * 0.6),
    soil: (1 - steep) * (1 - s.snow) * 0.82,
    mud: wet * (1 - s.snow) * 0.86,
    rock: steep * 0.9 + alpine * 0.3,
    scree: smooth(0.46, 0.84, s.slope) * (0.55 + alpine * 0.45),
    snow: s.snow * 0.9,
    wetEdge: water.wetBand * (0.55 + s.moisture * 0.45),
    foam: water.foam,
  });
}
function placement(s, water) {
  const blocked = !s.assetReady || s.confidence < 0.65 || water.class !== 'land' || s.waterDepth > 0.05 || s.slope > 0.78 || s.snow > 0.92 || s.roadDistance < 2.5 || s.settlementDistance < 3;
  return { eligible: !blocked, reason: blocked ? 'context-blocked' : 'grounded', density: blocked ? 0 : clamp((1 - s.slope) * (1 - s.snow) * s.confidence, 0, 1), lod: s.cameraDistance < 40 ? 'near' : s.cameraDistance < 140 ? 'cluster' : 'impostor', instanceGroup: `${s.biome}::${s.slope > 0.6 ? 'rocky' : 'ground'}` };
}
function classify(raw) {
  const s = sample(raw); const water = shoreline(s); const parityDelta = Math.max(Math.abs(s.renderedY - s.canonicalY), Math.abs(s.colliderY - s.canonicalY));
  return { sample: { x: s.x, z: s.z, biome: s.biome }, surface: surface(s, water), water, placement: placement(s, water), parity: { maxHeightDelta: parityDelta, withinTolerance: parityDelta <= 0.35, sameCoordinate: true } };
}
export function createEnvironmentShorelineAdoptionPlan(input = {}) {
  const rows = Array.isArray(input.samples) ? input.samples.slice(0, LIMITS.maxSamples).map(classify) : [];
  const atmosphere = { backgroundLuminance: clamp(input.atmosphere?.backgroundLuminance, 0, 1, 0.3), cameraRelativeSky: true, blackSkyRisk: clamp(input.atmosphere?.backgroundLuminance, 0, 1, 0.3) < 0.08 };
  const riskCounts = {
    seam: rows.filter((row) => row.water.moireRisk > 0.8).length,
    rectangularWater: rows.filter((row) => row.water.rectangularRisk > 0.8).length,
    parity: rows.filter((row) => !row.parity.withinTolerance).length,
    invalidPlacement: rows.filter((row) => !row.placement.eligible).length,
    blackSky: atmosphere.blackSkyRisk ? 1 : 0,
  };
  const plan = { version: VERSION, limits: LIMITS, camera: CAMERA, samples: rows, atmosphere, riskCounts, targets: { visibleSeams: 0, visibleRectangularWater: 0, visibleMoire: 0, floatingAssets: 0, blackSkyFailures: 0 }, capabilities: { groundQuery: true, waterQuery: true, slopeQuery: true, biomeQuery: true, placementQuery: true, sharedMaterialPlacement: 'merged-590-authority', assetHydration: 'caller-owned' } };
  plan.digest = digest(stable(plan));
  return deepFreeze(plan);
}
export function applyEnvironmentShorelineAdoptionPlan(plan, target = {}) { if (!plan || !target || typeof target !== 'object') return false; target.environmentShorelineAdoption = { version: plan.version, digest: plan.digest, riskCounts: plan.riskCounts, camera: plan.camera, targets: plan.targets }; return true; }
export const environmentShorelineAdoptionV62 = { createEnvironmentShorelineAdoptionPlan, applyEnvironmentShorelineAdoptionPlan };
export default environmentShorelineAdoptionV62;
