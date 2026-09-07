/**
 * Deterministic presentation policy for the existing player action state machine.
 * This is intentionally framework-free: player.js owns state, this module only resolves
 * an available authored clip and its bounded playback rate.
 * @module gameplay/playerAnimationDirector
 */

const FALLBACK_ACTIONS = Object.freeze({ idle: 'idle', locomotion: 'walking', sprint: 'running' });

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function resolvePlayerAnimationIntent({
  movementState = 'idle',
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
  dodgeRemaining = 0,
  hitStaggerRemaining = 0,
  availableActions = FALLBACK_ACTIONS,
} = {}) {
  const speed = Math.max(0, finite(planarSpeedMps));
  const actions = availableActions && typeof availableActions === 'object' ? availableActions : FALLBACK_ACTIONS;
  const preferred = hitStaggerRemaining > 0 ? 'hit-stagger'
    : dodgeRemaining > 0 ? 'dodge'
      : attackKind === 'heavy' ? 'heavy-attack'
        : attackKind === 'light' ? 'light-attack'
          : guarding ? 'guard'
            : runIntent || speed >= 5.6 ? 'sprint'
              : speed >= 0.15 ? 'locomotion'
                : 'idle';
  const action = actions[preferred] ?? actions[FALLBACK_ACTIONS[preferred]] ?? actions.idle ?? null;
  const timeScale = preferred === 'sprint'
    ? Math.min(1.35, Math.max(0.9, speed / 6.5))
    : preferred === 'dodge' ? 1.45
      : preferred.endsWith('attack') ? 1.0
        : 1.0;
  return Object.freeze({
    action,
    semanticState: preferred,
    movementState: String(movementState),
    speedMps: Number(speed.toFixed(3)),
    timeScale: Number(timeScale.toFixed(3)),
  });
}

export function createPlayerAnimationDirector({ actions = {}, playAction } = {}) {
  if (typeof playAction !== 'function') throw new TypeError('playAction callback is required');
  let lastSemanticState = null;
  return Object.freeze({
    update(input = {}) {
      const resolved = resolvePlayerAnimationIntent({ ...input, availableActions: actions });
      if (resolved.semanticState !== lastSemanticState && resolved.action) {
        playAction(resolved.action, resolved.timeScale);
        lastSemanticState = resolved.semanticState;
      }
      return resolved;
    },
    reset() { lastSemanticState = null; },
  });
}
