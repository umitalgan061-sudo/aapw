/**
 * Versioned worker-rendering message protocol.
 *
 * This protocol is deliberately data-only so a future OffscreenCanvas/WebGPU worker can be introduced
 * without leaking DOM, Three.js or gameplay objects across the worker boundary. Messages are validated
 * before they cross the boundary and include a monotonic sequence number for deterministic ordering.
 * @module renderWorkerProtocol
 */

export const RENDER_PROTOCOL_VERSION = 1;
export const RENDER_MESSAGE_TYPES = Object.freeze({ INIT: 'init', RESIZE: 'resize', QUALITY: 'quality', FRAME: 'frame', DISPOSE: 'dispose', ACK: 'ack', ERROR: 'error' });
const TYPES = new Set(Object.values(RENDER_MESSAGE_TYPES));
function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function integer(value, fallback = 0) { return Math.trunc(n(value, fallback)); }

function sanitizePayload(payload) {
  if (payload == null) return null;
  if (Array.isArray(payload)) return payload.slice(0, 64).map((value) => sanitizePayload(value));
  if (typeof payload !== 'object') return typeof payload === 'string' ? payload.slice(0, 512) : Number.isFinite(Number(payload)) ? Number(payload) : null;
  const output = {};
  for (const [key, value] of Object.entries(payload).slice(0, 64)) output[String(key).slice(0, 96)] = sanitizePayload(value);
  return output;
}

export function createRenderMessage({ type, sequence, payload = null, timestampMs = 0 } = {}) {
  const normalizedType = String(type ?? '');
  if (!TYPES.has(normalizedType)) throw new TypeError(`unknown render message type: ${normalizedType}`);
  return Object.freeze({
    protocol: RENDER_PROTOCOL_VERSION,
    type: normalizedType,
    sequence: Math.max(0, integer(sequence)),
    timestampMs: Math.max(0, Number(n(timestampMs, 0).toFixed(3))),
    payload: sanitizePayload(payload),
  });
}

export function validateRenderMessage(message, { expectedSequence = null } = {}) {
  if (!message || message.protocol !== RENDER_PROTOCOL_VERSION || !TYPES.has(message.type)) return false;
  if (!Number.isInteger(message.sequence) || message.sequence < 0) return false;
  if (expectedSequence != null && message.sequence !== expectedSequence) return false;
  return true;
}

export function createRenderProtocolController({ startSequence = 0 } = {}) {
  let nextSequence = Math.max(0, integer(startSequence));
  let lastReceived = nextSequence - 1;
  let disposed = false;
  const history = [];
  function record(direction, message) {
    history.push(Object.freeze({ direction, sequence: message.sequence, type: message.type }));
    while (history.length > 32) history.shift();
  }
  function send(type, payload = null, timestampMs = 0) {
    if (disposed) throw new Error('RENDER_PROTOCOL_DISPOSED');
    const message = createRenderMessage({ type, sequence: nextSequence++, payload, timestampMs });
    record('out', message);
    return message;
  }
  function receive(message) {
    if (disposed) return Object.freeze({ accepted: false, reason: 'disposed' });
    if (!validateRenderMessage(message)) return Object.freeze({ accepted: false, reason: 'invalid' });
    if (message.sequence <= lastReceived) return Object.freeze({ accepted: false, reason: 'duplicate-or-stale', sequence: message.sequence });
    if (message.sequence > lastReceived + 1 && message.type !== RENDER_MESSAGE_TYPES.ERROR) return Object.freeze({ accepted: false, reason: 'gap', expected: lastReceived + 1, received: message.sequence });
    lastReceived = message.sequence;
    record('in', message);
    return Object.freeze({ accepted: true, reason: 'accepted', sequence: message.sequence, type: message.type, payload: message.payload });
  }
  return {
    send,
    receive,
    nextSequence() { return nextSequence; },
    lastReceived() { return lastReceived; },
    snapshot() { return Object.freeze({ protocol: RENDER_PROTOCOL_VERSION, nextSequence, lastReceived, history: Object.freeze(history.slice(-12)) }); },
    reset(sequence = 0) { nextSequence = Math.max(0, integer(sequence)); lastReceived = nextSequence - 1; history.length = 0; },
    dispose() { disposed = true; history.length = 0; },
  };
}

export function encodeRenderResize({ width, height, pixelRatio } = {}) {
  return Object.freeze({ width: Math.max(1, integer(width, 1)), height: Math.max(1, integer(height, 1)), pixelRatio: Math.max(0.5, Number(n(pixelRatio, 1).toFixed(3))) });
}

export function encodeRenderQuality(profile = {}) {
  return Object.freeze({
    tier: String(profile.tier ?? 'balanced'),
    renderScale: Math.max(0.5, Math.min(1.25, n(profile.renderScale, 1))),
    shadowMap: Math.max(256, integer(profile.shadowMap, 1024)),
    fxScale: Math.max(0, Math.min(1, n(profile.fxScale, 1))),
  });
}

export function encodeFrameSignal({ elapsedSeconds = 0, deltaSeconds = 0, viewX = 0, viewY = 0, viewZ = 0 } = {}) {
  return Object.freeze({ elapsedSeconds: Math.max(0, n(elapsedSeconds)), deltaSeconds: Math.max(0, Math.min(0.25, n(deltaSeconds))), view: { x: n(viewX), y: n(viewY), z: n(viewZ) } });
}
