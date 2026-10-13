/**
 * Runtime-facing orchestration bridge for the shipped player/combat owner.
 * It does not mutate player.js or create a second framework: callers provide the
 * authoritative observations and receive one bounded presentation/execution plan.
 * @module gameplay/playerRuntimeDirector
 */

const ACTIONS = Object.freeze(['light', 'heavy', 'ranged', 'block', 'parry', 'dodge', 'lockOn']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const text = (value, fallback = '') => typeof value === 'string' ? value.trim().slice(0, 96) : fallback;
const bool = (value) => value === true;
const vec2 = (value) => ({ x: clamp(finite(value?.x), -1, 1), y: clamp(finite(value?.y), -1, 1) });
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

function normalizeAction(action) {
  const alias = { attack: 'light', lightAttack: 'light', heavyAttack: 'heavy', shoot: 'ranged', guard: 'block', roll: 'dodge', target: 'lockOn' };
  const normalized = alias[text(action)] || text(action);
  return ACTIONS.includes(normalized) ? normalized : null;
}

function normalizeInput(input = {}) {
  const actions = Array.isArray(input.actions) ? input.actions.map(normalizeAction).filter(Boolean) : [];
  return {
    move: vec2(input.move),
    look: vec2(input.look),
    actions: [...new Set(actions)],
    source: ['keyboard', 'mouse', 'gamepad', 'touch', 'pwa'].includes(text(input.source)) ? text(input.source) : 'unknown',
    connected: bool(input.connected),
  };
}

function selectTarget(player = {}, targets = [], maxDistance = 18) {
  const px = finite(player.x), pz = finite(player.z);
  return targets.map((target) => {
    const x = finite(target?.x), z = finite(target?.z);
    const dx = x - px, dz = z - pz;
    return { id: text(target?.id, 'unknown'), hostile: target?.hostile !== false, visible: target?.visible !== false, distance: Math.hypot(dx, dz), x, z };
  }).filter((target) => target.hostile && target.visible && target.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0] || null;
}

export function createPlayerRuntimeDirector(options = {}) {
  let disposed = false;
  let revision = 0;
  let lastFingerprint = '';
  const config = { maxTargetDistance: clamp(finite(options.maxTargetDistance, 18), 1, 60) };

  function snapshot(observation = {}) {
    if (disposed) return freeze({ disposed: true, revision, fingerprint: 'disposed' });
    const input = normalizeInput(observation.input);
    const state = {
      alive: observation.state?.alive !== false,
      grounded: observation.state?.grounded !== false,
      stunned: bool(observation.state?.stunned),
      attacking: bool(observation.state?.attacking),
      guarding: bool(observation.state?.guarding),
      aiming: bool(observation.state?.aiming),
      stamina: clamp(finite(observation.resources?.stamina, 0), 0, 100),
      poise: clamp(finite(observation.resources?.poise, 0), 0, 100),
    };
    const target = input.actions.includes('lockOn') ? selectTarget(observation.player, observation.targets, config.maxTargetDistance) : null;
    const selectedAction = input.actions.find((action) => ACTIONS.includes(action)) || 'none';
    const phase = state.stunned ? 'stagger' : state.attacking ? (selectedAction === 'heavy' ? 'heavyAttack' : selectedAction === 'ranged' ? 'rangedAttack' : 'lightAttack') : state.guarding ? 'guard' : state.aiming ? 'aim' : input.move.x || input.move.y ? 'locomotion' : 'idle';
    const plan = {
      revision: ++revision,
      input,
      state,
      target: target ? { id: target.id, distance: Number(target.distance.toFixed(4)), visible: target.visible } : null,
      animation: { locomotion: phase === 'locomotion' ? 'move' : 'idle', combat: phase, additive: state.stunned ? 'stagger' : state.guarding ? 'guard' : 'none' },
      equipment: { weaponId: text(observation.equipment?.weaponId, 'unarmed'), offhandId: text(observation.equipment?.offhandId), socketsReady: observation.equipment?.socketsReady !== false },
      feedback: { emit: ['light', 'heavy', 'ranged', 'parry', 'dodge'].includes(selectedAction), cue: selectedAction === 'heavy' ? 'impact-heavy' : selectedAction === 'parry' ? 'defense-parry' : selectedAction === 'dodge' ? 'evasive-roll' : selectedAction === 'none' ? 'none' : 'combat-action' },
      handoff: { playerOwner: 'src/3d/gameplay/player.js', worldOwner: 'Buzul Muhafızı', npcOwner: 'Şafak Kartalı', rpgOwner: 'Günbatımı Ustası', materialPlacement: 'merged-#590' },
    };
    plan.fingerprint = stable(plan);
    lastFingerprint = plan.fingerprint;
    return freeze(plan);
  }

  function dispose() { disposed = true; }
  function getStatus() { return freeze({ disposed, revision, lastFingerprint }); }
  return Object.freeze({ snapshot, dispose, getStatus, config: Object.freeze(config) });
}

export const PLAYER_RUNTIME_DIRECTOR_ACTIONS = ACTIONS;
export const validatePlayerRuntimeDirector = (value) => Boolean(value && typeof value === 'object' && (value.disposed === true || (typeof value.fingerprint === 'string' && value.animation && value.handoff)));
