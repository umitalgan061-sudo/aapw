/**
 * Deterministic edge reconciliation for the existing player input parity snapshot.
 *
 * This is an observation-only adapter over the shipped input parity contract. It does not
 * own input listeners or create another state machine; callers feed consecutive snapshots
 * from playerInputParity.legacy.js and use the result to drive one frame of gameplay.
 */

const ACTION_ORDER = Object.freeze([
  'moveForward', 'moveBackward', 'moveLeft', 'moveRight',
  'lightAttack', 'heavyAttack', 'block', 'dodge', 'lockOn',
]);

const ACTION_INDEX = new Map(ACTION_ORDER.map((action, index) => [action, index]));

const normalizeActions = (value) => {
  const seen = new Set();
  if (!Array.isArray(value)) return [];
  for (const action of value) {
    if (typeof action !== 'string' || !ACTION_INDEX.has(action)) continue;
    seen.add(action);
  }
  return ACTION_ORDER.filter((action) => seen.has(action));
};

const normalizeMove = (move) => ({
  x: Number.isFinite(Number(move?.x)) ? Number(move.x) : 0,
  y: Number.isFinite(Number(move?.y)) ? Number(move.y) : 0,
});

export function reconcilePlayerInputSnapshot(previous = {}, next = {}) {
  const previousHeld = new Set(normalizeActions(previous.held));
  const nextHeld = new Set(normalizeActions(next.held));
  const pressed = ACTION_ORDER.filter((action) => nextHeld.has(action) && !previousHeld.has(action));
  const released = ACTION_ORDER.filter((action) => previousHeld.has(action) && !nextHeld.has(action));

  return Object.freeze({
    version: 1,
    held: Object.freeze(ACTION_ORDER.filter((action) => nextHeld.has(action))),
    pressed: Object.freeze(pressed),
    released: Object.freeze(released),
    move: Object.freeze(normalizeMove(next.move)),
    moveChanged: Number(previous?.move?.x ?? 0) !== Number(next?.move?.x ?? 0)
      || Number(previous?.move?.y ?? 0) !== Number(next?.move?.y ?? 0),
  });
}

export function createPlayerInputParityEdgeTracker(initialSnapshot = {}) {
  let previous = Object.freeze({
    held: normalizeActions(initialSnapshot.held),
    move: normalizeMove(initialSnapshot.move),
  });

  return Object.freeze({
    ingest(nextSnapshot = {}) {
      const result = reconcilePlayerInputSnapshot(previous, nextSnapshot);
      previous = Object.freeze({ held: [...result.held], move: { ...result.move } });
      return result;
    },
    reset(snapshot = {}) {
      previous = Object.freeze({
        held: normalizeActions(snapshot.held),
        move: normalizeMove(snapshot.move),
      });
    },
    read() {
      return Object.freeze({ held: Object.freeze([...previous.held]), move: Object.freeze({ ...previous.move }) });
    },
  });
}

export { ACTION_ORDER };
