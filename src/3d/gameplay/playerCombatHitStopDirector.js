/**
 * Deterministic hit-stop / camera-impact projection for the existing combat pipeline.
 *
 * This module never mutates the player, camera, mixer, scene, health or audio systems. It converts
 * caller-owned combat outcome data into bounded presentation metadata for existing consumers.
 * @module gameplay/playerCombatHitStopDirector
 */

const OUTCOMES = new Set(['hit', 'critical-hit', 'blocked', 'parried', 'guard-break', 'dodged', 'miss']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeOutcome = (value) => OUTCOMES.has(value) ? value : 'miss';
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

export function resolvePlayerCombatHitStop(sample = {}) {
  const outcome = normalizeOutcome(sample?.outcome);
  const impact = clamp(sample?.impact, 0, 1);
  const damage = clamp(sample?.damage, 0, 250);
  const poiseDamage = clamp(sample?.poiseDamage, 0, 250);
  const targetDefeated = Boolean(sample?.targetDefeated);
  const attackerFacing = clamp(sample?.attackerFacing, 0, 1);
  const distance = clamp(sample?.distance, 0, 12);
  const isLocalPlayer = sample?.actor === 'player' || sample?.actor === 'local-player';
  const base = outcome === 'critical-hit' ? 0.105 : outcome === 'guard-break' ? 0.09 : outcome === 'hit' ? 0.065 : outcome === 'blocked' ? 0.042 : outcome === 'parried' ? 0.055 : outcome === 'dodged' ? 0.018 : 0;
  const strength = clamp((damage / 100) * 0.45 + (poiseDamage / 100) * 0.3 + impact * 0.45 + attackerFacing * 0.15, 0, 1.5);
  const distanceFade = clamp(1 - distance / 12, 0.2, 1);
  const durationMs = Math.round(clamp(base * 1000 * (0.55 + strength) * distanceFade, 0, 140));
  const cameraShake = Number(clamp((impact * 0.5 + strength * 0.35) * distanceFade * (isLocalPlayer ? 1.15 : 0.85), 0, 1).toFixed(4));
  const timeScale = Number(clamp(1 - durationMs / 650, 0.78, 1).toFixed(4));
  const feedbackTier = targetDefeated ? 'defeat' : outcome === 'critical-hit' || outcome === 'guard-break' ? 'heavy' : durationMs >= 50 ? 'medium' : durationMs > 0 ? 'light' : 'none';
  return freeze({
    outcome,
    accepted: outcome !== 'miss',
    targetDefeated,
    durationMs,
    timeScale,
    cameraShake,
    feedbackTier,
    audio: Object.freeze({ hit: outcome !== 'miss', accent: outcome === 'parried' ? 'parry' : outcome === 'guard-break' ? 'guard-break' : outcome === 'critical-hit' ? 'critical' : outcome }),
    vfx: Object.freeze({ sparks: outcome === 'blocked' || outcome === 'parried', burst: outcome === 'critical-hit' || outcome === 'guard-break', dust: outcome === 'guard-break' || targetDefeated }),
    safety: Object.freeze({ finite: true, bounded: true, editorRuntimeImport: false }),
  });
}

export function serializePlayerCombatHitStop(sample = {}) {
  return JSON.stringify(resolvePlayerCombatHitStop(sample));
}
