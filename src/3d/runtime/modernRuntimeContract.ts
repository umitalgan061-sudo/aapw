// @ts-nocheck
/**
 * Modern runtime contract primitives.
 *
 * This module provides dependency-light, deterministic contracts for the browser game runtime.
 * It deliberately avoids owning renderer, physics, input devices, storage, network or clocks.
 * Consumers can adapt these contracts to the existing AAPW runtime without changing ownership.
 */

export const RUNTIME_SCHEMA_VERSION = 1;
export const RUNTIME_PROTOCOL = 'aapw-runtime';
export const RUNTIME_PHASES = Object.freeze([
  'bootstrap',
  'suspend',
  'resume',
  'simulate',
  'present',
  'throttle',
  'recover',
  'shutdown',
]);
export const QUALITY_TIERS = Object.freeze(['minimal', 'low', 'medium', 'high', 'ultra']);
export const VISIBILITY_STATES = Object.freeze(['visible', 'hidden', 'prerender', 'unknown']);
export const INPUT_ACTIONS = Object.freeze([
  'move',
  'look',
  'primary',
  'secondary',
  'dodge',
  'interact',
  'pause',
  'cancel',
]);

const INTEGER_MIN = -2147483648;
const INTEGER_MAX = 2147483647;

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

export function finiteOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function nonNegative(value, fallback = 0) {
  return Math.max(0, finiteOr(value, fallback));
}

export function integerOr(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.trunc(clamp(number, INTEGER_MIN, INTEGER_MAX));
}

