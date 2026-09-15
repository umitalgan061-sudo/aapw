/**
 * DOM/renderer-free presentation envelope for the existing player combat pipeline.
 *
 * It translates caller-owned combat state transitions into bounded, deterministic
 * feedback cues. It does not own hit detection, animation mixers, VFX/SFX, input,
 * camera, terrain, equipment, or combat truth.
 */

const STATES = new Set(['idle', 'locomotion', 'guard', 'parry', 'dodge', 'attack', 'stagger', 'defeated']);
const CUES = Object.freeze({
  attack: 'combat-attack',
  hit: 'combat-hit-confirm',
  guard: 'combat-guard',
  parry: 'combat-parry',
  dodge: 'combat-dodge',
  stagger: 'combat-stagger',
  defeat: 'combat-defeat',
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const normalizeState = (value) => typeof value === 'string' && STATES.has(value) ? value : 'idle';
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));
const freezeCue = (cue, index) => Object.freeze({
  type: cue.type,
  sequence: index,
  intensity: clamp01(cue.intensity),
  durationSeconds: Math.max(0, Math.min(2, finite(cue.durationSeconds, 0.12))),
  channel: typeof cue.channel === 'string' && cue.channel ? cue.channel : 'combat',
  reason: typeof cue.reason === 'string' ? cue.reason : null,
});

function deriveCue(previous, current) {
  if (current.defeated && !previous.defeated) return { type: CUES.defeat, intensity: 1, durationSeconds: 0.6, reason: 'defeated' };
  if (current.confirmedHit) return { type: CUES.hit, intensity: clamp01(current.hitIntensity ?? 1), durationSeconds: 0.16, reason: 'confirmed-hit' };
  if (current.state === 'parry' && previous.state !== 'parry') return { type: CUES.parry, intensity: 0.9, durationSeconds: 0.18, reason: 'parry-enter' };
  if (current.state === 'guard' && previous.state !== 'guard') return { type: CUES.guard, intensity: 0.55, durationSeconds: 0.12, reason: 'guard-enter' };
  if (current.state === 'dodge' && previous.state !== 'dodge') return { type: CUES.dodge, intensity: 0.8, durationSeconds: 0.22, reason: 'dodge-enter' };
  if (current.state === 'stagger' && previous.state !== 'stagger') return { type: CUES.stagger, intensity: 0.85, durationSeconds: 0.3, reason: 'stagger-enter' };
  if (current.state === 'attack' && previous.state !== 'attack') return { type: CUES.attack, intensity: clamp01(current.attackIntensity ?? 0.7), durationSeconds: 0.14, reason: 'attack-enter' };
  return null;
}

export function createPlayerCombatPresentationEnvelope(initial = {}) {
  let previous = Object.freeze({ state: normalizeState(initial.state), defeated: Boolean(initial.defeated) });
  let sequence = 0;
  let disposed = false;

  const emit = (next = {}) => {
    if (disposed) throw new Error('player combat presentation envelope disposed');
    const current = Object.freeze({
      state: normalizeState(next.state),
      defeated: Boolean(next.defeated),
      confirmedHit: Boolean(next.confirmedHit),
      hitIntensity: clamp01(next.hitIntensity ?? 1),
      attackIntensity: clamp01(next.attackIntensity ?? 0.7),
    });
    const cue = deriveCue(previous, current);
    previous = current;
    return Object.freeze({
      sequence,
      state: current.state,
      defeated: current.defeated,
      cue: cue ? freezeCue(cue, sequence) : null,
    });
  };

  return Object.freeze({
    emit,
    dispose() { disposed = true; },
    snapshot() { return Object.freeze({ sequence, previous }); },
  });
}

export { CUES as PLAYER_COMBAT_PRESENTATION_CUES };
