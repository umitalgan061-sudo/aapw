/**
 * Consumer bridge for player traversal presentation.
 *
 * The bridge creates isolated output packets for renderer-facing consumers. No consumer receives the raw
 * cue object, and no packet exposes mutable references to policy state. This prevents accidental writes
 * flowing back into gameplay state while allowing animation/audio/VFX adapters to evolve independently.
 */
import {
  createPlayerTraversalPresentationContract,
  toAnimationTraversalSignal,
  toAudioTraversalSignal,
  toDebugTraversalSignal,
  toLegacyTraversalSignal,
  toVfxTraversalSignal,
  validatePlayerTraversalPresentationContract,
} from './playerTraversalPresentationContract.js';

export const PLAYER_TRAVERSAL_PRESENTATION_BRIDGE_VERSION = '2026-09-15-v1';
function freeze(value) { return Object.freeze(value); }
function text(value, fallback='') { return typeof value === 'string' && value ? value : fallback; }

export function buildPlayerTraversalConsumerPacket(presentation = {}, options = {}) {
  const contract = createPlayerTraversalPresentationContract(presentation);
  const validation = validatePlayerTraversalPresentationContract(contract);
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_BRIDGE_VERSION,
    contract,
    valid: validation.valid,
    animation: toAnimationTraversalSignal(contract),
    audio: options.audio === false ? null : toAudioTraversalSignal(contract),
    vfx: options.vfx === false ? null : toVfxTraversalSignal(contract),
    legacy: options.legacy === false ? null : toLegacyTraversalSignal(contract),
    debug: options.debug === false ? null : toDebugTraversalSignal(contract),
  });
}

export function selectTraversalConsumerSignals(packet = {}, channels = {}) {
  const selected = {};
  const names = Object.keys(channels);
  for (const name of names) {
    if (channels[name] === false) continue;
    if (packet[name] !== undefined) selected[name] = packet[name];
  }
  return freeze(selected);
}

export function filterTraversalPacketForProduction(packet = {}) {
  return freeze({
    version: packet.version,
    valid: packet.valid,
    contract: packet.contract,
    animation: packet.animation,
    audio: packet.audio,
    vfx: packet.vfx,
    legacy: packet.legacy,
  });
}

export function annotateTraversalPacket(packet = {}, source = 'gameplay') {
  return freeze({ ...packet, source: text(source, 'gameplay') });
}

export function createTraversalConsumerSnapshot(packet = {}) {
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_BRIDGE_VERSION,
    state: packet.contract?.state ?? 'clear',
    phase: packet.contract?.phase ?? 'idle',
    event: packet.contract?.event ?? 'none',
    confidence: packet.contract?.confidence ?? 0,
    animationState: packet.animation?.locomotionState ?? 'clear',
    audioCue: packet.audio?.cue ?? 'none',
    vfxCue: packet.vfx?.cue ?? 'none',
  });
}

export function compareTraversalConsumerSnapshots(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}
