/**
 * Player / Combat / Animation / Equipment Director.
 *
 * This is a DOM-free adapter over the existing createPlayer() state machine. It does not own
 * movement, damage, inventory or scene mutation; it only normalizes input intents, chooses a
 * target, resolves equipment presentation metadata and derives animation/VFX/SFX cues for the
 * existing runtime/event consumers.
 *
 * @module gameplay/playerCombatAnimationDirector
 */

const ACTIONS = Object.freeze(['light', 'heavy', 'guard', 'parry', 'dodge', 'lockOn', 'interact']);
const CHANNELS = Object.freeze(['keyboard', 'pointer', 'gamepad', 'touch']);
const DEFAULT_EQUIPMENT = Object.freeze({
  weapon: Object.freeze({ id: 'unarmed', kind: 'melee', damage: 0, reachMeters: 1.25, socket: 'rightHand' }),
  offhand: Object.freeze({ id: 'none', kind: 'none', guardMultiplier: 1 }),
  armor: Object.freeze({ id: 'traveler', poise: 0, staminaMultiplier: 1 }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeInputIntent(raw = {}) {
  const channel = CHANNELS.includes(raw.channel) ? raw.channel : 'keyboard';
  const action = ACTIONS.includes(raw.action) ? raw.action : 'interact';
  const pressed = Boolean(raw.pressed);
  const held = Boolean(raw.held);
  const strength = clamp(finite(raw.strength, held || pressed ? 1 : 0), 0, 1);
  return Object.freeze({
    channel,
    action,
    pressed,
    held,
    strength,
    pointerId: Number.isInteger(raw.pointerId) ? raw.pointerId : null,
    sequence: Math.max(0, Math.floor(finite(raw.sequence, 0))),
  });
}

function normalizeEquipment(raw = {}) {
  const weapon = raw.weapon ?? {};
  const offhand = raw.offhand ?? {};
  const armor = raw.armor ?? {};
  return Object.freeze({
    weapon: Object.freeze({
      id: normalizeId(weapon.id, DEFAULT_EQUIPMENT.weapon.id),
      kind: normalizeId(weapon.kind, DEFAULT_EQUIPMENT.weapon.kind),
      damage: clamp(finite(weapon.damage, DEFAULT_EQUIPMENT.weapon.damage), 0, 10000),
      reachMeters: clamp(finite(weapon.reachMeters, DEFAULT_EQUIPMENT.weapon.reachMeters), 0.1, 10),
      socket: normalizeId(weapon.socket, DEFAULT_EQUIPMENT.weapon.socket),
    }),
    offhand: Object.freeze({
      id: normalizeId(offhand.id, DEFAULT_EQUIPMENT.offhand.id),
      kind: normalizeId(offhand.kind, DEFAULT_EQUIPMENT.offhand.kind),
      guardMultiplier: clamp(finite(offhand.guardMultiplier, DEFAULT_EQUIPMENT.offhand.guardMultiplier), 0.1, 3),
    }),
    armor: Object.freeze({
      id: normalizeId(armor.id, DEFAULT_EQUIPMENT.armor.id),
      poise: clamp(finite(armor.poise, DEFAULT_EQUIPMENT.armor.poise), 0, 1000),
      staminaMultiplier: clamp(finite(armor.staminaMultiplier, DEFAULT_EQUIPMENT.armor.staminaMultiplier), 0.25, 2),
    }),
  });
}

function normalizeTarget(target, index, origin = { x: 0, z: 0 }) {
  const position = target?.position ?? target;
  const x = finite(position?.x, NaN), y = finite(position?.y, 0), z = finite(position?.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const id = normalizeId(target?.id, `target-${index}`);
  const dx = x - finite(origin?.x, 0), dz = z - finite(origin?.z, 0);
  return Object.freeze({ id, x, y, z, distanceMeters: Math.hypot(dx, dz), hostile: target?.hostile !== false, locked: Boolean(target?.locked) });
}

function pickLockOnTarget(targets, maxDistanceMeters = 18, origin = { x: 0, z: 0 }) {
  const normalized = (Array.isArray(targets) ? targets : [])
    .map((target, index) => normalizeTarget(target, index, origin))
    .filter(Boolean)
    .filter((target) => target.hostile && target.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id));
  return normalized[0] ?? null;
}

function deriveAnimationIntent(player = {}, input = {}) {
  const state = normalizeId(player.movementState, 'idle');
  if (state === 'dodge') return { clip: 'running', layer: 'evasive', timeScale: 1.45 };
  if (state === 'parry') return { clip: 'idle', layer: 'defense', timeScale: 1.1 };
  if (state === 'guard') return { clip: 'walking', layer: 'guard', timeScale: 0.65 };
  if (state.startsWith('attack-')) return { clip: 'idle', layer: 'attack', timeScale: input.action === 'heavy' ? 0.92 : 1 };
  if (state === 'hit-stagger' || state === 'guard-break') return { clip: 'idle', layer: 'stagger', timeScale: 1 };
  if (state === 'sprint') return { clip: 'running', layer: 'locomotion', timeScale: 1 };
  if (state === 'walk' || state === 'exhausted') return { clip: 'walking', layer: 'locomotion', timeScale: state === 'exhausted' ? 0.8 : 1 };
  return { clip: 'idle', layer: 'locomotion', timeScale: 1 };
}

function deriveFeedback(player = {}, input = {}, equipment = DEFAULT_EQUIPMENT) {
  const state = normalizeId(player.movementState, 'idle');
  const action = input.action;
  const cues = [];
  if (action === 'light' || action === 'heavy') {
    cues.push({ kind: 'sfx', cue: equipment.weapon.kind === 'ranged' ? 'weapon-release' : 'weapon-swing', intensity: action === 'heavy' ? 1 : 0.65 });
    cues.push({ kind: 'vfx', cue: 'attack-trail', intensity: action === 'heavy' ? 1 : 0.6 });
  }
  if (state === 'guard' || state === 'parry') cues.push({ kind: 'vfx', cue: state === 'parry' ? 'parry-spark' : 'guard-glint', intensity: 0.8 });
  if (state === 'dodge') cues.push({ kind: 'vfx', cue: 'dodge-dust', intensity: 0.45 });
  if (state === 'hit-stagger' || state === 'guard-break') cues.push({ kind: 'sfx', cue: state === 'guard-break' ? 'guard-break' : 'hit-react', intensity: 1 });
  return Object.freeze(cues.map((cue) => Object.freeze(cue)));
}

export function createPlayerCombatAnimationDirector({ player = null, equipment = DEFAULT_EQUIPMENT, targetProvider = null, maxLockOnDistanceMeters = 18 } = {}) {
  let currentEquipment = normalizeEquipment(equipment);
  let lockedTarget = null;
  let sequence = 0;
  let disposed = false;

  function snapshot(input = {}, targets = null) {
    if (disposed) return deepFreeze({ disposed: true, input: normalizeInputIntent(input), target: null, equipment: currentEquipment, animation: { clip: 'idle', layer: 'locomotion', timeScale: 1 }, feedback: [], sequence, fingerprint: hashString('disposed') });
    const normalizedInput = normalizeInputIntent({ ...input, sequence: input.sequence ?? sequence });
    const playerState = player && typeof player.getMotionState === 'function' ? player.getMotionState() : player ?? {};
    const candidates = targets ?? (typeof targetProvider === 'function' ? targetProvider() : []);
    const origin = player?.object3D?.position ?? playerState?.position ?? { x: 0, z: 0 };
    if (normalizedInput.action === 'lockOn' && normalizedInput.pressed) lockedTarget = pickLockOnTarget(candidates, maxLockOnDistanceMeters, origin);
    const animation = deriveAnimationIntent(playerState, normalizedInput);
    const feedback = deriveFeedback(playerState, normalizedInput, currentEquipment);
    const output = {
      disposed: false,
      sequence,
      input: normalizedInput,
      target: lockedTarget,
      equipment: currentEquipment,
      animation: Object.freeze({ ...animation }),
      feedback,
      stamina: clamp(finite(player?.stamina, finite(playerState.stamina, 0)), 0, finite(player?.maxStamina, 100)),
      poise: clamp(finite(player?.poise, finite(playerState.poise, 0)), 0, finite(player?.maxPoise, 100)),
      state: normalizeId(player?.movementState, normalizeId(playerState.movementState, 'idle')),
    };
    output.fingerprint = hashString(stableSerialize(output));
    return deepFreeze(output);
  }

  return {
    normalizeInputIntent,
    normalizeEquipment,
    pickLockOnTarget,
    snapshot,
    setEquipment(nextEquipment) { if (!disposed) currentEquipment = normalizeEquipment(nextEquipment); return currentEquipment; },
    advance() { if (!disposed) sequence += 1; return sequence; },
    get equipment() { return currentEquipment; },
    get lockedTarget() { return lockedTarget; },
    dispose() { disposed = true; lockedTarget = null; },
  };
}

export { ACTIONS, CHANNELS, DEFAULT_EQUIPMENT, normalizeInputIntent, normalizeEquipment, pickLockOnTarget, stableSerialize };
