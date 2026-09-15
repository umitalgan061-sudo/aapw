/**
 * Converts existing player combat presentation frames into minimal mixer commands.
 * The player state machine and AnimationMixer remain owned by existing callers.
 * @module gameplay/playerCombatAnimationCommandStream
 */

const MAX_HISTORY = 24;
const WEIGHT_EPSILON = 0.001;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));
const normalizeName = (value) => String(value || 'idle').trim() || 'idle';

function readAnimation(frame) {
  const animation = frame?.animation || {};
  const weights = animation.weights || animation;
  return {
    base: normalizeName(animation.baseAction || animation.locomotionAction || 'idle'),
    overlay: normalizeName(animation.combatAction || animation.overlayAction || 'none'),
    baseWeight: clamp01(weights.baseWeight ?? animation.baseWeight),
    overlayWeight: clamp01(weights.combatOverlayWeight ?? animation.overlayWeight),
    timeScale: Math.max(0.1, Math.min(3, finite(animation.timeScale, 1))),
    phase: normalizeName(frame?.phase || animation.phase || 'idle'),
  };
}

function changed(a, b) {
  return a.name !== b.name || Math.abs(a.weight - b.weight) > WEIGHT_EPSILON;
}

function diff(previous, next, revision) {
  const commands = [];
  if (changed(previous.base, next.base)) commands.push(Object.freeze({ channel: 'base', action: next.base, weight: next.baseWeight }));
  if (changed(previous.overlay, next.overlay)) commands.push(Object.freeze({ channel: 'overlay', action: next.overlay, weight: next.overlayWeight }));
  if (Math.abs(previous.timeScale - next.timeScale) > WEIGHT_EPSILON) commands.push(Object.freeze({ channel: 'timeScale', value: next.timeScale }));
  if (previous.phase !== next.phase) commands.push(Object.freeze({ channel: 'phase', value: next.phase }));
  return Object.freeze({ revision, commands: Object.freeze(commands), state: Object.freeze(next) });
}

export function createPlayerCombatAnimationCommandStream({ onCommands = null, maxHistory = MAX_HISTORY } = {}) {
  let disposed = false;
  let revision = 0;
  let current = { base: { name: 'idle', weight: 1 }, overlay: { name: 'none', weight: 0 }, timeScale: 1, phase: 'idle' };
  const history = [];

  function push(next) {
    const envelope = diff(current, next, ++revision);
    current = { base: { name: next.base, weight: next.baseWeight }, overlay: { name: next.overlay, weight: next.overlayWeight }, timeScale: next.timeScale, phase: next.phase };
    if (envelope.commands.length > 0) {
      history.push(envelope);
      if (history.length > Math.max(1, Math.floor(maxHistory))) history.splice(0, history.length - Math.max(1, Math.floor(maxHistory)));
      if (typeof onCommands === 'function') {
        try { onCommands(envelope); } catch { /* consumer isolation */ }
      }
    }
    return envelope;
  }

  return Object.freeze({
    consume(frame) {
      if (disposed) return Object.freeze({ revision, commands: Object.freeze([]), state: Object.freeze({ ...current }) });
      return push(readAnimation(frame));
    },
    snapshot() {
      return Object.freeze({ revision, current: Object.freeze({ ...current, base: Object.freeze({ ...current.base }), overlay: Object.freeze({ ...current.overlay }) }), history: Object.freeze(history.slice()) });
    },
    reset() {
      if (disposed) return false;
      revision += 1;
      current = { base: { name: 'idle', weight: 1 }, overlay: { name: 'none', weight: 0 }, timeScale: 1, phase: 'idle' };
      history.length = 0;
      return true;
    },
    dispose() {
      disposed = true;
      history.length = 0;
      return true;
    },
  });
}

export function playerCombatAnimationCommandsFromFrame(frame, options) {
  return createPlayerCombatAnimationCommandStream(options).consume(frame);
}