export function booleanOr(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

export function enumOr(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function copyVector2(value, fallback = { x: 0, y: 0 }) {
  return Object.freeze({
    x: finiteOr(value?.x, fallback.x),
    y: finiteOr(value?.y, fallback.y),
  });
}

export function copyVector3(value, fallback = { x: 0, y: 0, z: 0 }) {
  return Object.freeze({
    x: finiteOr(value?.x, fallback.x),
    y: finiteOr(value?.y, fallback.y),
    z: finiteOr(value?.z, fallback.z),
  });
}

export function createRuntimeId(prefix = 'rt') {
  const safePrefix = String(prefix || 'rt').replace(/[^a-z0-9_-]/gi, '-');
  const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${safePrefix}-${Date.now().toString(36)}-${random}`;
}

export function createMonotonicSequence(start = 0) {
  let next = Math.max(0, integerOr(start, 0));
  return () => {
    const current = next;
    next = next >= INTEGER_MAX ? 0 : next + 1;
    return current;
  };
}

export function normalizeRuntimePhase(value) {
  return enumOr(value, RUNTIME_PHASES, 'bootstrap');
}

export function normalizeQualityTier(value) {
  return enumOr(value, QUALITY_TIERS, 'medium');
}

export function normalizeVisibility(value) {
  return enumOr(value, VISIBILITY_STATES, 'unknown');
}

export function createRuntimeCapabilities(input = {}) {
  const capabilities = {
    webgl: booleanOr(input.webgl),
    webgpu: booleanOr(input.webgpu),
    offscreenCanvas: booleanOr(input.offscreenCanvas),
    sharedArrayBuffer: booleanOr(input.sharedArrayBuffer),
    indexedDb: booleanOr(input.indexedDb),
    serviceWorker: booleanOr(input.serviceWorker),
    broadcastChannel: booleanOr(input.broadcastChannel),
    gamepad: booleanOr(input.gamepad),
    pointerLock: booleanOr(input.pointerLock),
    prefersReducedMotion: booleanOr(input.prefersReducedMotion),
    hardwareConcurrency: clamp(integerOr(input.hardwareConcurrency, 1), 1, 128),
    devicePixelRatio: clamp(finiteOr(input.devicePixelRatio, 1), 0.5, 4),
  };
  return Object.freeze(capabilities);
}

export function createRuntimeBudget(input = {}) {
  return Object.freeze({
    frameMs: clamp(finiteOr(input.frameMs, 16.67), 4, 100),
    simulationMs: clamp(finiteOr(input.simulationMs, 7), 1, 80),
    presentationMs: clamp(finiteOr(input.presentationMs, 4), 0.5, 40),
    memoryMb: clamp(finiteOr(input.memoryMb, 512), 64, 8192),
    entities: clamp(integerOr(input.entities, 500), 1, 200000),
    drawCalls: clamp(integerOr(input.drawCalls, 500), 10, 10000),
    textureMb: clamp(finiteOr(input.textureMb, 256), 16, 4096),
  });
}

export function createRuntimeSnapshot(input = {}) {
  const frame = input.frame || {};
  const world = input.world || {};
  const quality = input.quality || {};
  return Object.freeze({
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    protocol: RUNTIME_PROTOCOL,
    sessionId: String(input.sessionId || 'unknown'),
    phase: normalizeRuntimePhase(input.phase),
    visibility: normalizeVisibility(input.visibility),
    timestampMs: nonNegative(input.timestampMs, 0),
    frame: Object.freeze({
      deltaMs: clamp(finiteOr(frame.deltaMs, 16.67), 0, 250),
      fps: clamp(finiteOr(frame.fps, 60), 0, 1000),
      cpuMs: clamp(finiteOr(frame.cpuMs, 0), 0, 250),
      gpuMs: clamp(finiteOr(frame.gpuMs, 0), 0, 250),
      dropped: booleanOr(frame.dropped),
    }),
    world: Object.freeze({
      tick: Math.max(0, integerOr(world.tick, 0)),
      entityCount: Math.max(0, integerOr(world.entityCount, 0)),
      activeZones: Math.max(0, integerOr(world.activeZones, 0)),
    }),
    quality: Object.freeze({
      tier: normalizeQualityTier(quality.tier),
      scale: clamp(finiteOr(quality.scale, 1), 0.25, 2),
      locked: booleanOr(quality.locked),
    }),
    flags: Object.freeze({ ...input.flags }),
  });
}

export function createInputSample(input = {}) {
  return Object.freeze({
    sequence: Math.max(0, integerOr(input.sequence, 0)),
    timestampMs: nonNegative(input.timestampMs, 0),
    action: enumOr(input.action, INPUT_ACTIONS, 'move'),
    phase: enumOr(input.phase, ['pressed', 'held', 'released'], 'held'),
    value: clamp(finiteOr(input.value, 0), -1, 1),
    vector: copyVector2(input.vector),
    device: String(input.device || 'unknown'),
    source: String(input.source || 'unknown'),
  });
}

export function createRuntimeEvent(type, payload = {}, sequence = 0, timestampMs = 0) {
  return Object.freeze({
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    sequence: Math.max(0, integerOr(sequence, 0)),
    timestampMs: nonNegative(timestampMs, 0),
    type: String(type || 'runtime.unknown'),
    payload: Object.freeze({ ...payload }),
  });
}

export function assertRuntimeSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== RUNTIME_SCHEMA_VERSION) {
    throw new TypeError('Invalid runtime snapshot schema version.');
  }
  if (!RUNTIME_PHASES.includes(snapshot.phase)) {
    throw new TypeError('Invalid runtime snapshot phase.');
  }
  if (!QUALITY_TIERS.includes(snapshot.quality?.tier)) {
    throw new TypeError('Invalid runtime snapshot quality tier.');
  }
  return snapshot;
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input)) throw new TypeError('Cannot serialize cyclic runtime data.');
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    const result = {};
    Object.keys(input).sort().forEach((key) => {
      const normalized = normalize(input[key]);
      if (normalized !== undefined) result[key] = normalized;
    });
    return result;
  };
  return JSON.stringify(normalize(value));
}

export function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Reflect.ownKeys(value).forEach((key) => freezeDeep(value[key], seen));
  return Object.freeze(value);
}

export function compareVersions(a, b) {
  const left = String(a || '').split('.').map((v) => integerOr(v, 0));
  const right = String(b || '').split('.').map((v) => integerOr(v, 0));
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function mergeRecords(...records) {
  const result = {};
  records.filter(Boolean).forEach((record) => {
    Object.entries(record).forEach(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = mergeRecords(result[key], value);
      } else if (value !== undefined) {
        result[key] = value;
      }
    });
  });
  return result;
}

export function omitUndefined(record = {}) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function percent(value, min = 0, max = 1) {
  const normalized = clamp(value, min, max);
  const span = max - min || 1;
  return ((normalized - min) / span) * 100;
}

export function lerp(from, to, alpha) {
  const t = clamp(alpha, 0, 1);
  return finiteOr(from) + (finiteOr(to) - finiteOr(from)) * t;
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((finiteOr(value) - edge0) / ((edge1 - edge0) || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

export function exponentialSmoothing(current, target, halfLifeMs, deltaMs) {
  const halfLife = Math.max(0.001, finiteOr(halfLifeMs, 100));
  const delta = Math.max(0, finiteOr(deltaMs, 0));
  const alpha = 1 - Math.pow(0.5, delta / halfLife);
  return lerp(current, target, alpha);
}

export function makeRingBuffer(capacity = 128) {
  const size = Math.max(1, integerOr(capacity, 128));
  const data = new Array(size);
  let cursor = 0;
  let length = 0;
  return Object.freeze({
    push(value) {
      data[cursor] = value;
      cursor = (cursor + 1) % size;
      length = Math.min(length + 1, size);
    },
    get length() {
      return length;
    },
    get capacity() {
      return size;
    },
    toArray() {
      const output = [];
      const start = length === size ? cursor : 0;
      for (let index = 0; index < length; index += 1) {
        output.push(data[(start + index) % size]);
      }
      return output;
    },
    clear() {
      data.fill(undefined);
      cursor = 0;
      length = 0;
    },
  });
}

export function createNoopLogger() {
  return Object.freeze({
    debug() {},
    info() {},
    warn() {},
    error() {},
  });
}

export function resolveLogger(logger) {
  if (!logger || typeof logger !== 'object') return createNoopLogger();
  return Object.freeze({
    debug: typeof logger.debug === 'function' ? logger.debug.bind(logger) : () => {},
    info: typeof logger.info === 'function' ? logger.info.bind(logger) : () => {},
    warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : () => {},
    error: typeof logger.error === 'function' ? logger.error.bind(logger) : () => {},
  });
}

export function createDisposer() {
  const callbacks = new Set();
  return Object.freeze({
    add(callback) {
      if (typeof callback !== 'function') return () => {};
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    dispose() {
      const errors = [];
      for (const callback of callbacks) {
        try { callback(); } catch (error) { errors.push(error); }
      }
      callbacks.clear();
      if (errors.length) throw new AggregateError(errors, 'Runtime disposer failures.');
    },
  });
}
