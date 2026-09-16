/**
 * Deterministic light/heavy combo timing policy for the existing player combat runtime.
 *
 * This module is intentionally a pure adapter: it does not own input, state, timers,
 * animation clips, damage, hitboxes, or scene objects. The existing player/combat
 * directors remain authoritative and may consume the returned immutable receipt.
 *
 * @module gameplay/playerCombatComboWindowDirector
 */

const MAX_STEPS = 4;
const MAX_HISTORY = 8;
const DEFAULT_PROFILE = Object.freeze({
  light: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ step: 1, windowMs: 420, bufferMs: 180, recoveryMs: 260 }),
      Object.freeze({ step: 2, windowMs: 460, bufferMs: 190, recoveryMs: 280 }),
      Object.freeze({ step: 3, windowMs: 520, bufferMs: 210, recoveryMs: 340 }),
    ]),
    resetMs: 720,
  }),
  heavy: Object.freeze({
    steps: Object.freeze([
      Object.freeze({ step: 1, windowMs: 560, bufferMs: 130, recoveryMs: 420 }),
      Object.freeze({ step: 2, windowMs: 640, bufferMs: 150, recoveryMs: 480 }),
    ]),
    resetMs: 900,
  }),
});

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const freeze = (value) => Object.freeze(value);

function normalizeKind(kind) {
  return kind === 'heavy' ? 'heavy' : kind === 'light' ? 'light' : null;
}

function normalizeProfile(profile = DEFAULT_PROFILE) {
  const source = profile && typeof profile === 'object' ? profile : DEFAULT_PROFILE;
  const normalized = {};
  for (const kind of ['light', 'heavy']) {
    const sourceKind = source[kind] && typeof source[kind] === 'object' ? source[kind] : DEFAULT_PROFILE[kind];
    const sourceSteps = Array.isArray(sourceKind.steps) ? sourceKind.steps : DEFAULT_PROFILE[kind].steps;
    const steps = sourceSteps.slice(0, MAX_STEPS).map((entry, index) => freeze({
      step: index + 1,
      windowMs: clamp(finite(entry?.windowMs, DEFAULT_PROFILE[kind].steps[index]?.windowMs ?? 400), 80, 1200),
      bufferMs: clamp(finite(entry?.bufferMs, DEFAULT_PROFILE[kind].steps[index]?.bufferMs ?? 160), 0, 500),
      recoveryMs: clamp(finite(entry?.recoveryMs, DEFAULT_PROFILE[kind].steps[index]?.recoveryMs ?? 280), 0, 1500),
    }));
    normalized[kind] = freeze({
      steps: freeze(steps.length ? steps : DEFAULT_PROFILE[kind].steps),
      resetMs: clamp(finite(sourceKind.resetMs, DEFAULT_PROFILE[kind].resetMs), 100, 2000),
    });
  }
  return freeze(normalized);
}

function cloneReceipt(receipt) {
  return freeze({
    ...receipt,
    step: freeze({ ...receipt.step }),
    timing: freeze({ ...receipt.timing }),
    chain: freeze({ ...receipt.chain }),
  });
}

export function createPlayerCombatComboWindowDirector({ profile = DEFAULT_PROFILE, maxHistory = MAX_HISTORY } = {}) {
  const normalizedProfile = normalizeProfile(profile);
  const historyLimit = clamp(Math.trunc(finite(maxHistory, MAX_HISTORY)), 1, MAX_HISTORY);
  let serial = 0;
  let disposed = false;
  let active = null;
  const history = [];

  const snapshot = () => freeze({
    disposed,
    serial,
    active: active ? cloneReceipt(active) : null,
    history: freeze(history.map(cloneReceipt)),
  });

  const reset = (reason = 'manual') => {
    if (disposed) return snapshot();
    active = null;
    serial += 1;
    history.push(cloneReceipt({
      serial,
      kind: 'reset',
      accepted: true,
      reason: String(reason),
      timestampMs: 0,
      step: { index: 0, label: 'reset' },
      timing: { windowMs: 0, bufferMs: 0, recoveryMs: 0, resetMs: 0 },
      chain: { previousSerial: Math.max(0, serial - 1), continues: false },
    }));
    while (history.length > historyLimit) history.shift();
    return snapshot();
  };

  const advance = ({ kind, timestampMs = 0, bufferedAtMs = timestampMs, interrupted = false } = {}) => {
    if (disposed) return freeze({ accepted: false, reason: 'disposed', snapshot: snapshot() });
    const normalizedKind = normalizeKind(kind);
    if (!normalizedKind) return freeze({ accepted: false, reason: 'unsupported-kind', snapshot: snapshot() });
    const now = Math.max(0, finite(timestampMs, 0));
    const bufferedAt = Math.max(0, finite(bufferedAtMs, now));
    if (interrupted) return freeze({ accepted: false, reason: 'interrupted', snapshot: snapshot() });

    const profileEntry = normalizedProfile[normalizedKind];
    const previous = active && active.kind === normalizedKind ? active : null;
    const elapsed = previous ? Math.max(0, now - previous.timestampMs) : Infinity;
    const continues = Boolean(previous && elapsed <= previous.timing.resetMs);
    const nextIndex = continues ? Math.min(previous.step.index + 1, profileEntry.steps.length) : 1;
    const step = profileEntry.steps[nextIndex - 1];
    const withinBuffer = continues && elapsed >= Math.max(0, step.windowMs - step.bufferMs);

    serial += 1;
    const receipt = cloneReceipt({
      serial,
      kind: normalizedKind,
      accepted: true,
      reason: continues ? (withinBuffer ? 'buffered-chain' : 'chain-advance') : 'chain-start',
      timestampMs: now,
      bufferedAtMs: bufferedAt,
      step: { index: step.step, label: `${normalizedKind}-${step.step}` },
      timing: {
        windowMs: step.windowMs,
        bufferMs: step.bufferMs,
        recoveryMs: step.recoveryMs,
        resetMs: profileEntry.resetMs,
      },
      chain: {
        previousSerial: previous?.serial ?? 0,
        continues,
        withinBuffer,
        elapsedMs: Number.isFinite(elapsed) ? elapsed : null,
      },
    });

    active = receipt;
    history.push(receipt);
    while (history.length > historyLimit) history.shift();
    return freeze({ accepted: true, receipt, snapshot: snapshot() });
  };

  return freeze({
    advance,
    reset,
    snapshot,
    dispose() {
      disposed = true;
      active = null;
      history.length = 0;
      serial += 1;
      return snapshot();
    },
    getProfile() {
      return normalizedProfile;
    },
  });
}

export function validatePlayerCombatComboWindowReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (receipt.accepted !== true || !['light', 'heavy'].includes(receipt.kind)) return false;
  if (!Number.isInteger(receipt.serial) || receipt.serial < 1) return false;
  if (!Number.isInteger(receipt.step?.index) || receipt.step.index < 1) return false;
  for (const key of ['windowMs', 'bufferMs', 'recoveryMs', 'resetMs']) {
    if (!Number.isFinite(receipt.timing?.[key]) || receipt.timing[key] < 0) return false;
  }
  return typeof receipt.chain?.continues === 'boolean';
}

export { DEFAULT_PROFILE as PLAYER_COMBAT_COMBO_DEFAULT_PROFILE };
