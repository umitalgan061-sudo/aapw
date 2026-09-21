// @ts-nocheck
/**
 * Visibility/LOD scheduling policy for large 3D scenes.
 *
 * The scheduler ranks render candidates using projected coverage, distance, screen importance and
 * temporal age. It returns a bounded draw candidate list without touching scene objects or camera
 * internals. Real frustum/occlusion queries remain with the renderer/scene owner.
 *
 * @module renderVisibilityScheduler
 */

const freeze = Object.freeze;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, finite(value, min)));

export const RENDER_VISIBILITY_LODS = freeze(['hidden', 'far', 'mid', 'near', 'hero']);
export const RENDER_VISIBILITY_POLICY = freeze({
  id: 'render-visibility-scheduler-2026-09-v1',
  maxInput: 4096,
  maxVisible: 2048,
  maxHero: 128,
  maxNear: 512,
  maxMid: 1024,
  maxFar: 2048,
  maxAgeFrames: 120,
  hysteresisMargin: 0.08,
});

function lodFor(item, score) {
  if (item.visible === false || item.frustumVisible === false) return 'hidden';
  if (score >= 0.82) return 'hero';
  if (score >= 0.58) return 'near';
  if (score >= 0.3) return 'mid';
  return 'far';
}

function candidateScore(item, frame, policy) {
  const importance = clamp(item.importance, 0.5, 1.5);
  const projectedArea = clamp(item.projectedArea, 0, 1);
  const distanceScore = 1 - clamp((finite(item.distance, 1000) - 2) / 250, 0, 1);
  const ageBoost = Math.min(0.2, Math.max(0, finite(frame - item.lastSelectedFrame, frame)) / Math.max(1, policy.maxAgeFrames) * 0.2);
  const motion = clamp(item.motionFactor, 0, 1);
  const temporal = clamp(item.temporalImportance, 0, 1);
  return clamp((projectedArea * 0.45 + distanceScore * 0.25 + motion * 0.12 + temporal * 0.08 + ageBoost) * importance);
}

export function createRenderVisibilityScheduler(options = {}) {
  const policy = freeze({ ...RENDER_VISIBILITY_POLICY, ...(options.policy || {}) });
  const history = new Map();
  let frame = 0;

  function schedule(items = [], inputFrame = null) {
    frame = Math.max(frame, Math.floor(finite(inputFrame, frame + 1)));
    const candidates = (Array.isArray(items) ? items : []).slice(0, policy.maxInput).map((item, index) => {
      const id = String(item?.id || `candidate-${index}`).slice(0, 96);
      const score = candidateScore(item, frame, policy);
      const previous = history.get(id);
      const adjusted = previous && Math.abs(score - previous.score) < policy.hysteresisMargin ? previous.score : score;
      const lod = lodFor(item, adjusted);
      return freeze({ id, score: Number(adjusted.toFixed(6)), lod, materialKey: String(item?.materialKey || 'default').slice(0, 64), geometryKey: String(item?.geometryKey || 'default').slice(0, 64), distance: Math.max(0, finite(item?.distance, 0)), importance: clamp(item?.importance, 0.5, 1.5) });
    });
    candidates.sort((a, b) => (b.score - a.score) || a.lod.localeCompare(b.lod) || a.id.localeCompare(b.id));

    const quotas = { hero: policy.maxHero, near: policy.maxNear, mid: policy.maxMid, far: policy.maxFar };
    const accepted = [];
    const counts = { hero: 0, near: 0, mid: 0, far: 0, hidden: 0 };
    for (const candidate of candidates) {
      if (candidate.lod === 'hidden') { counts.hidden += 1; continue; }
      if (counts[candidate.lod] >= quotas[candidate.lod]) continue;
      if (accepted.length >= policy.maxVisible) break;
      accepted.push(candidate);
      counts[candidate.lod] += 1;
      history.set(candidate.id, { score: candidate.score, frame });
    }

    const deferred = candidates.filter((candidate) => !accepted.some((value) => value.id === candidate.id));
    return freeze({ frame, visible: freeze(accepted), deferred: freeze(deferred.slice(0, policy.maxInput)), counts: freeze(counts), inputCount: candidates.length });
  }

  function snapshot() {
    return freeze({ frame, historySize: history.size, policy });
  }

  function reset() { history.clear(); frame = 0; }
  return freeze({ schedule, snapshot, reset, get frame() { return frame; } });
}

export function groupRenderCandidates(candidates = []) {
  const groups = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = `${candidate.geometryKey}|${candidate.materialKey}|${candidate.lod}`;
    const list = groups.get(key) || [];
    list.push(candidate);
    groups.set(key, list);
  }
  return freeze([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => freeze({ key, count: values.length, ids: freeze(values.map((value) => value.id).sort()) })));
}
