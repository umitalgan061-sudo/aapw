/**
 * Canonical serialization helpers for stimulus orchestration replay/debug sessions.
 *
 * Snapshots intentionally contain only semantic, bounded data. They exclude callbacks, consumers,
 * renderer handles and mutable Maps so they can be persisted or compared safely.
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const text = (v) => String(v ?? '').slice(0, 128);

export const LIVING_WORLD_STIMULUS_SNAPSHOT_POLICY = freeze({
  id: 'living-world-stimulus-snapshot-2026-09-v1',
  maxActors: 128,
  maxSignals: 256,
  maxHistoryFrames: 16,
});

function actorSnapshot(actor, index) {
  return freeze({
    id: text(actor?.id || `actor-${index}`),
    role: text(actor?.role || 'unknown'),
    position: actor?.position ? freeze({ x: finite(actor.position.x), y: finite(actor.position.y), z: finite(actor.position.z) }) : null,
    staminaRatio: finite(actor?.staminaRatio, 1),
    healthRatio: finite(actor?.healthRatio, 1),
    currentIntent: actor?.currentIntent ? text(actor.currentIntent) : null,
    inCombat: Boolean(actor?.inCombat),
    defeated: Boolean(actor?.defeated),
    capabilities: freeze({
      canAttack: actor?.capabilities?.canAttack !== false,
      canAssist: actor?.capabilities?.canAssist !== false,
      canGather: actor?.capabilities?.canGather !== false,
      canSocialize: actor?.capabilities?.canSocialize !== false,
      canShelter: actor?.capabilities?.canShelter !== false,
      canPursue: actor?.capabilities?.canPursue !== false,
    }),
  });
}

function signalSnapshot(signal, index) {
  return freeze({
    id: text(signal?.id || `signal-${index}`),
    kind: text(signal?.kind || 'unknown'),
    channel: text(signal?.channel || 'system'),
    actorId: signal?.actorId ? text(signal.actorId) : null,
    targetId: signal?.targetId ? text(signal.targetId) : null,
    position: signal?.position ? freeze({ x: finite(signal.position.x), y: finite(signal.position.y), z: finite(signal.position.z) }) : null,
    confidence: finite(signal?.confidence),
    intensity: finite(signal?.intensity),
    radius: finite(signal?.radius),
    ageSeconds: finite(signal?.ageSeconds),
    timestampMs: finite(signal?.timestampMs),
    sequence: Math.max(0, Math.floor(finite(signal?.sequence, index))),
  });
}

export function createLivingWorldStimulusSnapshot({ tick = 0, nowSeconds = 0, actors = [], signals = [], plans = [], metadata = {} } = {}) {
  const safeActors = (Array.isArray(actors) ? actors : []).slice(0, LIVING_WORLD_STIMULUS_SNAPSHOT_POLICY.maxActors).map(actorSnapshot);
  const safeSignals = (Array.isArray(signals) ? signals : []).slice(0, LIVING_WORLD_STIMULUS_SNAPSHOT_POLICY.maxSignals).map(signalSnapshot);
  const safePlans = (Array.isArray(plans) ? plans : []).slice(0, LIVING_WORLD_STIMULUS_SNAPSHOT_POLICY.maxActors).map((plan, index) => freeze({
    actorId: text(plan?.actorId || `actor-${index}`),
    intent: text(plan?.intent || plan?.decision?.intent || 'observe'),
    confidence: finite(plan?.confidence ?? plan?.decision?.confidence),
    planId: text(plan?.planId || plan?.plan?.planId || 'none'),
    targetId: plan?.target?.id ? text(plan.target.id) : plan?.plan?.target?.id ? text(plan.plan.target.id) : null,
  }));
  safeActors.sort((a, b) => a.id.localeCompare(b.id));
  safeSignals.sort((a, b) => (a.timestampMs - b.timestampMs) || (a.sequence - b.sequence) || a.id.localeCompare(b.id));
  safePlans.sort((a, b) => a.actorId.localeCompare(b.actorId));
  return freeze({
    schema: LIVING_WORLD_STIMULUS_SNAPSHOT_POLICY.id,
    tick: Math.max(0, Math.floor(finite(tick))),
    nowSeconds: Math.max(0, finite(nowSeconds)),
    actors: freeze(safeActors),
    signals: freeze(safeSignals),
    plans: freeze(safePlans),
    metadata: freeze({ source: text(metadata.source || 'unknown'), session: text(metadata.session || '') }),
  });
}

export function serializeLivingWorldStimulusSnapshot(snapshot) {
  return JSON.stringify(snapshot || {});
}

export function parseLivingWorldStimulusSnapshot(serialized) {
  try {
    const parsed = JSON.parse(String(serialized || '{}'));
    if (parsed?.schema !== LIVING_WORLD_STIMULUS_SNAPSHOT_POLICY.id) return null;
    return createLivingWorldStimulusSnapshot(parsed);
  } catch {
    return null;
  }
}

export function snapshotDigest(snapshot) {
  const serialized = serializeLivingWorldStimulusSnapshot(snapshot);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
