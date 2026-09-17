/**
 * Consumer-side guard for the existing player/equipment/combat frame stream.
 *
 * This is deliberately an adapter, not a second combat state machine. It rejects stale,
 * regressive or identity-changing frames before they reach animation/equipment presentation.
 *
 * @module gameplay/playerCombatRuntimeFrameGuard
 */

const finite = (value) => Number.isFinite(Number(value));
const integer = (value) => Number.isInteger(Number(value));
const bounded = (value, min, max) => finite(value) && Number(value) >= min && Number(value) <= max;

export const PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION = 1;

function cloneAndFreeze(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const [key, child] of Object.entries(value)) clone[key] = cloneAndFreeze(child, seen);
  return Object.freeze(clone);
}

export function createPlayerCombatRuntimeFrameGuard({
  maxTimestampRegression = 0,
  maxRevisionGap = 1,
} = {}) {
  if (!bounded(maxTimestampRegression, 0, 60)) throw new RangeError('maxTimestampRegression must be between 0 and 60');
  if (!integer(maxRevisionGap) || Number(maxRevisionGap) < 0 || Number(maxRevisionGap) > 1024) {
    throw new RangeError('maxRevisionGap must be an integer between 0 and 1024');
  }

  let disposed = false;
  let accepted = 0;
  let rejected = 0;
  let last = null;

  function reject(reason, frame) {
    rejected += 1;
    return Object.freeze({ ok: false, reason, frame: frame ?? null, accepted, rejected });
  }

  function accept(frame) {
    accepted += 1;
    last = Object.freeze({
      version: Number(frame.version),
      revision: Number(frame.revision),
      timestamp: Number(frame.timestamp),
      attackSerial: Number(frame.attack?.serial ?? 0),
    });
    return Object.freeze({ ok: true, frame: cloneAndFreeze(frame), accepted, rejected });
  }

  function inspect(frame) {
    if (disposed) return reject('disposed', frame);
    if (!frame || typeof frame !== 'object') return reject('missing-frame', frame);
    if (Number(frame.version) !== 1) return reject('unsupported-version', frame);
    if (!integer(frame.revision) || Number(frame.revision) < 0) return reject('invalid-revision', frame);
    if (!finite(frame.timestamp)) return reject('invalid-timestamp', frame);
    if (!frame.attack || !integer(frame.attack.serial) || Number(frame.attack.serial) < 0) {
      return reject('invalid-attack-serial', frame);
    }
    if (last) {
      const revision = Number(frame.revision);
      const timestamp = Number(frame.timestamp);
      const attackSerial = Number(frame.attack.serial);
      if (revision < last.revision) return reject('revision-regressed', frame);
      if (revision - last.revision > Number(maxRevisionGap)) return reject('revision-gap', frame);
      if (timestamp + Number(maxTimestampRegression) < last.timestamp) return reject('timestamp-regressed', frame);
      if (attackSerial < last.attackSerial) return reject('attack-serial-regressed', frame);
    }
    return accept(frame);
  }

  function reset() {
    accepted = 0;
    rejected = 0;
    last = null;
    return readState();
  }

  function dispose() {
    disposed = true;
    return readState();
  }

  function readState() {
    return Object.freeze({
      version: PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION,
      disposed,
      accepted,
      rejected,
      last: last ? Object.freeze({ ...last }) : null,
    });
  }

  return Object.freeze({ inspect, reset, dispose, readState });
}
