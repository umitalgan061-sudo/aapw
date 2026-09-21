/**
 * Deterministic presentation adapter for the existing player combat runtime.
 * It returns immutable animation/VFX/SFX/haptic intents without owning any
 * renderer, mixer, audio graph, state mutation, or asset lifecycle.
 * @module gameplay/playerCombatPresentationDirector
 */

const ACTIONS = new Set(['light', 'heavy', 'guard', 'parry', 'dodge', 'ranged', 'archery', 'hit', 'guard-break', 'defeat']);
const MAX_HISTORY = 24;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const freeze = (value) => Object.freeze(value);

const PROFILES = Object.freeze({
  light: { animation: 'attack-light', vfx: 'weapon-spark', sfx: 'melee-light', haptic: 0.2, duration: 0.24 },
  heavy: { animation: 'attack-heavy', vfx: 'weapon-impact', sfx: 'melee-heavy', haptic: 0.5, duration: 0.42 },
  guard: { animation: 'guard-hold', vfx: 'guard-glint', sfx: 'guard-ready', haptic: 0.05, duration: 0.18 },
  parry: { animation: 'parry-success', vfx: 'parry-burst', sfx: 'parry-ring', haptic: 0.65, duration: 0.3 },
  dodge: { animation: 'dodge-roll', vfx: 'dodge-trail', sfx: 'dodge-whoosh', haptic: 0.1, duration: 0.22 },
  ranged: { animation: 'aim-release', vfx: 'projectile-release', sfx: 'ranged-release', haptic: 0.18, duration: 0.26 },
  archery: { animation: 'bow-release', vfx: 'arrow-release', sfx: 'bow-release', haptic: 0.16, duration: 0.3 },
  hit: { animation: 'hit-react', vfx: 'hit-flash', sfx: 'hit-confirm', haptic: 0.35, duration: 0.2 },
  'guard-break': { animation: 'guard-break', vfx: 'guard-shatter', sfx: 'guard-break', haptic: 0.55, duration: 0.34 },
  defeat: { animation: 'defeat', vfx: 'defeat-burst', sfx: 'defeat-sting', haptic: 0.7, duration: 0.8 },
});

function normalizeAction(action) {
  const normalized = String(action ?? '').trim().toLowerCase().replace(/_/g, '-');
  return normalized === 'roll' ? 'dodge' : normalized === 'block' ? 'guard' : normalized;
}

function normalizeSequence(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function createPlayerCombatPresentationDirector(options = {}) {
  const maxHistory = Math.min(MAX_HISTORY, Math.max(4, Math.trunc(options.maxHistory ?? MAX_HISTORY)));
  let sequence = 0;
  let disposed = false;
  const history = [];

  const emit = (snapshot = {}) => {
    if (disposed) return null;
    const action = normalizeAction(snapshot.action);
    if (!ACTIONS.has(action)) return null;
    const nextSequence = normalizeSequence(snapshot.sequence, sequence + 1);
    if (nextSequence <= sequence) return null;
    const profile = PROFILES[action];
    const intensity = clamp(snapshot.intensity ?? (action === 'defeat' ? 1 : 0.65), 0, 1);
    const duration = clamp(snapshot.duration ?? profile.duration, 0.05, 1.2);
    const receipt = freeze({
      sequence: nextSequence,
      action,
      targetId: snapshot.targetId == null ? null : String(snapshot.targetId),
      animation: freeze({ clip: profile.animation, weight: clamp(snapshot.animationWeight ?? 1, 0, 1), duration }),
      feedback: freeze({ vfx: profile.vfx, sfx: profile.sfx, haptic: clamp(profile.haptic * intensity, 0, 1), intensity }),
      interruptible: action !== 'defeat' && action !== 'heavy',
      ownership: freeze({ state: 'caller', mixer: 'caller', vfx: 'caller', sfx: 'caller', assets: 'MaterialAssignmentCore/WorldAssetPlacementPipeline' }),
    });
    sequence = nextSequence;
    history.push(receipt);
    while (history.length > maxHistory) history.shift();
    return receipt;
  };

  return Object.freeze({
    emit,
    history: () => history.slice(),
    reset: () => { if (!disposed) { sequence = 0; history.length = 0; } },
    dispose: () => { disposed = true; history.length = 0; },
    isDisposed: () => disposed,
  });
}

export function validatePlayerCombatPresentationReceipt(receipt) {
  return Boolean(receipt && Number.isInteger(receipt.sequence) && receipt.sequence >= 1 && ACTIONS.has(receipt.action) && receipt.animation?.clip && receipt.feedback?.vfx && receipt.feedback?.sfx && receipt.ownership?.assets === 'MaterialAssignmentCore/WorldAssetPlacementPipeline');
}
