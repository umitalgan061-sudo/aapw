const DEFAULTS = Object.freeze({
  maxActors: 64,
  threatRadius: 42,
  fleeRadius: 18,
  investigateRadius: 30,
  hearingWeight: 0.35,
  visualWeight: 0.65,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function actorId(actor, index) {
  const id = actor?.id ?? actor?.uuid ?? actor?.object3D?.userData?.id;
  return String(id ?? `fauna-${index}`);
}

function actorKind(actor) {
  return String(actor?.kind ?? actor?.species ?? actor?.type ?? 'fauna');
}

function distanceSquared(actor, origin) {
  const position = actor?.position ?? actor?.object3D?.position;
  if (!position || !origin) return Number.POSITIVE_INFINITY;
  const dx = finite(position.x) - finite(origin.x);
  const dy = finite(position.y) - finite(origin.y);
  const dz = finite(position.z) - finite(origin.z);
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function asIterable(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value[Symbol.iterator] === 'function') return value;
  return [];
}

function detectionChannel(visual, hearing) {
  if (visual > 0 && hearing > 0) return 'visual+hearing';
  if (visual > 0) return 'visual';
  if (hearing > 0) return 'hearing';
  return 'none';
}

function normalizeActor(actor, index, origin, options) {
  const distance = Math.sqrt(distanceSquared(actor, origin));
  if (!Number.isFinite(distance) || distance > options.threatRadius) return null;
  const visual = clamp01(actor?.perception?.visualConfidence ?? actor?.visualConfidence);
  const hearing = clamp01(actor?.perception?.hearingConfidence ?? actor?.hearingConfidence);
  const stealth = clamp01(actor?.stealth ?? actor?.stealthFactor);
  const confidence = clamp01(((visual * options.visualWeight) + (hearing * options.hearingWeight)) * (1 - stealth));
  const state = String(actor?.state ?? actor?.behaviorState ?? actor?.aiState ?? 'roam');
  const fleeing = Boolean(actor?.isFleeing ?? state === 'flee');
  const reacting = Boolean(actor?.isReacting ?? state === 'threatened' || state === 'investigate' || state === 'flee');
  const threatLevel = fleeing ? 'flee' : confidence >= 0.7 ? 'high' : confidence >= 0.35 ? 'medium' : 'low';
  return {
    id: actorId(actor, index),
    kind: actorKind(actor),
    state,
    distanceMeters: Number(distance.toFixed(3)),
    confidence: Number(confidence.toFixed(4)),
    visualConfidence: Number(visual.toFixed(4)),
    hearingConfidence: Number(hearing.toFixed(4)),
    detectionChannel: detectionChannel(visual, hearing),
    stealth: Number(stealth.toFixed(4)),
    fleeing,
    reacting,
    threatLevel,
    zone: distance <= options.fleeRadius ? 'flee' : distance <= options.investigateRadius ? 'investigate' : 'observe',
  };
}

export function createFaunaThreatPolicy(config = {}) {
  const options = Object.freeze({ ...DEFAULTS, ...config });

  function snapshot({ actors, origin = { x: 0, y: 0, z: 0 }, maxActors = options.maxActors } = {}) {
    const boundedMax = Math.max(0, Math.floor(finite(maxActors, options.maxActors)));
    const candidates = [];
    let scanned = 0;
    for (const actor of asIterable(actors)) {
      if (scanned >= boundedMax) break;
      const item = normalizeActor(actor, scanned, origin, options);
      scanned += 1;
      if (item) candidates.push(item);
    }
    candidates.sort((left, right) => left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id));
    return {
      actors: candidates,
      scanned,
      truncated: scanned >= boundedMax && boundedMax > 0,
      threatCount: candidates.length,
      fleeingCount: candidates.filter((item) => item.fleeing).length,
      reactingCount: candidates.filter((item) => item.reacting).length,
    };
  }

  function writeTelemetry(target, summary) {
    if (!target || !summary) return false;
    target.userData = target.userData && typeof target.userData === 'object' ? target.userData : {};
    target.userData.livingWorldFaunaThreat = {
      threatCount: summary.threatCount,
      fleeingCount: summary.fleeingCount,
      reactingCount: summary.reactingCount,
      truncated: Boolean(summary.truncated),
    };
    return true;
  }

  return Object.freeze({ snapshot, writeTelemetry });
}

export const DEFAULT_FAUNA_THREAT_POLICY = DEFAULTS;
