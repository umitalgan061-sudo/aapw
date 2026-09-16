/**
 * Stable visibility + LOD planner for large world scenes.
 *
 * Computes culling, LOD, shadow-caster eligibility and update cadence from camera distance, projected
 * size, importance, velocity and runtime pressure. It does not alter scene nodes. The scene layer can
 * apply its result to meshes, instanced batches or simulation update rates.
 * @module visibilityLodPlanner
 */

export const VISIBILITY_LOD_DEFAULTS = Object.freeze({
  cullDistanceMeters: 1400,
  shadowDistanceMeters: 360,
  nearDistanceMeters: 100,
  maxVisible: 2200,
  maxShadowCasters: 360,
  maxAnimated: 420,
  historySize: 24,
});

const TIER = Object.freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });
function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, low, high) { return Math.min(high, Math.max(low, n(value, low))); }
function idOf(item, index) { return String(item?.id ?? `object-${index}`); }

function distance(item, camera) {
  const dx = n(item.x) - n(camera.x);
  const dy = n(item.y) - n(camera.y);
  const dz = n(item.z) - n(camera.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function projectedSize(item, distanceMeters, viewportHeight = 1080) {
  const radius = Math.max(0, n(item.radius, 1));
  const fovRadians = clamp(n(item.fovDegrees, 60), 20, 120) * Math.PI / 180;
  return clamp((radius / Math.max(0.1, distanceMeters)) * viewportHeight / (2 * Math.tan(fovRadians / 2)), 0, viewportHeight);
}

function lodFor(item, distanceMeters, screenPixels, tier) {
  const importance = clamp(item.importance, 0, 100);
  const tierRank = TIER[tier] ?? 1;
  const critical = importance >= 90 || item.playerFocused === true;
  if (critical && distanceMeters < 240) return 0;
  if (screenPixels >= 180 || distanceMeters < 100) return 0;
  if (screenPixels >= 70 || distanceMeters < 260) return Math.min(1, 3 - tierRank);
  if (screenPixels >= 24 || distanceMeters < 560) return Math.max(1, 2 - Math.floor(tierRank / 2));
  return tierRank >= 2 ? 3 : 2;
}

function updateCadence(item, distanceMeters, tier) {
  if (item.alwaysUpdate || item.playerFocused) return 1;
  if (distanceMeters < 120) return 1;
  if (distanceMeters < 320) return tier === 'ultra' ? 1 : 2;
  if (distanceMeters < 760) return tier === 'high' || tier === 'ultra' ? 2 : 4;
  return tier === 'ultra' ? 4 : tier === 'high' ? 6 : 8;
}

function compare(a, b) {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
  return a.id.localeCompare(b.id);
}

export function classifyVisibilityLod(item, { camera = { x: 0, y: 0, z: 0 }, viewportHeight = 1080, tier = 'balanced', config = VISIBILITY_LOD_DEFAULTS } = {}) {
  const id = idOf(item, 0);
  const distanceMeters = distance(item, camera);
  const screenPixels = projectedSize(item, distanceMeters, viewportHeight);
  const cullDistance = Math.max(1, n(item.cullDistanceMeters, config.cullDistanceMeters));
  const visible = item.visible !== false && distanceMeters <= cullDistance;
  const lod = visible ? lodFor(item, distanceMeters, screenPixels, tier) : 4;
  const shadowEligible = visible && item.castShadow !== false && distanceMeters <= n(item.shadowDistanceMeters, config.shadowDistanceMeters) && lod <= 2;
  const animatedEligible = visible && item.animated === true && lod <= 2;
  const motion = Math.max(0, n(item.velocityMetersPerSecond, 0));
  const motionBonus = clamp(motion / 20, 0, 1) * 12;
  const importance = clamp(item.importance, 0, 100);
  const focusBonus = item.playerFocused ? 28 : 0;
  const priorityScore = importance * 0.55 + focusBonus + clamp(screenPixels / 3, 0, 18) + motionBonus;
  return Object.freeze({
    ...item,
    id,
    distanceMeters: Number(distanceMeters.toFixed(3)),
    screenPixels: Number(screenPixels.toFixed(3)),
    visible,
    lod,
    shadowEligible,
    animatedEligible,
    updateEveryFrames: updateCadence(item, distanceMeters, tier),
    priorityScore: Number(priorityScore.toFixed(5)),
  });
}

export function buildVisibilityLodPlan({ items = [], camera = { x: 0, y: 0, z: 0 }, viewportHeight = 1080, tier = 'balanced', config = VISIBILITY_LOD_DEFAULTS } = {}) {
  const classified = (Array.isArray(items) ? items : [])
    .map((item, index) => classifyVisibilityLod({ ...item, id: idOf(item, index) }, { camera, viewportHeight, tier, config }))
    .sort(compare);
  const visible = [];
  const culled = [];
  let shadowCount = 0;
  let animatedCount = 0;
  for (const item of classified) {
    if (!item.visible) { culled.push(item); continue; }
    if (visible.length >= config.maxVisible) { culled.push(Object.freeze({ ...item, visible: false, cullReason: 'visible-cap' })); continue; }
    const allowShadow = item.shadowEligible && shadowCount < config.maxShadowCasters;
    const allowAnimated = item.animatedEligible && animatedCount < config.maxAnimated;
    if (allowShadow) shadowCount += 1;
    if (allowAnimated) animatedCount += 1;
    visible.push(Object.freeze({ ...item, shadowEligible: allowShadow, animatedEligible: allowAnimated }));
  }
  const byLod = [0, 1, 2, 3, 4].map((lod) => visible.filter((item) => item.lod === lod).length);
  return Object.freeze({
    tier,
    visible: Object.freeze(visible),
    culled: Object.freeze(culled),
    counts: Object.freeze({ visible: visible.length, culled: culled.length, shadows: shadowCount, animated: animatedCount, byLod: Object.freeze(byLod) }),
  });
}

export function createVisibilityLodPlanner(options = {}) {
  const config = { ...VISIBILITY_LOD_DEFAULTS, ...options };
  let frame = 0;
  let disposed = false;
  let last = null;
  const history = [];
  return {
    plan(input = {}) {
      if (disposed) throw new Error('VISIBILITY_LOD_PLANNER_DISPOSED');
      frame += 1;
      last = Object.freeze({ ...buildVisibilityLodPlan({ ...input, config }), frame });
      history.push(last);
      while (history.length > config.historySize) history.shift();
      return last;
    },
    snapshot() { return Object.freeze({ frame, last, history: Object.freeze(history.slice(-8)) }); },
    reset() { frame = 0; last = null; history.length = 0; },
    dispose() { disposed = true; last = null; history.length = 0; },
  };
}

export function validateVisibilityLodPlan(plan) {
  if (!plan || !plan.counts || !Array.isArray(plan.visible)) return false;
  if (plan.counts.visible !== plan.visible.length) return false;
  const ids = plan.visible.map((item) => item.id);
  return new Set(ids).size === ids.length && plan.counts.shadows <= plan.visible.length && plan.counts.animated <= plan.visible.length;
}
