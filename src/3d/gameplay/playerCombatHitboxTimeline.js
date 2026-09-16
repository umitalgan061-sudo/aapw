/**
 * Deterministic hitbox/hurtbox timeline over the existing equipment combat rules.
 *
 * The player state machine remains authoritative for timers, transforms, collision and damage.
 * This adapter only derives bounded windows and immutable receipts for existing consumers.
 *
 * @module gameplay/playerCombatHitboxTimeline
 */

import { buildPlayerHitboxHurtboxContract, resolvePlayerCombatEnvelope } from './playerEquipmentCombatRules.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeKind = (value) => value === 'heavy' ? 'heavy' : value === 'ranged' || value === 'archery' ? 'ranged' : 'light';
const freeze = (value) => Object.freeze(value);

function normalizeProgress(progress) {
  return clamp(finite(progress, 0), 0, 1);
}

function resolveWindow(profile, kind, { grounded = true, crouching = false, stance = 'neutral' } = {}) {
  const normalizedKind = normalizeKind(kind);
  const envelopeKind = normalizedKind === 'heavy' ? 'heavy' : 'light';
  const envelope = resolvePlayerCombatEnvelope(profile, { kind: envelopeKind });
  const ranged = normalizedKind === 'ranged';
  const activeStart = ranged ? 0.32 : envelope.activeStart / envelope.duration;
  const activeEnd = ranged ? 0.54 : envelope.activeEnd / envelope.duration;
  const contract = buildPlayerHitboxHurtboxContract(profile, {
    grounded,
    crouching,
    attackKind: envelopeKind,
    stance,
  });
  return freeze({
    kind: normalizedKind,
    duration: ranged ? 0.58 : envelope.duration,
    activeStart: clamp(activeStart, 0, 0.95),
    activeEnd: clamp(activeEnd, activeStart, 1),
    hitbox: freeze({ ...contract.hitbox, attackKind: normalizedKind }),
    hurtbox: contract.hurtbox,
    separation: contract.separation,
  });
}

export function createPlayerCombatHitboxTimeline(profileInput = {}, options = {}) {
  const profile = profileInput?.mainHand ? profileInput : profileInput;
  let disposed = false;
  let sequence = 0;
  let lastProgress = 0;
  const history = [];
  const historyLimit = clamp(Math.trunc(finite(options.historyLimit, 24)), 1, 128);

  const snapshot = (input = {}) => {
    if (disposed) {
      return freeze({ disposed: true, sequence, phase: 'disposed', hitboxActive: false, hurtboxActive: false, canConfirmHit: false });
    }
    const progress = normalizeProgress(input.progress);
    const window = resolveWindow(profile, input.kind, input);
    const hitboxActive = progress >= window.activeStart && progress <= window.activeEnd && input.targetPresent !== false;
    const hurtboxActive = input.defeated !== true && input.invulnerable !== true;
    const phase = input.defeated === true ? 'defeated'
      : input.interrupted === true ? 'interrupted'
        : progress < window.activeStart ? 'windup'
          : progress <= window.activeEnd ? 'active'
            : 'recovery';
    const receipt = freeze({
      sequence: ++sequence,
      progress,
      kind: window.kind,
      phase,
      hitboxActive,
      hurtboxActive,
      canConfirmHit: hitboxActive && hurtboxActive,
      targetPresent: input.targetPresent !== false,
      grounded: input.grounded !== false,
      hitbox: window.hitbox,
      hurtbox: window.hurtbox,
      separation: window.separation,
    });
    lastProgress = progress;
    history.push(receipt);
    while (history.length > historyLimit) history.shift();
    return receipt;
  };

  return freeze({
    snapshot,
    getHistory: () => freeze(history.slice()),
    getState: () => freeze({ disposed, sequence, lastProgress, historySize: history.length }),
    dispose: () => { disposed = true; history.length = 0; },
  });
}

export function validatePlayerCombatHitboxTimeline(input = {}) {
  const timeline = createPlayerCombatHitboxTimeline(input.profile || input.equipment || {}, { historyLimit: 8 });
  const receipts = [0, 0.2, 0.4, 0.8].map((progress) => timeline.snapshot({
    progress,
    kind: input.kind || 'light',
    grounded: input.grounded !== false,
    targetPresent: input.targetPresent !== false,
  }));
  const errors = [];
  if (receipts.some((receipt) => receipt.sequence <= 0)) errors.push('missing-sequence');
  if (receipts.some((receipt) => receipt.hitboxActive && !receipt.hurtboxActive)) errors.push('active-hitbox-without-hurtbox');
  if (receipts[0].phase !== 'windup') errors.push('invalid-windup-phase');
  if (receipts.at(-1).phase !== 'recovery') errors.push('invalid-recovery-phase');
  timeline.dispose();
  const disposed = timeline.snapshot({ progress: 0.4, kind: input.kind || 'light' });
  if (!disposed.disposed || disposed.canConfirmHit) errors.push('dispose-not-fail-closed');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), receipts: freeze(receipts) });
}
