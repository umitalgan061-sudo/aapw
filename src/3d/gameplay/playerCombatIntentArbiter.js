const ACTION_PRIORITY = Object.freeze({
  heavyAttack: 50,
  lightAttack: 40,
  dodge: 30,
  block: 20,
  lockOn: 10,
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ACTIONS = new Set(Object.keys(ACTION_PRIORITY));

function normalizeIntent(intent = {}) {
  const action = typeof intent.action === 'string' ? intent.action : 'none';
  const source = typeof intent.source === 'string' ? intent.source : 'unknown';
  const pressed = intent.pressed === true;
  const held = intent.held === true;
  const strength = clamp(finite(intent.strength, 1), 0, 1);
  return {
    action: ACTIONS.has(action) ? action : 'none',
    source,
    pressed,
    held,
    strength,
    serial: Math.max(0, Math.floor(finite(intent.serial))),
  };
}

function compareIntents(a, b) {
  const priorityDelta = (ACTION_PRIORITY[b.action] ?? 0) - (ACTION_PRIORITY[a.action] ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  if (Number(b.pressed) !== Number(a.pressed)) return Number(b.pressed) - Number(a.pressed);
  if (Number(b.held) !== Number(a.held)) return Number(b.held) - Number(a.held);
  if (b.strength !== a.strength) return b.strength - a.strength;
  if (a.source !== b.source) return a.source.localeCompare(b.source);
  return a.serial - b.serial;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export function resolvePlayerCombatIntent(input = {}) {
  const raw = Array.isArray(input.intents) ? input.intents : [];
  const intents = raw.map(normalizeIntent).filter((intent) => intent.action !== 'none');
  const ordered = [...intents].sort(compareIntents);
  const winner = ordered[0] ?? {
    action: 'none', source: 'none', pressed: false, held: false, strength: 0, serial: 0,
  };
  const blocked = ordered.slice(1).map((intent) => intent.action);
  return freeze({
    action: winner.action,
    source: winner.source,
    pressed: winner.pressed,
    held: winner.held,
    strength: winner.strength,
    serial: winner.serial,
    candidates: ordered.map((intent) => intent.action),
    blocked,
    priority: ACTION_PRIORITY[winner.action] ?? 0,
    accepted: winner.action !== 'none' && (winner.pressed || winner.held),
    ownership: Object.freeze({
      input: 'src/3d/gameplay/playerInputParity.js',
      state: 'src/3d/gameplay/player.js',
      router: 'src/3d/gameplay/playerCombatActionRouter.js',
      role: 'read-only arbitration boundary',
    }),
  });
}

export function validatePlayerCombatIntent(result) {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.action !== 'string' || !Array.isArray(result.candidates)) return false;
  if (!Number.isFinite(result.priority) || !Number.isFinite(result.strength)) return false;
  if (result.strength < 0 || result.strength > 1) return false;
  return Object.isFrozen(result) && Object.isFrozen(result.ownership);
}

export { ACTION_PRIORITY, compareIntents, normalizeIntent };