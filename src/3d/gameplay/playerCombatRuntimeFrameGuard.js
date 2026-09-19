/**
 * Consumer-side guard for the existing player/equipment/combat frame stream.
 *
 * This is deliberately an adapter, not a second combat state machine. It rejects stale,
 * regressive or identity-changing frames before they reach animation/equipment presentation.
 *
 * @module gameplay/playerCombatRuntimeFrameGuard
 */

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value) => typeof value === 'number' && Number.isInteger(value);
const bounded = (value, min, max) => finite(value) && value >= min && value <= max;
const isPlainRecord = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION = 1;

function readEnumerableDataEntries(value, descriptors) {
  const entries = [];
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable) continue;
    if (!('value' in descriptor)) return { failure: 'payload-accessor-unsupported', entries: null };
    entries.push([key, descriptor.value]);
  }
  return { failure: null, entries };
}

function inspectPayloadBudget(
  value,
  maxDepth,
  maxNodes,
  maxKeys,
  maxArrayLength,
  maxStringLength,
  maxTotalStringLength,
  depth = 0,
  seen = new WeakSet(),
  state = { nodes: 0, keys: 0, totalStringLength: 0 },
) {
  try {
    if (typeof value === 'string') {
      state.totalStringLength += value.length;
      if (value.length > maxStringLength) return 'payload-string-length-exceeded';
      if (state.totalStringLength > maxTotalStringLength) return 'payload-total-string-length-exceeded';
      return null;
    }
    if (value === null || typeof value !== 'object') return null;
    if (Array.isArray(value) === false && !isPlainRecord(value)) return 'payload-object-type-unsupported';
    if (depth > maxDepth) return 'payload-depth-exceeded';
    if (Array.isArray(value) && value.length > maxArrayLength) return 'payload-array-length-exceeded';
    if (seen.has(value)) return null;
    seen.add(value);
    state.nodes += 1;
    if (state.nodes > maxNodes) return 'payload-node-budget-exceeded';
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) return 'payload-symbol-key-unsupported';
    const readable = readEnumerableDataEntries(value, descriptors);
    if (readable.failure) return readable.failure;
    state.keys += readable.entries.length;
    if (state.keys > maxKeys) return 'payload-key-budget-exceeded';
    for (const [, child] of readable.entries) {
      const failure = inspectPayloadBudget(
        child,
        maxDepth,
        maxNodes,
        maxKeys,
        maxArrayLength,
        maxStringLength,
        maxTotalStringLength,
        depth + 1,
        seen,
        state,
      );
      if (failure) return failure;
    }
    return null;
  } catch {
    return 'payload-inspection-failed';
  }
}

function cloneAndFreeze(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const clone = Array.isArray(value) ? [] : Object.create(null);
  if (Array.isArray(value)) clone.length = value.length;
  seen.set(value, clone);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor)) continue;
    clone[key] = cloneAndFreeze(descriptor.value, seen);
  }
  return Object.freeze(clone);
}

function cloneRejectionFrame(frame, limits) {
  if (frame == null || typeof frame !== 'object') return frame;
  try {
    const failure = inspectPayloadBudget(
      frame,
      limits.maxPayloadDepth,
      limits.maxPayloadNodes,
      limits.maxPayloadKeys,
      limits.maxPayloadArrayLength,
      limits.maxPayloadStringLength,
      limits.maxPayloadTotalStringLength,
    );
    return failure ? null : cloneAndFreeze(frame);
  } catch {
    return null;
  }
}

