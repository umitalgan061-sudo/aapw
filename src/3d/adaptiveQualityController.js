/**
 * Runtime quality controller tying frame pressure to named, reversible quality controls.
 *
 * Each level is a declarative profile. The controller only emits patches; renderer, terrain, fauna and
 * UI systems decide how to apply the patch. This makes quality decisions inspectable and avoids hidden
 * cross-system mutations during a degraded frame.
 * @module adaptiveQualityController
 */

import { FRAME_GOVERNOR_DEFAULTS, createFrameGovernor } from './runtimeFrameGovernor.js';

export const QUALITY_LEVELS = Object.freeze([
  Object.freeze({ level: 0, name: 'ultra', renderScale: 1, shadowScale: 1, faunaHz: 60, chunkStarts: 2, vegetationScale: 1, fxScale: 1 }),
  Object.freeze({ level: 1, name: 'high', renderScale: 0.92, shadowScale: 0.75, faunaHz: 45, chunkStarts: 2, vegetationScale: 0.9, fxScale: 0.9 }),
  Object.freeze({ level: 2, name: 'balanced', renderScale: 0.84, shadowScale: 0.56, faunaHz: 30, chunkStarts: 1, vegetationScale: 0.78, fxScale: 0.72 }),
  Object.freeze({ level: 3, name: 'performance', renderScale: 0.76, shadowScale: 0.4, faunaHz: 20, chunkStarts: 1, vegetationScale: 0.62, fxScale: 0.56 }),
  Object.freeze({ level: 4, name: 'battery', renderScale: 0.68, shadowScale: 0.25, faunaHz: 15, chunkStarts: 1, vegetationScale: 0.48, fxScale: 0.4 }),
  Object.freeze({ level: 5, name: 'survival', renderScale: 0.6, shadowScale: 0.16, faunaHz: 10, chunkStarts: 0, vegetationScale: 0.34, fxScale: 0.25 }),
]);

const ACTIONS = Object.freeze({ DOWN: 'downgrade', UP: 'upgrade', HOLD: 'hold' });

function levelByIndex(index) { return QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, Math.max(0, Math.trunc(index)))]; }
function numeric(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

export function diffQualityProfile(previous, next) {
  const changes = {};
  if (!previous || !next) return { ...next };
  for (const key of Object.keys(next)) {
    if (previous[key] !== next[key]) changes[key] = next[key];
  }
  return changes;
}

export function createAdaptiveQualityController({ governorOptions = {}, initialLevel = 0, onProfile = null } = {}) {
  const governor = createFrameGovernor({ ...FRAME_GOVERNOR_DEFAULTS, ...governorOptions, minLevel: 0, maxLevel: QUALITY_LEVELS.length - 1 });
  let current = levelByIndex(initialLevel);
  let transitionCount = 0;
  let disposed = false;
  const transitions = [];

  function emit(next, evaluation, action) {
    const patch = diffQualityProfile(current, next);
    const event = Object.freeze({
      action,
      from: current,
      to: next,
      patch: Object.freeze({ ...patch }),
      evaluation,
      transition: ++transitionCount,
    });
    current = next;
    transitions.push(event);
    while (transitions.length > 24) transitions.shift();
    if (typeof onProfile === 'function') onProfile(event);
    return event;
  }

  return {
    sample(frameMs, metadata = {}) {
      if (disposed) throw new Error('QUALITY_CONTROLLER_DISPOSED');
      const evaluation = governor.evaluate(frameMs, metadata);
      const next = levelByIndex(evaluation.level);
      if (next.level > current.level) return emit(next, evaluation, ACTIONS.DOWN);
      if (next.level < current.level) return emit(next, evaluation, ACTIONS.UP);
      return Object.freeze({ action: ACTIONS.HOLD, from: current, to: current, patch: Object.freeze({}), evaluation, transition: transitionCount });
    },
    profile() { return current; },
    governorSnapshot() { return governor.snapshot(); },
    history() { return transitions.map((event) => event); },
    createFrameBudget(estimatedRendererMs = 0) { return governor.createBudgetLedger(estimatedRendererMs); },
    reset(level = 0) {
      governor.reset();
      current = levelByIndex(level);
      transitions.length = 0;
      transitionCount = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      governor.dispose();
      transitions.length = 0;
    },
  };
}

export function classifyFramePressure({ frameMs, cpuMs = 0, gpuMs = 0, assetMs = 0, streamingMs = 0 } = {}) {
  const frame = Math.max(0, numeric(frameMs));
  const cpu = Math.max(0, numeric(cpuMs));
  const gpu = Math.max(0, numeric(gpuMs));
  const asset = Math.max(0, numeric(assetMs));
  const streaming = Math.max(0, numeric(streamingMs));
  const totalKnown = cpu + gpu + asset + streaming;
  const remainder = Math.max(0, frame - totalKnown);
  const dominant = Math.max(cpu, gpu, asset, streaming, remainder);
  const cause = dominant === gpu ? 'gpu' : dominant === cpu ? 'cpu' : dominant === asset ? 'asset' : dominant === streaming ? 'streaming' : 'other';
  return Object.freeze({ frameMs: frame, cpuMs: cpu, gpuMs: gpu, assetMs: asset, streamingMs: streaming, unaccountedMs: remainder, dominant: cause });
}

export function buildQualityBudgetPatch(profile, capabilities = {}) {
  const battery = capabilities.batterySaver === true;
  const thermal = numeric(capabilities.thermalPressure, 0);
  const thermalFactor = Math.max(0.5, 1 - Math.min(0.5, thermal));
  const batteryFactor = battery ? 0.78 : 1;
  return Object.freeze({
    renderScale: Number((profile.renderScale * thermalFactor * batteryFactor).toFixed(3)),
    faunaHz: Math.max(5, Math.round(profile.faunaHz * thermalFactor * batteryFactor)),
    chunkStarts: battery || thermal > 0.35 ? Math.max(0, profile.chunkStarts - 1) : profile.chunkStarts,
    vegetationScale: Number((profile.vegetationScale * thermalFactor).toFixed(3)),
    fxScale: Number((profile.fxScale * thermalFactor).toFixed(3)),
    reason: battery ? 'battery' : thermal > 0.35 ? 'thermal' : 'normal',
  });
}

export { ACTIONS };
