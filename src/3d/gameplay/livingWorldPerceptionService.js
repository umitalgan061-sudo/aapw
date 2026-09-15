/**
 * Deterministic perception adapter for the existing perception owner.
 *
 * This is a composition seam: it does not own ActorRegistry state, LOS geometry,
 * audio propagation or spawning. It normalizes the existing service output,
 * applies explicit visibility/audibility gates, collapses duplicate target
 * observations, and returns a bounded stable signal list for the reaction runtime.
 */

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const asId = (value, fallback = '') => value == null ? fallback : String(value);
const freeze = (value) => Object.freeze(value);

function signalScore(signal) {
  const modality = signal.visible ? 0.25 : signal.audible ? 0.15 : 0;
  const suspicion = signal.suspicious ? 0.2 : 0;
  const recency = Math.max(0, 0.2 - signal.ageSeconds * 0.01);
  const proximity = Number.isFinite(signal.distanceMeters)
    ? Math.max(0, 0.35 - signal.distanceMeters / 250)
    : 0;
  return clamp01(signal.confidence * 0.5 + modality + suspicion + recency + proximity);
}

function normalizeSignal(signal, index) {
  const visible = Boolean(signal?.visible);
  const audible = Boolean(signal?.audible);
  return freeze({
    id: asId(signal?.id, `signal-${index}`),
    kind: asId(signal?.kind, 'unknown'),
    targetId: asId(signal?.targetId ?? signal?.actorId, ''),
    position: signal?.position ? { x: finite(signal.position.x), z: finite(signal.position.z) } : null,
    confidence: clamp01(signal?.confidence),
    distanceMeters: Math.max(0, finite(signal?.distanceMeters, Infinity)),
    ageSeconds: Math.max(0, finite(signal?.ageSeconds, 0)),
    visible,
    audible,
    suspicious: Boolean(signal?.suspicious),
    severity: Math.max(0, Math.min(100, finite(signal?.severity, 0))),
    factionId: asId(signal?.factionId, ''),
    wanted: finite(signal?.wanted, 0),
    reputation: finite(signal?.reputation, 0),
    crime: signal?.crime ?? null,
  });
}

function stableTargetKey(signal) {
  return `${signal.targetId}|${signal.kind}|${signal.position?.x ?? ''}|${signal.position?.z ?? ''}`;
}

export function createLivingWorldPerceptionService({
  source = null,
  maxSignals = 12,
  requireModality = true,
  allowInvisibleSignals = false,
} = {}) {
  const boundedMax = Math.max(1, Math.min(64, Math.trunc(finite(maxSignals, 12))));

  function sense(actor, nowSeconds, options = {}) {
    const raw = source?.sense?.(actor, nowSeconds, options)
      ?? source?.sample?.(actor, nowSeconds, options)
      ?? source?.observe?.(actor, nowSeconds, options)
      ?? source?.getSignals?.(actor, nowSeconds, options)
      ?? [];
    if (!Array.isArray(raw)) return [];

    const bestByTarget = new Map();
    raw.slice(0, boundedMax * 4).forEach((entry, index) => {
      const signal = normalizeSignal(entry, index);
      if (requireModality && !signal.visible && !signal.audible && !allowInvisibleSignals) return;
      const key = stableTargetKey(signal);
      const previous = bestByTarget.get(key);
      if (!previous || signalScore(signal) > signalScore(previous)
        || (signalScore(signal) === signalScore(previous) && signal.id.localeCompare(previous.id) < 0)) {
        bestByTarget.set(key, signal);
      }
    });

    return [...bestByTarget.values()]
      .sort((a, b) => signalScore(b) - signalScore(a) || a.targetId.localeCompare(b.targetId) || a.id.localeCompare(b.id))
      .slice(0, boundedMax)
      .map((signal) => freeze({
        ...signal,
        target: freeze({
          id: signal.targetId,
          position: signal.position,
          source: signal.kind,
          factionId: signal.factionId,
          wanted: signal.wanted,
          reputation: signal.reputation,
          crime: signal.crime,
        }),
      }));
  }

  return freeze({ sense });
}
