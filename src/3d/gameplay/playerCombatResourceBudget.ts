/**
 * Pure presentation adapter over the existing player combat rules.
 * It does not mutate player state, stamina, poise, timers or animation mixers.
 */

import { resolvePlayerCombatEnvelope, resolvePlayerDefenseRules, resolvePlayerDodgeRules, resolvePlayerRangedRules } from './playerEquipmentCombatRules.ts';

const clamp = (value: unknown, min: number, max: number, fallback = min) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
};

const freeze = <T>(value: T): T => Object.freeze(value);

export type PlayerCombatResourceBudget = Readonly<{
  version: 1;
  action: 'light' | 'heavy' | 'guard' | 'parry' | 'dodge' | 'ranged';
  allowed: boolean;
  reason: string;
  staminaBefore: number;
  staminaCost: number;
  staminaAfter: number;
  poiseBefore: number;
  poiseReserve: number;
  poiseAfter: number;
  recoverySeconds: number;
  replayKey: string;
}>;

const normalizeAction = (value: unknown): PlayerCombatResourceBudget['action'] => {
  if (value === 'heavy' || value === 'guard' || value === 'parry' || value === 'dodge' || value === 'ranged') return value;
  return 'light';
};

const stableKey = (budget: Omit<PlayerCombatResourceBudget, 'replayKey'>) => [
  budget.version,
  budget.action,
  budget.allowed ? 'allow' : 'deny',
  budget.reason,
  budget.staminaBefore.toFixed(4),
  budget.staminaCost.toFixed(4),
  budget.staminaAfter.toFixed(4),
  budget.poiseBefore.toFixed(4),
  budget.poiseReserve.toFixed(4),
  budget.poiseAfter.toFixed(4),
  budget.recoverySeconds.toFixed(4),
].join('|');

export function resolvePlayerCombatResourceBudget(profileInput: Record<string, unknown> = {}, {
  action = 'light',
  staminaRatio = 1,
  poiseRatio = 1,
  grounded = true,
  attackBusy = false,
  guardBreak = false,
  guardInput = false,
  parryWindowOpen = false,
  dodgeInvulnerable = false,
  lockOn = false,
  moving = false,
}: Record<string, unknown> = {}): PlayerCombatResourceBudget {
  const normalizedAction = normalizeAction(action);
  const staminaBefore = clamp(staminaRatio, 0, 1, 1);
  const poiseBefore = clamp(poiseRatio, 0, 1, 1);
  const envelope = resolvePlayerCombatEnvelope(profileInput, { kind: normalizedAction === 'heavy' ? 'heavy' : 'light', staminaRatio: staminaBefore, poiseRatio: poiseBefore });
  const defense = resolvePlayerDefenseRules(profileInput, { staminaRatio: staminaBefore, poiseRatio: poiseBefore, guardInput: Boolean(guardInput), parryWindowOpen: Boolean(parryWindowOpen), dodgeInvulnerable: Boolean(dodgeInvulnerable) });
  const dodge = resolvePlayerDodgeRules(profileInput, { staminaRatio: staminaBefore, grounded: grounded !== false, attackBusy: Boolean(attackBusy), guardBreak: Boolean(guardBreak) });
  const ranged = resolvePlayerRangedRules(profileInput, { staminaRatio: staminaBefore, lockOn: Boolean(lockOn), moving: Boolean(moving) });

  let staminaCost = 0;
  let poiseReserve = 0.1;
  let recoverySeconds = 0.18;
  let allowed = true;
  let reason = 'ready';

  if (normalizedAction === 'light' || normalizedAction === 'heavy') {
    staminaCost = envelope.staminaCost;
    poiseReserve = normalizedAction === 'heavy' ? 0.24 : 0.14;
    recoverySeconds = normalizedAction === 'heavy' ? 0.62 : 0.38;
    if (attackBusy) { allowed = false; reason = 'attack-busy'; }
    else if (guardBreak) { allowed = false; reason = 'guard-break'; }
    else if (staminaBefore * 100 < staminaCost) { allowed = false; reason = 'stamina-low'; }
    else if (poiseBefore < poiseReserve) { allowed = false; reason = 'poise-low'; }
  } else if (normalizedAction === 'guard' || normalizedAction === 'parry') {
    staminaCost = normalizedAction === 'parry' ? 8 : 3;
    poiseReserve = normalizedAction === 'parry' ? 0.2 : 0.08;
    recoverySeconds = normalizedAction === 'parry' ? 0.28 : 0.12;
    const available = normalizedAction === 'parry' ? defense.parryAvailable : defense.guardAvailable;
    if (!available) { allowed = false; reason = normalizedAction === 'parry' ? 'parry-window-closed' : 'guard-unavailable'; }
    else if (staminaBefore * 100 < staminaCost) { allowed = false; reason = 'stamina-low'; }
  } else if (normalizedAction === 'dodge') {
    staminaCost = dodge.staminaCost;
    poiseReserve = 0.18;
    recoverySeconds = dodge.cooldownSeconds;
    if (!dodge.canStart) { allowed = false; reason = grounded === false ? 'airborne' : attackBusy ? 'attack-busy' : guardBreak ? 'guard-break' : 'stamina-low'; }
  } else if (normalizedAction === 'ranged') {
    staminaCost = Math.round(ranged.drawStaminaRatio * 100);
    poiseReserve = 0.12;
    recoverySeconds = ranged.stableAim ? 0.3 : 0.42;
    if (!ranged.ranged) { allowed = false; reason = 'not-ranged-loadout'; }
    else if (staminaBefore * 100 < staminaCost) { allowed = false; reason = 'stamina-low'; }
  }

  const staminaAfter = clamp(staminaBefore - (allowed ? staminaCost / 100 : 0), 0, 1, staminaBefore);
  const poiseAfter = clamp(poiseBefore - (allowed ? poiseReserve * 0.08 : 0), 0, 1, poiseBefore);
  const draft = {
    version: 1 as const,
    action: normalizedAction,
    allowed,
    reason,
    staminaBefore: Number(staminaBefore.toFixed(4)),
    staminaCost: Number(staminaCost.toFixed(4)),
    staminaAfter: Number(staminaAfter.toFixed(4)),
    poiseBefore: Number(poiseBefore.toFixed(4)),
    poiseReserve: Number(poiseReserve.toFixed(4)),
    poiseAfter: Number(poiseAfter.toFixed(4)),
    recoverySeconds: Number(recoverySeconds.toFixed(4)),
  };
  return freeze({ ...draft, replayKey: stableKey(draft) });
}

export function isPlayerCombatResourceBudget(value: unknown): value is PlayerCombatResourceBudget {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.action !== 'string' || typeof candidate.allowed !== 'boolean' || typeof candidate.reason !== 'string') return false;
  for (const field of ['staminaBefore', 'staminaCost', 'staminaAfter', 'poiseBefore', 'poiseReserve', 'poiseAfter', 'recoverySeconds']) {
    if (!Number.isFinite(Number(candidate[field]))) return false;
  }
  if (typeof candidate.replayKey !== 'string') return false;
  const { replayKey, ...rest } = candidate as PlayerCombatResourceBudget & Record<string, unknown>;
  return replayKey === stableKey(rest as Omit<PlayerCombatResourceBudget, 'replayKey'>);
}
