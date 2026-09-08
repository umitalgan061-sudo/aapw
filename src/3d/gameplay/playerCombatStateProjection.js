const ACTIONS = Object.freeze(['idle', 'light', 'heavy', 'guard', 'parry', 'dodge', 'ranged-charge', 'ranged-release']);
const STANCES = Object.freeze(['neutral', 'combat', 'guarding', 'evading', 'stunned', 'dead']);

const clamp = (value, min, max, fallback = min) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const finite = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeAction = (value) => {
  const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ACTIONS.includes(action) ? action : 'idle';
};

const normalizeStance = ({ dead, stunned, guarding, evading, action }) => {
  if (dead) return 'dead';
  if (stunned) return 'stunned';
  if (evading || action === 'dodge') return 'evading';
  if (guarding || action === 'guard' || action === 'parry') return 'guarding';
  return action === 'idle' ? 'neutral' : 'combat';
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const stableJson = (value) => JSON.stringify(value, Object.keys(value).sort());

export function projectPlayerCombatState(input = {}) {
  const action = normalizeAction(input.action);
  const health = clamp(input.health, 0, Math.max(1, finite(input.maxHealth, 100)), 0);
  const maxHealth = Math.max(1, finite(input.maxHealth, 100));
  const stamina = clamp(input.stamina, 0, Math.max(1, finite(input.maxStamina, 100)), 0);
  const maxStamina = Math.max(1, finite(input.maxStamina, 100));
  const poise = clamp(input.poise, 0, Math.max(1, finite(input.maxPoise, 100)), 0);
  const maxPoise = Math.max(1, finite(input.maxPoise, 100));
  const dead = Boolean(input.dead) || health <= 0;
  const stunned = Boolean(input.stunned) || poise <= 0;
  const guarding = Boolean(input.guarding) || action === 'guard' || action === 'parry';
  const evading = Boolean(input.evading) || action === 'dodge';
  const comboIndex = Math.max(0, Math.floor(clamp(input.comboIndex, 0, 9, 0)));
  const recovery = clamp(input.recovery, 0, 1, 0);
  const hitStop = clamp(input.hitStop, 0, 0.5, 0);
  const lockedTargetId = typeof input.lockedTargetId === 'string' && input.lockedTargetId.trim()
    ? input.lockedTargetId.trim()
    : null;
  const equipmentRevision = typeof input.equipmentRevision === 'string' && input.equipmentRevision.trim()
    ? input.equipmentRevision.trim()
    : 'unassigned';
  const stance = normalizeStance({ dead, stunned, guarding, evading, action });

  const projection = {
    schema: 'player-combat-state-projection/v1',
    action: dead || stunned ? 'idle' : action,
    stance,
    alive: !dead,
    health: { current: health, max: maxHealth, ratio: clamp(health / maxHealth, 0, 1, 0) },
    stamina: { current: stamina, max: maxStamina, ratio: clamp(stamina / maxStamina, 0, 1, 0) },
    poise: { current: poise, max: maxPoise, ratio: clamp(poise / maxPoise, 0, 1, 0) },
    comboIndex,
    recovery,
    hitStop,
    lockOn: { active: Boolean(lockedTargetId) && !dead, targetId: lockedTargetId },
    equipmentRevision,
    capabilities: {
      canAttack: !dead && !stunned && recovery === 0 && stamina > 0,
      canGuard: !dead && !stunned && !evading,
      canDodge: !dead && !stunned && stamina > 0 && recovery === 0,
      canUseRanged: !dead && !stunned && recovery === 0 && stamina > 0,
    },
  };

  projection.digest = stableJson(projection);
  return deepFreeze(projection);
}

export default projectPlayerCombatState;
