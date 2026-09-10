/**
 * Deterministic action affordances for the existing player combat caller.
 *
 * This module is read-only: the caller remains authoritative for input polling,
 * stamina/health mutation, animation, hitboxes, camera and scene state.
 * @module gameplay/playerCombatActionAffordanceDirector
 */

const ACTIONS = Object.freeze([
  'lightAttack',
  'heavyAttack',
  'rangedAim',
  'block',
  'parry',
  'dodge',
]);

const finite = (value, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const bool = (value) => value === true;

const normalizeNumber = (value, min, max, fallback = min) => (
  clamp(finite(value, fallback), min, max)
);

const normalizeAction = (action) => {
  if (typeof action !== 'string') return null;
  const normalized = action.trim();
  return ACTIONS.includes(normalized) ? normalized : null;
};

const normalizeSnapshot = (snapshot = {}) => ({
  alive: snapshot.alive !== false,
  stunned: bool(snapshot.stunned),
  grounded: snapshot.grounded !== false,
  attacking: bool(snapshot.attacking),
  guarding: bool(snapshot.guarding),
  aiming: bool(snapshot.aiming),
  inRecovery: bool(snapshot.inRecovery),
  canDodge: snapshot.canDodge !== false,
  hasRangedWeapon: bool(snapshot.hasRangedWeapon),
  stamina: normalizeNumber(snapshot.stamina, 0, 100, 0),
  staminaMax: normalizeNumber(snapshot.staminaMax, 1, 1000, 100),
  attackCost: normalizeNumber(snapshot.attackCost, 0, 1000, 10),
  heavyCost: normalizeNumber(snapshot.heavyCost, 0, 1000, 20),
  dodgeCost: normalizeNumber(snapshot.dodgeCost, 0, 1000, 15),
  blockCost: normalizeNumber(snapshot.blockCost, 0, 1000, 0),
  parryCost: normalizeNumber(snapshot.parryCost, 0, 1000, 5),
  rangedCost: normalizeNumber(snapshot.rangedCost, 0, 1000, 0),
});

const reasonFor = (action, state) => {
  if (!state.alive) return 'defeated';
  if (state.stunned) return 'stunned';
  if (state.inRecovery && action !== 'block') return 'recovery';
  if ((action === 'lightAttack' || action === 'heavyAttack') && (state.attacking || state.aiming)) return 'busy';
  if (action === 'rangedAim' && !state.hasRangedWeapon) return 'no-ranged-weapon';
  if (action === 'rangedAim' && state.attacking) return 'busy';
  if (action === 'dodge' && (!state.grounded || !state.canDodge)) return state.grounded ? 'dodge-disabled' : 'airborne';
  if ((action === 'lightAttack' || action === 'heavyAttack' || action === 'dodge' || action === 'parry') && state.stamina <= 0) return 'no-stamina';
  const cost = {
    lightAttack: state.attackCost,
    heavyAttack: state.heavyCost,
    dodge: state.dodgeCost,
    block: state.blockCost,
    parry: state.parryCost,
    rangedAim: state.rangedCost,
  }[action];
  if (state.stamina < cost) return 'insufficient-stamina';
  return null;
};

const costFor = (action, state) => ({
  lightAttack: state.attackCost,
  heavyAttack: state.heavyCost,
  dodge: state.dodgeCost,
  block: state.blockCost,
  parry: state.parryCost,
  rangedAim: state.rangedCost,
}[action]);

export function buildPlayerCombatActionAffordances(input = {}) {
  const state = normalizeSnapshot(input.snapshot);
  const requested = normalizeAction(input.requestedAction);
  const rows = ACTIONS.map((action) => {
    const reason = reasonFor(action, state);
    const cost = costFor(action, state);
    return {
      action,
      available: reason === null,
      reason,
      cost,
      remainingStamina: clamp(state.stamina - cost, 0, state.staminaMax),
    };
  });
  const requestedRow = rows.find((row) => row.action === requested) || null;
  const availableActions = rows.filter((row) => row.available).map((row) => row.action);
  return Object.freeze({
    requestedAction: requested,
    requestedAvailable: requestedRow ? requestedRow.available : false,
    requestedReason: requestedRow ? requestedRow.reason : (requested ? 'unsupported-action' : 'none'),
    availableActions: Object.freeze(availableActions),
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    state: Object.freeze({
      grounded: state.grounded,
      attacking: state.attacking,
      guarding: state.guarding,
      aiming: state.aiming,
      inRecovery: state.inRecovery,
      stamina: state.stamina,
      staminaMax: state.staminaMax,
    }),
  });
}

export const serializePlayerCombatActionAffordances = (plan) => JSON.stringify(plan);