export function createPlayerCombatRuntimeFrameGuard({
  maxTimestampRegression = 0,
  maxRevisionGap = 1,
  maxPayloadDepth = 12,
  maxPayloadNodes = 256,
  maxPayloadKeys = 1024,
  maxPayloadArrayLength = 1024,
  maxPayloadStringLength = 8192,
  maxPayloadTotalStringLength = 32768,
} = {}) {
  if (!bounded(maxTimestampRegression, 0, 60)) throw new RangeError('maxTimestampRegression must be between 0 and 60');
  if (!integer(maxRevisionGap) || maxRevisionGap < 0 || maxRevisionGap > 1024) {
    throw new RangeError('maxRevisionGap must be an integer between 0 and 1024');
  }
  if (!integer(maxPayloadDepth) || maxPayloadDepth < 0 || maxPayloadDepth > 64) {
    throw new RangeError('maxPayloadDepth must be an integer between 0 and 64');
  }
  if (!integer(maxPayloadNodes) || maxPayloadNodes < 1 || maxPayloadNodes > 8192) {
    throw new RangeError('maxPayloadNodes must be an integer between 1 and 8192');
  }
  if (!integer(maxPayloadKeys) || maxPayloadKeys < 1 || maxPayloadKeys > 32768) {
    throw new RangeError('maxPayloadKeys must be an integer between 1 and 32768');
  }
  if (!integer(maxPayloadArrayLength) || maxPayloadArrayLength < 1 || maxPayloadArrayLength > 65536) {
    throw new RangeError('maxPayloadArrayLength must be an integer between 1 and 65536');
  }
  if (!integer(maxPayloadStringLength) || maxPayloadStringLength < 1 || maxPayloadStringLength > 1048576) {
    throw new RangeError('maxPayloadStringLength must be an integer between 1 and 1048576');
  }
  if (!integer(maxPayloadTotalStringLength) || maxPayloadTotalStringLength < 1 || maxPayloadTotalStringLength > 4194304) {
    throw new RangeError('maxPayloadTotalStringLength must be an integer between 1 and 4194304');
  }

  const payloadLimits = {
    maxPayloadDepth,
    maxPayloadNodes,
    maxPayloadKeys,
    maxPayloadArrayLength,
    maxPayloadStringLength,
    maxPayloadTotalStringLength,
  };

  let disposed = false;
  let accepted = 0;
  let rejected = 0;
  let last = null;
  let lastFrame = null;

  function reject(reason, frame) {
    rejected += 1;
    return Object.freeze({ ok: false, reason, frame: cloneRejectionFrame(frame, payloadLimits), accepted, rejected });
  }

  function accept(frame, expected) {
    try {
      const snapshot = cloneAndFreeze(frame);
      if (
        snapshot.version !== expected.version
        || snapshot.revision !== expected.revision
        || snapshot.timestamp !== expected.timestamp
        || snapshot.attack?.serial !== expected.attackSerial
      ) {
        return reject('payload-clone-unstable', frame);
      }
      accepted += 1;
      lastFrame = snapshot;
      last = Object.freeze({
        version: snapshot.version,
        revision: snapshot.revision,
        timestamp: snapshot.timestamp,
        attackSerial: snapshot.attack.serial,
      });
      return Object.freeze({ ok: true, frame: lastFrame, accepted, rejected });
    } catch {
      return reject('payload-clone-failed', frame);
    }
  }

  function inspect(frame) {
    if (disposed) return reject('disposed', frame);
    if (!frame || typeof frame !== 'object') return reject('missing-frame', frame);
    const payloadFailure = inspectPayloadBudget(
      frame,
      maxPayloadDepth,
      maxPayloadNodes,
      maxPayloadKeys,
      maxPayloadArrayLength,
      maxPayloadStringLength,
      maxPayloadTotalStringLength,
    );
    if (payloadFailure) return reject(payloadFailure, frame);
    if (frame.version !== PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION) return reject('unsupported-version', frame);
    if (!integer(frame.revision) || frame.revision < 0) return reject('invalid-revision', frame);
    if (!finite(frame.timestamp) || frame.timestamp < 0) return reject('invalid-timestamp', frame);
    if (!frame.attack || typeof frame.attack !== 'object' || !integer(frame.attack.serial) || frame.attack.serial < 0) {
      return reject('invalid-attack-serial', frame);
    }
    const expected = {
      version: frame.version,
      revision: frame.revision,
      timestamp: frame.timestamp,
      attackSerial: frame.attack.serial,
    };
    if (last) {
      const revision = expected.revision;
      const timestamp = expected.timestamp;
      const attackSerial = expected.attackSerial;
      if (revision < last.revision) return reject('revision-regressed', frame);
      if (revision === last.revision && timestamp === last.timestamp && attackSerial === last.attackSerial) {
        return reject('duplicate-frame', frame);
      }
      if (revision - last.revision > maxRevisionGap) return reject('revision-gap', frame);
      if (timestamp + maxTimestampRegression < last.timestamp) return reject('timestamp-regressed', frame);
      if (attackSerial < last.attackSerial) return reject('attack-serial-regressed', frame);
    }
    return accept(frame, expected);
  }

  function reset() {
    disposed = false;
    accepted = 0;
    rejected = 0;
    last = null;
    lastFrame = null;
    return readState();
  }

  function dispose() {
    disposed = true;
    last = null;
    lastFrame = null;
    return readState();
  }

  function readLastFrame() {
    return lastFrame;
  }

  function readState() {
    return Object.freeze({
      version: PLAYER_COMBAT_RUNTIME_FRAME_GUARD_VERSION,
      disposed,
      accepted,
      rejected,
      last: last ? cloneAndFreeze(last) : null,
    });
  }

  return Object.freeze({ inspect, readLastFrame, reset, dispose, readState });
}
