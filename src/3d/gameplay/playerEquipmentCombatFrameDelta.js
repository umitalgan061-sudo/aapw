/**
 * Low-noise delta adapter for the existing player equipment/combat frame stream.
 *
 * It does not own gameplay truth, inventory, animation mixers, scene lifecycle, or materials.
 * Consumers receive only changed channels from caller-owned immutable frame snapshots.
 */

const CHANNELS = Object.freeze(['phase', 'attack', 'defense', 'movement', 'animation', 'equipment', 'sockets', 'outcome', 'audit']);
const MAX_HISTORY = 32;
const stable = (value) => JSON.stringify(value ?? null);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function normalizeFrame(frame) {
  if (!frame || typeof frame !== 'object') return Object.freeze({});
  return frame;
}

function changedChannels(previous, next) {
  const changed = [];
  for (const channel of CHANNELS) {
    if (stable(previous?.[channel]) !== stable(next?.[channel])) changed.push(channel);
  }
  return changed;
}

export function createPlayerEquipmentCombatFrameDelta({
  target = globalThis,
  eventName = 'aapw:player-equipment-combat-frame',
  maxHistory = MAX_HISTORY,
  onDelta = null,
} = {}) {
  const boundedHistory = Math.max(1, Math.min(MAX_HISTORY, Math.floor(Number(maxHistory) || MAX_HISTORY)));
  let disposed = false;
  let sequence = 0;
  let previous = Object.freeze({});
  let latest = Object.freeze({});
  const history = [];
  const listeners = [];

  const publish = (frame) => {
    if (disposed) return null;
    const next = normalizeFrame(frame);
    const channels = changedChannels(previous, next);
    if (channels.length === 0) return null;
    sequence += 1;
    const delta = Object.freeze({
      version: 1,
      sequence,
      revision: Number.isFinite(Number(next.revision)) ? Number(next.revision) : sequence,
      timestamp: Number.isFinite(Number(next.timestamp)) ? Number(next.timestamp) : 0,
      changed: Object.freeze(channels.slice()),
      frame: Object.freeze(clone(next)),
      patch: Object.freeze(Object.fromEntries(channels.map((channel) => [channel, clone(next[channel])])))
    });
    previous = next;
    latest = delta;
    history.push(delta);
    if (history.length > boundedHistory) history.splice(0, history.length - boundedHistory);
    try { onDelta?.(delta); } catch { /* isolate observers */ }
    return delta;
  };

  const onFrame = (event) => publish(event?.detail);
  if (typeof target?.addEventListener === 'function') {
    target.addEventListener(eventName, onFrame);
    listeners.push([eventName, onFrame]);
  }

  return Object.freeze({
    publish,
    read: () => latest,
    readHistory: () => history.slice(),
    reset: () => { if (!disposed) { previous = Object.freeze({}); latest = Object.freeze({}); history.length = 0; sequence = 0; } },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [type, handler] of listeners) target.removeEventListener?.(type, handler);
      listeners.length = 0;
      previous = Object.freeze({});
      latest = Object.freeze({});
      history.length = 0;
    },
    get disposed() { return disposed; },
  });
}

export { CHANNELS as PLAYER_EQUIPMENT_COMBAT_DELTA_CHANNELS };
