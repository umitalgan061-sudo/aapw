/**
 * Deterministic action gate for player equipment transitions.
 *
 * This is a small adapter over the existing equipment/combat runtime. It decides
 * whether a requested swap/holster/draw action may start from caller-owned state;
 * the existing player state machine remains authoritative for mutation, timers,
 * sockets, animation mixers and scene updates.
 *
 * @module gameplay/playerEquipmentActionGate
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeAction = (value) => {
  const action = String(value || '').trim().toLowerCase();
  if (action === 'equip' || action === 'swap' || action === 'change') return 'swap';
  if (action === 'draw' || action === 'unsheathe') return 'draw';
  if (action === 'holster' || action === 'sheath') return 'holster';
  return action;
};

const ACTIONS = Object.freeze({ swap: Object.freeze({ duration: 0.42, stamina: 0, interruptible: true }), draw: Object.freeze({ duration: 0.3, stamina: 2, interruptible: false }), holster: Object.freeze({ duration: 0.26, stamina: 0, interruptible: true }) });
const BLOCKING_STATES = new Set(['attack', 'heavy-attack', 'dodge', 'hit-stagger', 'guard-break', 'defeat', 'dead']);
const SOFT_BLOCKING_STATES = new Set(['guard', 'parry', 'ranged-aim']);

function normalizeState(input = {}) {
  return {
    movementState: String(input.movementState || 'idle'),
    combatState: String(input.combatState || 'neutral'),
    grounded: input.grounded !== false,
    alive: input.alive !== false,
    staminaRatio: clamp(finite(input.staminaRatio, 1), 0, 1),
    poiseRatio: clamp(finite(input.poiseRatio, 1), 0, 1),
    socketBusy: Boolean(input.socketBusy),
    animationInterruptible: input.animationInterruptible !== false,
    lockOn: Boolean(input.lockOn),
    currentSlot: String(input.currentSlot || 'mainHand'),
  };
}

function reasonList(state, action, targetSlot, options) {
  const reasons = [];
  if (!state.alive) reasons.push('not-alive');
  if (!state.grounded && action !== 'draw') reasons.push('not-grounded');
  if (state.socketBusy) reasons.push('socket-busy');
  if (BLOCKING_STATES.has(state.combatState)) reasons.push('combat-state-blocked');
  if (SOFT_BLOCKING_STATES.has(state.combatState) && !options.allowSoftInterrupt) reasons.push('soft-state-blocked');
  if (!state.animationInterruptible && action !== 'draw') reasons.push('animation-not-interruptible');
  if (action === 'draw' && state.staminaRatio < 0.08) reasons.push('insufficient-stamina');
  if (action === 'swap' && state.currentSlot === targetSlot && !options.allowSameSlot) reasons.push('same-slot');
  if (targetSlot === 'offHand' && options.twoHanded) reasons.push('two-handed-offhand-conflict');
  if (state.lockOn && action === 'holster' && !options.allowLockOnHolster) reasons.push('lock-on-holster-blocked');
  return reasons;
}

export function resolvePlayerEquipmentActionGate(input = {}, {
  action = 'swap',
  targetSlot = 'mainHand',
  allowSoftInterrupt = false,
  allowSameSlot = false,
  allowLockOnHolster = false,
  twoHanded = false,
  cooldownRemaining = 0,
} = {}) {
  const normalizedAction = normalizeAction(action);
  const state = normalizeState(input);
  const profile = ACTIONS[normalizedAction] || null;
  const cooldown = Math.max(0, finite(cooldownRemaining, 0));
  const reasons = profile ? reasonList(state, normalizedAction, String(targetSlot), { allowSoftInterrupt, allowSameSlot, allowLockOnHolster, twoHanded }) : ['unsupported-action'];
  if (cooldown > 0) reasons.push('cooldown');
  const accepted = reasons.length === 0;
  const transition = profile ? Object.freeze({
    action: normalizedAction,
    targetSlot: String(targetSlot),
    durationSeconds: profile.duration,
    staminaCost: profile.stamina,
    interruptibleAfterSeconds: profile.interruptible ? profile.duration * 0.35 : profile.duration,
    preserveLockOn: state.lockOn && normalizedAction !== 'holster',
  }) : null;
  return Object.freeze({
    accepted,
    action: normalizedAction,
    targetSlot: String(targetSlot),
    reasons: Object.freeze(reasons),
    state: Object.freeze(state),
    transition,
    cooldownRemaining: cooldown,
  });
}

export function buildPlayerEquipmentActionQueue(input = {}, requests = []) {
  const queue = [];
  const rejected = [];
  const seenSlots = new Set();
  for (const request of Array.isArray(requests) ? requests : []) {
    const targetSlot = String(request?.targetSlot || 'mainHand');
    if (seenSlots.has(targetSlot)) {
      rejected.push(Object.freeze({ request, reason: 'duplicate-slot-request' }));
      continue;
    }
    const receipt = resolvePlayerEquipmentActionGate(input, request || {});
    if (receipt.accepted) {
      seenSlots.add(targetSlot);
      queue.push(receipt);
    } else {
      rejected.push(Object.freeze({ request, reason: receipt.reasons[0] || 'rejected' }));
    }
  }
  return Object.freeze({
    accepted: Object.freeze(queue),
    rejected: Object.freeze(rejected),
    nextAction: queue[0] || null,
    totalDurationSeconds: Number(queue.reduce((total, item) => total + item.transition.durationSeconds, 0).toFixed(4)),
  });
}

export function validatePlayerEquipmentActionGateReceipt(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object') errors.push('missing-receipt');
  if (receipt && typeof receipt.accepted !== 'boolean') errors.push('invalid-accepted');
  if (receipt && !Array.isArray(receipt.reasons)) errors.push('invalid-reasons');
  if (receipt?.accepted && !receipt.transition) errors.push('accepted-without-transition');
  if (receipt?.transition && receipt.transition.durationSeconds <= 0) errors.push('non-positive-duration');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
