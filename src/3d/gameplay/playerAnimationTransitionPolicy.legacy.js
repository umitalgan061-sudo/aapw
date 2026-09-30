/**
 * Pure locomotion/combat semantic transition policy.
 * Keeps the animation director's hysteresis contract free of scene/material dependencies.
 *
 * @module gameplay/playerAnimationTransitionPolicy
 */

const DEFAULT_ENTER_SPEED_MPS = 5.6;
const DEFAULT_EXIT_SPEED_MPS = 5.1;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolvePreferredSemantic({
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
} = {}) {
  const speed = Math.max(0, finite(planarSpeedMps));
  if (hitStaggerRemaining > 0) return 'hit-stagger';
  if (dodgeRemaining > 0) return 'dodge';
  if (attackKind === 'heavy') return 'heavy-attack';
  if (attackKind === 'light') return 'light-attack';
  if (guarding) return 'guard';
  if (runIntent || speed >= DEFAULT_ENTER_SPEED_MPS) return 'sprint';
  if (speed >= 0.15) return 'locomotion';
  return 'idle';
}

export function resolvePlayerAnimationTransition({
  previousSemanticState = 'idle',
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
  sprintEnterSpeedMps = DEFAULT_ENTER_SPEED_MPS,
  sprintExitSpeedMps = DEFAULT_EXIT_SPEED_MPS,
} = {}) {
  const enter = Math.max(0, finite(sprintEnterSpeedMps, DEFAULT_ENTER_SPEED_MPS));
  const exit = clamp(finite(sprintExitSpeedMps, DEFAULT_EXIT_SPEED_MPS), 0, enter);
  const speed = Math.max(0, finite(planarSpeedMps));
  const forced = resolvePreferredSemantic({ planarSpeedMps: speed, runIntent, attackKind, guarding, dodgeRemaining, hitStaggerRemaining });
  if (forced !== 'sprint' && forced !== 'locomotion') return forced;
  if (previousSemanticState === 'sprint') return speed >= exit || runIntent ? 'sprint' : forced;
  return speed >= enter || runIntent ? 'sprint' : forced;
}
