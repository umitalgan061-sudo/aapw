const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback = '') => String(value ?? fallback).trim();

const CHANNELS = Object.freeze(['animation', 'equipment', 'feedback', 'resources', 'target']);

const normalizeChannel = (channel) => {
  if (!channel || typeof channel !== 'object') return null;
  const name = text(channel.name);
  if (!CHANNELS.includes(name)) return null;
  return Object.freeze({
    name,
    version: Math.max(0, Math.floor(finite(channel.version, 0))),
    accepted: channel.accepted !== false,
    reason: text(channel.reason, channel.accepted === false ? 'rejected' : 'accepted'),
  });
};

const normalizeFrame = (frame) => {
  const snapshot = frame && typeof frame === 'object' ? frame : {};
  const channels = Array.isArray(snapshot.channels)
    ? snapshot.channels.map(normalizeChannel).filter(Boolean)
    : [];
  return {
    frame: Math.max(0, Math.floor(finite(snapshot.frame, 0))),
    sequence: Math.max(0, Math.floor(finite(snapshot.sequence, 0))),
    channels,
  };
};

export function createPlayerCombatFrameCommitGate({ maxReceipts = 32 } = {}) {
  const state = { lastFrame: -1, lastSequence: -1, receipts: [], disposed: false };
  const limit = () => Math.max(1, Math.floor(finite(maxReceipts, 32)));

  const receipt = (frame, status, reason) => Object.freeze({
    frame: frame.frame,
    sequence: frame.sequence,
    status,
    reason,
    channels: frame.channels.map((channel) => ({ ...channel })),
  });

  const commit = (rawFrame = {}) => {
    if (state.disposed) return receipt({ frame: 0, sequence: 0, channels: [] }, 'rejected', 'disposed');
    const frame = normalizeFrame(rawFrame);
    if (frame.frame < state.lastFrame) return receipt(frame, 'rejected', 'stale-frame');
    if (frame.frame === state.lastFrame && frame.sequence <= state.lastSequence) return receipt(frame, 'rejected', 'duplicate-sequence');
    const accepted = frame.channels.filter((channel) => channel.accepted);
    const committed = { ...frame, channels: accepted };
    state.lastFrame = frame.frame;
    state.lastSequence = frame.sequence;
    const result = receipt(committed, 'committed', accepted.length ? 'accepted' : 'no-accepted-channels');
    state.receipts.push(result);
    if (state.receipts.length > limit()) state.receipts.splice(0, state.receipts.length - limit());
    return result;
  };

  const snapshot = () => Object.freeze({
    disposed: state.disposed,
    lastFrame: state.lastFrame,
    lastSequence: state.lastSequence,
    receipts: state.receipts.map((entry) => ({ ...entry, channels: entry.channels.map((channel) => ({ ...channel })) })),
  });

  const reset = () => {
    if (state.disposed) return;
    state.lastFrame = -1;
    state.lastSequence = -1;
    state.receipts.length = 0;
  };

  const dispose = () => {
    state.disposed = true;
    state.receipts.length = 0;
  };

  return Object.freeze({ commit, snapshot, reset, dispose });
}

export { CHANNELS };
