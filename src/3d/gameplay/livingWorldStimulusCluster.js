/**
 * Deterministic event clustering for noisy living-world stimulus streams.
 *
 * Clustering is deliberately semantic and bounded: nearby same-kind events are grouped into a
 * representative signal while preserving source diversity. It does not alter authoritative world
 * events, faction state, combat outcomes or perception truth.
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const LIVING_WORLD_STIMULUS_CLUSTER_POLICY = freeze({
  id: 'living-world-stimulus-cluster-2026-09-v1',
  maxInput: 256,
  maxClusters: 64,
  distanceMeters: 4,
  timeSeconds: 1.5,
});

function distance(a, b) {
  if (!a?.position || !b?.position) return Infinity;
  return Math.hypot(finite(a.position.x) - finite(b.position.x), finite(a.position.y) - finite(b.position.y), finite(a.position.z) - finite(b.position.z));
}

function compatible(a, b, policy) {
  if (!a || !b || a.kind !== b.kind || a.channel !== b.channel) return false;
  if (Math.abs(finite(a.timestampMs) - finite(b.timestampMs)) > policy.timeSeconds * 1000) return false;
  return distance(a, b) <= policy.distanceMeters;
}

function representative(items) {
  const ordered = [...items].sort((a, b) => (b.confidence - a.confidence) || (b.intensity - a.intensity) || String(a.id).localeCompare(String(b.id)));
  const head = ordered[0];
  const confidence = Math.max(...items.map((item) => clamp(item.confidence)));
  const intensity = Math.min(1, items.reduce((sum, item) => sum + clamp(item.intensity), 0) / Math.max(1, items.length) * 1.2);
  const sources = [...new Set(items.map((item) => String(item.source || 'unknown')))].sort();
  return freeze({
    ...head,
    id: `cluster:${head.id}`,
    confidence,
    intensity,
    source: sources[0] || 'unknown',
    metadata: freeze({ ...(head.metadata || {}), clustered: true, memberCount: items.length }),
    tags: freeze([...new Set(items.flatMap((item) => Array.isArray(item.tags) ? item.tags : []))].slice(0, 12).sort()),
    clusterSources: freeze(sources),
  });
}

export function clusterLivingWorldStimuli(stimuli = [], options = {}) {
  const policy = { ...LIVING_WORLD_STIMULUS_CLUSTER_POLICY, ...(options.policy || {}) };
  const input = (Array.isArray(stimuli) ? stimuli : []).slice(0, policy.maxInput);
  const clusters = [];
  for (const stimulus of input) {
    let target = null;
    for (const cluster of clusters) {
      if (compatible(cluster[0], stimulus, policy)) { target = cluster; break; }
    }
    if (target) target.push(stimulus);
    else if (clusters.length < policy.maxClusters) clusters.push([stimulus]);
  }
  return freeze(clusters.map((members) => freeze({ representative: representative(members), members: freeze([...members]) })));
}

export function clusterSummary(clusters = []) {
  const safe = Array.isArray(clusters) ? clusters : [];
  return freeze({ clusters: safe.length, members: safe.reduce((sum, cluster) => sum + (cluster.members?.length || 0), 0), largest: safe.reduce((max, cluster) => Math.max(max, cluster.members?.length || 0), 0) });
}
