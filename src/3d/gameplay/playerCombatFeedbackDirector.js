const OUTCOMES = new Set([
  'hit',
  'critical',
  'block',
  'parry',
  'guardBreak',
  'dodge',
  'miss',
  'stagger',
  'defeat',
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

const normalizeOutcome = (value) => {
  const outcome = String(value ?? '').trim();
  return OUTCOMES.has(outcome) ? outcome : 'miss';
};

const normalizeIntensity = (value) => clamp(finite(value, 0), 0, 1);

const normalizeDirection = (direction = {}) => {
  const x = finite(direction.x, 0);
  const y = finite(direction.y, 0);
  const z = finite(direction.z, 1);
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
};

const OUTCOME_PROFILE = {
  hit: { shake: 0.28, hitStopMs: 55, audio: 'impact', vfx: ['spark'], priority: 40 },
  critical: { shake: 0.52, hitStopMs: 95, audio: 'critical', vfx: ['spark', 'flash'], priority: 80 },
  block: { shake: 0.18, hitStopMs: 35, audio: 'guard', vfx: ['guard-ring'], priority: 35 },
  parry: { shake: 0.42, hitStopMs: 75, audio: 'parry', vfx: ['parry-ring', 'spark'], priority: 70 },
  guardBreak: { shake: 0.64, hitStopMs: 120, audio: 'guard-break', vfx: ['guard-break', 'dust'], priority: 90 },
  dodge: { shake: 0.06, hitStopMs: 0, audio: 'dodge', vfx: ['afterimage'], priority: 20 },
  miss: { shake: 0.02, hitStopMs: 0, audio: 'miss', vfx: [], priority: 5 },
  stagger: { shake: 0.36, hitStopMs: 70, audio: 'stagger', vfx: ['impact', 'dust'], priority: 60 },
  defeat: { shake: 0.7, hitStopMs: 140, audio: 'defeat', vfx: ['impact', 'flash', 'dust'], priority: 100 },
};

const cloneVfx = (items) => items.slice();

export function buildPlayerCombatFeedback(input = {}) {
  const outcome = normalizeOutcome(input.outcome);
  const profile = OUTCOME_PROFILE[outcome];
  const intensity = normalizeIntensity(input.intensity);
  const comboStep = Math.max(0, Math.floor(finite(input.comboStep, 0)));
  const targetDistance = clamp(finite(input.targetDistance, 0), 0, 999);
  const direction = normalizeDirection(input.direction);
  const surface = String(input.surface ?? 'unknown').trim() || 'unknown';
  const hitStopMs = Math.round(profile.hitStopMs * (0.75 + (intensity * 0.5)));
  const shake = clamp(profile.shake * (0.7 + (intensity * 0.6)), 0, 1);
  const rumble = clamp((shake * 0.85) + (comboStep > 0 ? 0.05 : 0), 0, 1);
  const priority = profile.priority + Math.min(comboStep, 5);

  return Object.freeze({
    version: 1,
    outcome,
    intensity,
    comboStep,
    targetDistance,
    surface,
    priority,
    hitStop: Object.freeze({
      enabled: hitStopMs > 0,
      durationMs: hitStopMs,
      timeScale: hitStopMs > 0 ? 0.08 : 1,
    }),
    camera: Object.freeze({
      shake,
      direction,
      spring: clamp(0.65 + (intensity * 0.25), 0.65, 0.95),
    }),
    haptics: Object.freeze({
      enabled: rumble > 0.05,
      strength: rumble,
      durationMs: Math.round(hitStopMs * 0.8),
    }),
    audio: Object.freeze({ cue: profile.audio, volume: clamp(0.55 + intensity * 0.4, 0, 1) }),
    vfx: Object.freeze(cloneVfx(profile.vfx)),
    flags: Object.freeze({
      isPositive: ['hit', 'critical', 'parry', 'guardBreak', 'stagger', 'defeat'].includes(outcome),
      isDefense: ['block', 'parry', 'dodge'].includes(outcome),
      isTerminal: outcome === 'defeat',
    }),
  });
}

export function serializePlayerCombatFeedback(feedback) {
  return JSON.stringify(feedback);
}
