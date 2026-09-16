const MAX_HISTORY = 24;
const MAX_AMOUNT = 1;
const OUTCOMES = new Set([
  'dodge',
  'parry',
  'guard',
  'guard-break',
  'hit',
  'hit-stagger',
  'airborne-hit',
  'defeat',
]);

function clampUnit(value) {
  return Math.max(0, Math.min(MAX_AMOUNT, Number.isFinite(value) ? value : 0));
}

function normalizeOutcome(value) {
  const outcome = String(value ?? '').trim().toLowerCase();
  return OUTCOMES.has(outcome) ? outcome : 'hit';
}

function freezeReceipt(receipt) {
  return Object.freeze({
    ...receipt,
    haptics: Object.freeze({ ...receipt.haptics }),
    vfx: Object.freeze({ ...receipt.vfx }),
    sfx: Object.freeze({ ...receipt.sfx }),
  });
}

export function createPlayerCombatFeedbackEnvelope({ historyLimit = MAX_HISTORY } = {}) {
  const boundedHistoryLimit = Math.max(1, Math.min(MAX_HISTORY, Math.trunc(historyLimit) || MAX_HISTORY));
  let serial = 0;
  let disposed = false;
  const history = [];

  function emit(payload = {}) {
    if (disposed) return null;
    const outcome = normalizeOutcome(payload.outcome);
    const impact = clampUnit(payload.impact);
    const appliedDamage = Math.max(0, Number.isFinite(payload.appliedDamage) ? payload.appliedDamage : 0);
    const critical = payload.critical === true;
    const receipt = freezeReceipt({
      serial: ++serial,
      outcome,
      impact,
      appliedDamage,
      critical,
      targetId: payload.targetId == null ? null : String(payload.targetId),
      haptics: {
        low: clampUnit((outcome === 'guard' || outcome === 'parry' ? 0.2 : impact) * (critical ? 0.75 : 0.45)),
        high: clampUnit((outcome === 'hit-stagger' || outcome === 'guard-break' || outcome === 'defeat' ? 0.9 : impact) * (critical ? 1 : 0.65)),
      },
      vfx: {
        flash: outcome !== 'dodge',
        stagger: outcome === 'hit-stagger' || outcome === 'guard-break',
        defeat: outcome === 'defeat',
      },
      sfx: {
        cue: outcome === 'dodge' ? 'combat-dodge' : `combat-${outcome}`,
      },
    });
    history.push(receipt);
    if (history.length > boundedHistoryLimit) history.splice(0, history.length - boundedHistoryLimit);
    return receipt;
  }

  return Object.freeze({
    emit,
    snapshot() {
      return Object.freeze({
        serial,
        disposed,
        history: Object.freeze(history.slice()),
      });
    },
    dispose() {
      disposed = true;
      history.length = 0;
    },
  });
}

export function validatePlayerCombatFeedbackReceipt(receipt) {
  return Boolean(
    receipt &&
    Number.isInteger(receipt.serial) &&
    receipt.serial > 0 &&
    OUTCOMES.has(receipt.outcome) &&
    Number.isFinite(receipt.impact) &&
    receipt.impact >= 0 &&
    receipt.impact <= MAX_AMOUNT &&
    Number.isFinite(receipt.appliedDamage) &&
    receipt.appliedDamage >= 0 &&
    receipt.haptics &&
    receipt.vfx &&
    receipt.sfx,
  );
}
