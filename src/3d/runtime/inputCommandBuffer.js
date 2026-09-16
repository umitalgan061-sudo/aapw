/**
 * Deterministic input command buffer.
 *
 * Normalizes keyboard, pointer, touch and gamepad adapters into timestamped semantic commands.
 * The buffer does not read DOM devices itself. It provides repeatable edge/hold/release semantics,
 * deadzones, sensitivity, action remapping and replay-friendly command serialization.
 */

import {
  INPUT_ACTIONS,
  clamp,
  finiteOr,
  integerOr,
  copyVector2,
  makeRingBuffer,
} from './modernRuntimeContract.js';

const PHASES = Object.freeze(['pressed', 'held', 'released']);
const DEFAULT_ACTIONS = Object.freeze(Object.fromEntries(INPUT_ACTIONS.map((action) => [action, action])));

function normalizePhase(phase) {
  return PHASES.includes(phase) ? phase : 'held';
}

function normalizeVector(value, deadzone = 0.12) {
  const vector = copyVector2(value);
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= deadzone) return Object.freeze({ x: 0, y: 0 });
  const normalizedMagnitude = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  const scale = normalizedMagnitude / magnitude;
  return Object.freeze({ x: vector.x * scale, y: vector.y * scale });
}

function normalizeScalar(value, deadzone = 0.08) {
  const absolute = Math.abs(finiteOr(value, 0));
  if (absolute <= deadzone) return 0;
  return Math.sign(value) * Math.min(1, (absolute - deadzone) / (1 - deadzone));
}

function cloneCommand(command) {
  return Object.freeze({
    sequence: integerOr(command.sequence, 0),
    tick: Math.max(0, integerOr(command.tick, 0)),
    timestampMs: Math.max(0, finiteOr(command.timestampMs, 0)),
    action: String(command.action || 'move'),
    phase: normalizePhase(command.phase),
    value: clamp(finiteOr(command.value, 0), -1, 1),
    vector: normalizeVector(command.vector),
    device: String(command.device || 'unknown'),
    source: String(command.source || 'unknown'),
    consumed: Boolean(command.consumed),
  });
}

export function createInputCommandBuffer(options = {}) {
  const capacity = Math.max(32, integerOr(options.capacity, 1024));
  const commands = makeRingBuffer(capacity);
  const actions = { ...DEFAULT_ACTIONS, ...(options.actions || {}) };
  const deadzone = clamp(finiteOr(options.deadzone, 0.12), 0, 0.8);
  const sensitivity = clamp(finiteOr(options.sensitivity, 1), 0.1, 4);
  let sequence = 0;
  let latestTick = 0;
  let held = new Set();
  let overflowCount = 0;
  const consumedByTick = new Map();

  function mapAction(action) {
    const requested = String(action || 'move');
    return String(actions[requested] || requested);
  }

  function push(input = {}) {
    if (commands.length >= commands.capacity) overflowCount += 1;
    const action = mapAction(input.action);
    if (!INPUT_ACTIONS.includes(action) && !Object.values(actions).includes(action)) return null;
    const phase = normalizePhase(input.phase);
    const command = cloneCommand({
      sequence: sequence++,
      tick: Math.max(latestTick, integerOr(input.tick, latestTick)),
      timestampMs: finiteOr(input.timestampMs, 0),
      action,
      phase,
      value: normalizeScalar(finiteOr(input.value, 0), deadzone) * sensitivity,
      vector: normalizeVector(input.vector, deadzone),
      device: input.device,
      source: input.source,
    });
    commands.push(command);
    if (phase === 'pressed' || phase === 'held') held.add(action);
    if (phase === 'released') held.delete(action);
    return command;
  }

  function setTick(tick) {
    latestTick = Math.max(0, integerOr(tick, latestTick));
    return latestTick;
  }

  function drainUntil(tick, options = {}) {
    const targetTick = Math.max(0, integerOr(tick, latestTick));
    const records = commands.toArray();
    const includeHeld = options.includeHeld !== false;
    const consumed = [];
    const retained = [];
    const seen = new Set();
    for (const command of records) {
      if (command.tick <= targetTick && !seen.has(command.sequence)) {
        consumed.push(command);
        seen.add(command.sequence);
      } else retained.push(command);
    }
    if (includeHeld) {
      for (const action of held) {
        consumed.push(cloneCommand({ sequence: sequence++, tick: targetTick, timestampMs: 0, action, phase: 'held', value: 1, vector: { x: 0, y: 0 }, device: 'buffer', source: 'held-state' }));
      }
    }
    consumedByTick.set(targetTick, consumed.map((item) => item.sequence));
    if (consumedByTick.size > 256) consumedByTick.delete(consumedByTick.keys().next().value);
    // Rebuild the ring without advancing the public sequence.
    commands.clear();
    for (const command of retained) commands.push(command);
    return Object.freeze(consumed);
  }

  function peekUntil(tick) {
    const targetTick = Math.max(0, integerOr(tick, latestTick));
    return Object.freeze(commands.toArray().filter((command) => command.tick <= targetTick));
  }

  function isHeld(action) {
    return held.has(mapAction(action));
  }

  function releaseAll(tick = latestTick, timestampMs = 0) {
    const released = [];
    for (const action of held) {
      released.push(push({ action, phase: 'released', tick, timestampMs, device: 'buffer', source: 'release-all' }));
    }
    return Object.freeze(released);
  }

  function clear() {
    commands.clear();
    held = new Set();
    consumedByTick.clear();
  }

  function serialize() {
    return Object.freeze(commands.toArray().map((command) => ({ ...command, vector: { ...command.vector } })));
  }

  function importCommands(list = []) {
    clear();
    for (const command of list) push(command);
    return commands.length;
  }

  function remap(nextActions = {}) {
    Object.assign(actions, nextActions);
    return Object.freeze({ ...actions });
  }

  function snapshot() {
    return Object.freeze({
      capacity,
      sequence,
      latestTick,
      overflowCount,
      held: Object.freeze([...held]),
      queued: serialize(),
    });
  }

  return Object.freeze({
    push,
    setTick,
    drainUntil,
    peekUntil,
    isHeld,
    releaseAll,
    clear,
    serialize,
    importCommands,
    remap,
    snapshot,
    get length() { return commands.length; },
    get overflowCount() { return overflowCount; },
    get latestTick() { return latestTick; },
  });
}

