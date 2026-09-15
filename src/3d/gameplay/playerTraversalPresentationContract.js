/**
 * Stable consumer contract for traversal presentation.
 *
 * Consumers should depend on this contract rather than the policy's internal thresholds. The contract
 * keeps animation/audio/VFX/debug integrations resilient when tuning values change. It also provides
 * adapters for legacy consumers that only understand a boolean traversal flag and a normalized weight.
 */
import {
  PLAYER_TRAVERSAL_PRESENTATION_EVENTS,
  PLAYER_TRAVERSAL_PRESENTATION_PHASES,
  PLAYER_TRAVERSAL_PRESENTATION_STATES,
} from './playerTraversalPresentationPolicy.js';

export const PLAYER_TRAVERSAL_PRESENTATION_CONTRACT_VERSION = '2026-09-15-v1';
export const PLAYER_TRAVERSAL_PRESENTATION_CHANNELS = Object.freeze([
  'traversal', 'anticipation', 'commitment', 'contact', 'impact', 'confidence'
]);
export const PLAYER_TRAVERSAL_PRESENTATION_CONTRACT_FIELDS = Object.freeze([
  'version','state','phase','event','technique','confidence','terminal','elapsedSeconds','surfaceId','obstacleId','metrics','channels'
]);

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }

export function createPlayerTraversalPresentationContract(presentation = {}) {
  const metrics = presentation.metrics ?? {};
  const channels = presentation.channels ?? {};
  return freeze({
    version: PLAYER_TRAVERSAL_PRESENTATION_CONTRACT_VERSION,
    state: PLAYER_TRAVERSAL_PRESENTATION_STATES.includes(presentation.state) ? presentation.state : 'clear',
    phase: PLAYER_TRAVERSAL_PRESENTATION_PHASES.includes(presentation.phase) ? presentation.phase : 'idle',
    event: PLAYER_TRAVERSAL_PRESENTATION_EVENTS.includes(presentation.event) ? presentation.event : 'none',
    technique: presentation.technique == null ? null : text(presentation.technique),
    confidence: round(clamp01(presentation.confidence)),
    terminal: Boolean(presentation.terminal),
    elapsedSeconds: round(Math.max(0, finite(presentation.elapsedSeconds))),
    surfaceId: text(presentation.surfaceId, 'unknown'),
    obstacleId: text(presentation.obstacleId),
    metrics: freeze({
      distance: round(Math.max(0, finite(metrics.distance))),
      height: round(finite(metrics.height)),
      width: round(Math.max(0, finite(metrics.width))),
      approachSpeed: round(Math.max(0, finite(metrics.approachSpeed))),
      verticalSpeed: round(finite(metrics.verticalSpeed)),
      traversalWeight: round(clamp01(metrics.traversalWeight)),
      surfaceConfidence: round(clamp01(metrics.surfaceConfidence)),
      footContactConfidence: round(clamp01(metrics.footContactConfidence)),
      impact: round(Math.max(0, finite(metrics.impact))),
    }),
    channels: freeze(Object.fromEntries(PLAYER_TRAVERSAL_PRESENTATION_CHANNELS.map((channel) => [channel, round(clamp01(channels[channel]))]))),
  });
}

export function validatePlayerTraversalPresentationContract(contract = {}) {
  const errors = [];
  if (contract.version !== PLAYER_TRAVERSAL_PRESENTATION_CONTRACT_VERSION) errors.push('version');
  if (!PLAYER_TRAVERSAL_PRESENTATION_STATES.includes(contract.state)) errors.push('state');
  if (!PLAYER_TRAVERSAL_PRESENTATION_PHASES.includes(contract.phase)) errors.push('phase');
  if (!PLAYER_TRAVERSAL_PRESENTATION_EVENTS.includes(contract.event)) errors.push('event');
  if (contract.confidence < 0 || contract.confidence > 1) errors.push('confidence');
  for (const channel of PLAYER_TRAVERSAL_PRESENTATION_CHANNELS) {
    if (contract.channels?.[channel] < 0 || contract.channels?.[channel] > 1) errors.push(`channel:${channel}`);
  }
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function toLegacyTraversalSignal(contract = {}) {
  const active = contract.state !== 'clear' && contract.state !== 'cancelled';
  return freeze({
    active,
    traversal: active ? clamp01(contract.channels?.traversal) : 0,
    blocked: contract.state === 'blocked',
    airborne: contract.state === 'climb' || contract.state === 'drop',
    landing: contract.state === 'land',
  });
}

export function toAnimationTraversalSignal(contract = {}) {
  return freeze({
    locomotionState: contract.state,
    locomotionPhase: contract.phase,
    traversalTechnique: contract.technique,
    traversalWeight: clamp01(contract.channels?.traversal),
    anticipationWeight: clamp01(contract.channels?.anticipation),
    commitmentWeight: clamp01(contract.channels?.commitment),
    contactWeight: clamp01(contract.channels?.contact),
    impactWeight: clamp01(contract.channels?.impact),
    confidence: clamp01(contract.channels?.confidence),
  });
}

export function toAudioTraversalSignal(contract = {}) {
  return freeze({
    cue: contract.event,
    state: contract.state,
    intensity: clamp01(Math.max(contract.channels?.impact ?? 0, contract.channels?.commitment ?? 0)),
    blocked: contract.state === 'blocked',
  });
}

export function toVfxTraversalSignal(contract = {}) {
  return freeze({
    cue: contract.event,
    state: contract.state,
    weight: clamp01(contract.channels?.traversal),
    contact: clamp01(contract.channels?.contact),
    impact: clamp01(contract.channels?.impact),
  });
}

export function toDebugTraversalSignal(contract = {}) {
  return freeze({
    state: contract.state,
    phase: contract.phase,
    event: contract.event,
    technique: contract.technique,
    confidence: contract.confidence,
    surfaceId: contract.surfaceId,
    obstacleId: contract.obstacleId,
    distance: contract.metrics?.distance ?? 0,
    height: contract.metrics?.height ?? 0,
  });
}

export function compareTraversalContracts(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}
