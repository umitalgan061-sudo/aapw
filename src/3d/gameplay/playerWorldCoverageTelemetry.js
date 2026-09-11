/**
 * Bounded telemetry projection for Player World Coverage.
 *
 * Converts a context snapshot into compact counters suitable for runtime/browser proof. It never
 * logs raw player input, never persists world state and never becomes a gameplay authority.
 *
 * @module gameplay/playerWorldCoverageTelemetry
 */

const MAX_EVENTS = 128;

function n(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, n(value, min)));
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => freeze(child, seen));
  return Object.freeze(value);
}

export function createPlayerWorldCoverageTelemetry({ maxEvents = MAX_EVENTS } = {}) {
  const limit = Math.max(1, Math.min(MAX_EVENTS, Math.floor(n(maxEvents, MAX_EVENTS))));
  const events = [];
  let sequence = 0;
  let disposed = false;

  function push(snapshot, label = 'frame') {
    if (disposed) throw new Error('player-world-coverage-telemetry-disposed');
    sequence += 1;
    events.push({
      sequence,
      label: String(label).slice(0, 64),
      fingerprint: snapshot?.fingerprint ?? null,
      playerCellId: snapshot?.coverage?.playerCell?.id ?? null,
      coverageRatio: clamp(snapshot?.coverage?.coverageRatio, 0, 1),
      groundConfidence: clamp(snapshot?.grounding?.confidence, 0, 1),
      combatReady: snapshot?.combat?.eligible === true,
      movementScale: clamp(snapshot?.movement?.locomotionSpeedScale, 0, 2),
      footPlantWeight: clamp(snapshot?.animation?.footPlantWeight, 0, 1),
      surface: snapshot?.surfaceContext?.dominantSurface ?? 'unknown',
      biome: snapshot?.selectedSample?.biome ?? 'unknown',
    });
    while (events.length > limit) events.shift();
    return events.at(-1);
  }

  function summary() {
    const combatReadyCount = events.filter((event) => event.combatReady).length;
    const grounded = events.filter((event) => event.groundConfidence >= 0.9).length;
    return freeze({
      sequence,
      eventCount: events.length,
      combatReadyCount,
      groundedHighConfidenceCount: grounded,
      latest: events.at(-1) ?? null,
    });
  }

  function exportEvidence() {
    return freeze({ version: 1, eventCount: events.length, sequence, events: events.slice() });
  }

  function reset() {
    if (disposed) throw new Error('player-world-coverage-telemetry-disposed');
    events.length = 0;
    sequence = 0;
  }

  function dispose() {
    disposed = true;
    events.length = 0;
  }

  return Object.freeze({
    push,
    summary,
    exportEvidence,
    reset,
    dispose,
    get isDisposed() { return disposed; },
    get eventCount() { return events.length; },
  });
}

export function validatePlayerWorldCoverageTelemetry(value) {
  const errors = [];
  if (!value || typeof value !== 'object') errors.push('missing-telemetry');
  if (typeof value?.push !== 'function') errors.push('missing-push');
  if (typeof value?.summary !== 'function') errors.push('missing-summary');
  if (typeof value?.dispose !== 'function') errors.push('missing-dispose');
  return Object.freeze({ ok: errors.length === 0, errors });
}
