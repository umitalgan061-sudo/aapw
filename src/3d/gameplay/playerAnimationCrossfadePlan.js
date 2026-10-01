/**
 * Deterministic animation crossfade plan over the existing player animation owner.
 * Does not construct mixers or mutate clips; player.js remains authoritative for playback.
 * @module gameplay/playerAnimationCrossfadePlan
 */

const MAX_FADE_SECONDS = 0.45;
const MIN_FADE_SECONDS = 0.04;
const LAYERS = ['locomotion', 'combat', 'defense', 'evasive', 'stagger'];
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const phaseFor = (priority) => {
  if (priority === 'attack-heavy' || priority === 'attack-light') return 'attack';
  if (priority === 'parry' || priority === 'guard') return 'defense';
  if (priority === 'dodge') return 'evasive';
  if (priority === 'stagger' || priority === 'guard-break') return 'stagger';
  return 'locomotion';
};

export function buildPlayerAnimationCrossfadePlan(blend = {}, options = {}) {
  const priority = typeof blend.priority === 'string' ? blend.priority : 'locomotion';
  const phase = phaseFor(priority);
  const speedMps = clamp(Math.abs(finite(blend.speedMps)), 0, 12);
  const intensity = clamp(finite(options.intensity, 0.65), 0, 1);
  const requestedFade = clamp(finite(options.fadeSeconds, 0.14), MIN_FADE_SECONDS, MAX_FADE_SECONDS);
  const fadeSeconds = Number((requestedFade * (phase === 'stagger' ? 0.7 : phase === 'attack' ? 0.85 : 1)).toFixed(3));
  const locomotion = clamp(finite(blend?.locomotion?.blend, 0), 0, 1);
  const combatWeight = clamp(Math.max(
    finite(blend?.combat?.attackHeavy, 0),
    finite(blend?.combat?.attackLight, 0),
    finite(blend?.combat?.guard, 0),
    finite(blend?.combat?.parry, 0),
  ), 0, 1);
  const evasiveWeight = clamp(finite(blend?.combat?.dodge, 0), 0, 1);
  const staggerWeight = clamp(Math.max(finite(blend?.combat?.stagger, 0), finite(blend?.combat?.guardBreak, 0)), 0, 1);
  const layers = {
    locomotion: Number((locomotion * (phase === 'locomotion' ? 1 : 0.25)).toFixed(3)),
    combat: Number((combatWeight * (phase === 'attack' || phase === 'defense' ? 1 : 0.4)).toFixed(3)),
    defense: Number(((phase === 'defense' ? combatWeight : 0) * intensity).toFixed(3)),
    evasive: Number((evasiveWeight * (phase === 'evasive' ? 1 : 0.2)).toFixed(3)),
    stagger: Number((staggerWeight * (phase === 'stagger' ? 1 : 0.15)).toFixed(3)),
  };
  const upperBodyLocked = phase === 'attack' || phase === 'defense' || phase === 'stagger';
  const rootMotion = phase === 'attack' || phase === 'evasive' ? 'caller-owned' : 'disabled';
  const dominantLayer = LAYERS.reduce((winner, layer) => layers[layer] > layers[winner] ? layer : winner, 'locomotion');
  const result = {
    phase,
    dominantLayer,
    fadeSeconds,
    speedMps: Number(speedMps.toFixed(3)),
    layers: Object.freeze(layers),
    upperBodyLocked,
    rootMotion,
    ownership: Object.freeze({ mixer: 'gameplay/player.js', clips: 'gameplay/player.js', plan: 'playerAnimationCrossfadePlan' }),
  };
  return deepFreeze(result);
}

export function validatePlayerAnimationCrossfadePlan(result) {
  if (!result || typeof result !== 'object') return false;
  if (!['locomotion', 'attack', 'defense', 'evasive', 'stagger'].includes(result.phase)) return false;
  if (!Number.isFinite(result.fadeSeconds) || result.fadeSeconds < MIN_FADE_SECONDS || result.fadeSeconds > MAX_FADE_SECONDS) return false;
  if (!result.layers || !result.ownership) return false;
  return LAYERS.every((layer) => Number.isFinite(result.layers[layer]) && result.layers[layer] >= 0 && result.layers[layer] <= 1);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