export function createPointerLookCommand(x, y, options = {}) {
  const sensitivity = clamp(finiteOr(options.sensitivity, 1), 0.01, 8);
  return Object.freeze({
    action: 'look',
    phase: 'held',
    vector: Object.freeze({
      x: clamp(finiteOr(x, 0) * sensitivity, -1, 1),
      y: clamp(finiteOr(y, 0) * sensitivity, -1, 1),
    }),
    value: 1,
    device: options.device || 'pointer',
    source: options.source || 'pointer-look',
    timestampMs: Math.max(0, finiteOr(options.timestampMs, 0)),
    tick: Math.max(0, integerOr(options.tick, 0)),
  });
}

export function createMoveCommand(x, y, options = {}) {
  return Object.freeze({
    action: 'move',
    phase: options.phase || 'held',
    vector: normalizeVector({ x, y }, clamp(finiteOr(options.deadzone, 0.12), 0, 0.8)),
    value: 1,
    device: options.device || 'keyboard',
    source: options.source || 'move',
    timestampMs: Math.max(0, finiteOr(options.timestampMs, 0)),
    tick: Math.max(0, integerOr(options.tick, 0)),
  });
}

export function createActionCommand(action, phase = 'pressed', options = {}) {
  return Object.freeze({
    action: String(action || 'interact'),
    phase: normalizePhase(phase),
    value: clamp(finiteOr(options.value, 1), -1, 1),
    vector: normalizeVector(options.vector, 0.12),
    device: options.device || 'keyboard',
    source: options.source || 'action',
    timestampMs: Math.max(0, finiteOr(options.timestampMs, 0)),
    tick: Math.max(0, integerOr(options.tick, 0)),
  });
}

export function validateInputCommand(command) {
  const problems = [];
  if (!command || !String(command.action || '').trim()) problems.push('missing action');
  if (!PHASES.includes(command?.phase)) problems.push('invalid phase');
  if (!Number.isFinite(Number(command?.value))) problems.push('invalid value');
  if (!Number.isFinite(Number(command?.tick)) || Number(command.tick) < 0) problems.push('invalid tick');
  return Object.freeze({ valid: problems.length === 0, problems });
}
