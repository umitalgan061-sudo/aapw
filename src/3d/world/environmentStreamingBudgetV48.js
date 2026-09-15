/**
 * Deterministic, read-only chunk streaming / LOD / culling budget for the shipped world.
 * Caller owns chunk registration, asset hydration, scene attach and renderer mutation.
 * This contract only derives bounded decisions from already-authoritative observations.
 */
const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const token = (value, fallback = 'unknown') => {
  const t = String(value ?? '').trim().toLowerCase();
  return t || fallback;
};
const freeze = (value) => Object.freeze(value);

export const ENVIRONMENT_STREAMING_BUDGET_V48 = freeze({
  id: 'environment-streaming-budget-v48',
  version: 48,
  authority: 'caller-owned-chunk-and-renderer-state',
  createsGeometry: false,
  mutatesScene: false,
  hydratesAssets: false,
  importsEditor: false,
  maxVisibleChunks: 64,
  maxPrefetchChunks: 24,
  maxInstancesPerChunk: 480,
  lodBandsMeters: freeze([48, 140, 360]),
});

export function normalizeChunkObservation(input = {}) {
  const sample = input && typeof input === 'object' ? input : {};
  const distance = Math.max(0, finite(sample.distanceMeters, Infinity));
  const screenCoverage = clamp(sample.screenCoverage, 0, 1);
  const importance = clamp(sample.importance, 0, 1);
  const biome = token(sample.biome, 'unknown');
  const readiness = token(sample.readiness, 'unknown');
  const assetCount = Math.max(0, Math.floor(finite(sample.assetCount)));
  const instanceCount = Math.max(0, Math.floor(finite(sample.instanceCount)));
  const activeCamera = Boolean(sample.activeCamera);
  const occluded = Boolean(sample.occluded);
  return freeze({
    id: token(sample.id, 'chunk-unknown'),
    distanceMeters: distance,
    screenCoverage,
    importance,
    biome,
    readiness,
    assetCount,
    instanceCount,
    activeCamera,
    occluded,
    canonical: sample.canonical !== false,
    groundReady: sample.groundReady !== false,
  });
}

function lodFor(distance, coverage) {
  if (distance <= ENVIRONMENT_STREAMING_BUDGET_V48.lodBandsMeters[0] || coverage >= 0.62) return 'near';
  if (distance <= ENVIRONMENT_STREAMING_BUDGET_V48.lodBandsMeters[1] || coverage >= 0.22) return 'mid';
  if (distance <= ENVIRONMENT_STREAMING_BUDGET_V48.lodBandsMeters[2] || coverage >= 0.05) return 'far';
  return 'impostor';
}

export function planChunkObservation(input = {}) {
  const chunk = normalizeChunkObservation(input);
  const reasons = [];
  if (!chunk.canonical) reasons.push('non-canonical');
  if (!chunk.groundReady) reasons.push('ground-not-ready');
  if (chunk.readiness === 'missing' || chunk.readiness === 'blocked') reasons.push('asset-not-ready');
  if (chunk.occluded && !chunk.activeCamera) reasons.push('occluded');

  const lod = lodFor(chunk.distanceMeters, chunk.screenCoverage);
  const visible = reasons.length === 0 && (chunk.activeCamera || !chunk.occluded) && chunk.distanceMeters <= 540;
  const prefetched = !visible && reasons.length === 0 && chunk.distanceMeters <= 760 && chunk.importance >= 0.35;
  const culled = !visible && !prefetched;
  const densityScale = lod === 'near' ? 1 : lod === 'mid' ? 0.7 : lod === 'far' ? 0.38 : 0.16;
  const instanceBudget = Math.min(ENVIRONMENT_STREAMING_BUDGET_V48.maxInstancesPerChunk, Math.max(0, Math.round(chunk.instanceCount * densityScale)));

  return freeze({
    contractId: ENVIRONMENT_STREAMING_BUDGET_V48.id,
    chunk,
    lod,
    visible,
    prefetched,
    culled,
    cullingReasons: freeze(reasons),
    useInstancing: chunk.instanceCount >= 12,
    instanceBudget,
    materialReady: chunk.readiness === 'ready',
    environmentClass: chunk.biome.includes('forest') ? 'canopy' : chunk.biome.includes('alpine') ? 'alpine' : chunk.biome,
  });
}

export function buildStreamingPlan(inputs = []) {
  const observations = Array.isArray(inputs) ? inputs.map(planChunkObservation) : [];
  const ranked = observations.slice().sort((a, b) => {
    if (Number(b.visible) !== Number(a.visible)) return Number(b.visible) - Number(a.visible);
    if (b.chunk.importance !== a.chunk.importance) return b.chunk.importance - a.chunk.importance;
    if (a.chunk.distanceMeters !== b.chunk.distanceMeters) return a.chunk.distanceMeters - b.chunk.distanceMeters;
    return a.chunk.id.localeCompare(b.chunk.id);
  });
  let visibleCount = 0;
  let prefetchCount = 0;
  const selected = ranked.map((entry) => {
    if (entry.visible && visibleCount < ENVIRONMENT_STREAMING_BUDGET_V48.maxVisibleChunks) {
      visibleCount += 1;
      return entry;
    }
    if (entry.prefetched && prefetchCount < ENVIRONMENT_STREAMING_BUDGET_V48.maxPrefetchChunks) {
      prefetchCount += 1;
      return entry;
    }
    return freeze({ ...entry, visible: false, prefetched: false, culled: true, cullingReasons: freeze([...entry.cullingReasons, 'budget']) });
  });
  return freeze({
    contractId: ENVIRONMENT_STREAMING_BUDGET_V48.id,
    entries: freeze(selected),
    summary: freeze({
      total: selected.length,
      visible: selected.filter((entry) => entry.visible).length,
      prefetched: selected.filter((entry) => entry.prefetched).length,
      culled: selected.filter((entry) => entry.culled).length,
      near: selected.filter((entry) => entry.lod === 'near').length,
      mid: selected.filter((entry) => entry.lod === 'mid').length,
      far: selected.filter((entry) => entry.lod === 'far').length,
      impostor: selected.filter((entry) => entry.lod === 'impostor').length,
      instanced: selected.filter((entry) => entry.useInstancing).length,
    }),
  });
}

export function serializeStreamingPlan(plan) {
  return JSON.stringify(plan, Object.keys(plan).sort());
}
