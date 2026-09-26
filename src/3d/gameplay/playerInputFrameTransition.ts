/**
 * Deterministic, observation-only frame transition over the shipped player input parity snapshot.
 * The legacy input authority remains responsible for ingesting keyboard, mouse, gamepad and touch.
 * This adapter only derives edges and movement delta for locomotion/combat consumers.
 *
 * @module gameplay/playerInputFrameTransition
 */

const ACTIONS = Object.freeze([
  'moveForward', 'moveBackward', 'moveLeft', 'moveRight',
  'lightAttack', 'heavyAttack', 'block', 'dodge', 'lockOn',
]);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sortUnique = (values) => [...new Set(Array.isArray(values) ? values : [])]
  .filter((value) => ACTIONS.includes(value))
  .sort();

function normalizeMove(move) {
  return Object.freeze({
    x: clamp(finite(move?.x), -1, 1),
    y: clamp(finite(move?.y), -1, 1),
  });
}

function normalizeSnapshot(snapshot = {}) {
  return Object.freeze({
    move: normalizeMove(snapshot.move),
    held: Object.freeze(sortUnique(snapshot.held)),
    pressed: Object.freeze(sortUnique(snapshot.pressed)),
  });
}

function stableKey(snapshot) {
  return JSON.stringify({
    move: snapshot.move,
    held: snapshot.held,
    pressed: snapshot.pressed,
  });
}

export function createPlayerInputFrameTransition(previousSnapshot = {}) {
  let previous = normalizeSnapshot(previousSnapshot);
  let frame = 0;

  function step(nextSnapshot = {}) {
    const next = normalizeSnapshot(nextSnapshot);
    const held = new Set(next.held);
    const previousHeld = new Set(previous.held);
    const pressed = new Set(next.pressed);
    const started = ACTIONS.filter((action) => held.has(action) && !previousHeld.has(action));
    const released = ACTIONS.filter((action) => !held.has(action) && previousHeld.has(action));
    const repeated = ACTIONS.filter((action) => held.has(action) && previousHeld.has(action));
    const explicitPressed = ACTIONS.filter((action) => pressed.has(action));
    const moveDelta = Object.freeze({
      x: Number((next.move.x - previous.move.x).toFixed(6)),
      y: Number((next.move.y - previous.move.y).toFixed(6)),
    });

    frame += 1;
    const result = Object.freeze({
      frame,
      previous,
      current: next,
      started: Object.freeze(started),
      released: Object.freeze(released),
      repeated: Object.freeze(repeated),
      explicitPressed: Object.freeze(explicitPressed),
      moveDelta,
      changed: stableKey(previous) !== stableKey(next),
      signature: JSON.stringify({
        frame,
        started,
        released,
        repeated,
        explicitPressed,
        moveDelta,
        current: next,
      }),
    });
    previous = next;
    return result;
  }

  function read() {
    return Object.freeze({ frame, snapshot: previous });
  }

  function reset(snapshot = {}) {
    previous = normalizeSnapshot(snapshot);
    frame = 0;
    return read();
  }

  return Object.freeze({ step, read, reset });
}

export { ACTIONS, normalizeSnapshot };
