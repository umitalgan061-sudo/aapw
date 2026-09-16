/**
 * Batch coordinator for large living-world stimulus streams.
 *
 * Accepts micro-batches from multiple existing producers and seals them into deterministic frames.
 * The coordinator does not own the producer lifecycle, world clock, actor state or transport.
 */

import { normalizeLivingWorldStimulusBatch } from './livingWorldStimulusNormalizer.js';
import { compareStimulusStableOrder } from './livingWorldStimulusNormalizer.js';

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const integer = (v, f = 0) => Math.max(0, Math.floor(finite(v, f)));

export const LIVING_WORLD_STIMULUS_BATCH_POLICY = freeze({
  id: 'living-world-stimulus-batch-2026-09-v1',
  maxPending: 512,
  maxSources: 32,
  maxSignalsPerFrame: 96,
  maxFrameAgeSeconds: 0.25,
});

export function createLivingWorldStimulusBatchCoordinator(options = {}) {
  const policy = freeze({ ...LIVING_WORLD_STIMULUS_BATCH_POLICY, ...(options.policy || {}) });
  const pending = new Map();
  let sequence = 0;
  let disposed = false;
  let rejected = 0;

  function push(source, signals, receivedAtSeconds = 0) {
    if (disposed) return false;
    const key = String(source || 'unknown').slice(0, 64);
    if (!pending.has(key) && pending.size >= policy.maxSources) {
      rejected += Array.isArray(signals) ? signals.length : 1;
      return false;
    }
    const existing = pending.get(key) || [];
    for (const signal of Array.isArray(signals) ? signals : [signals]) {
      if (existing.length >= policy.maxPending) {
        rejected += 1;
        break;
      }
      existing.push({ ...signal, metadata: { ...(signal?.metadata || {}), source: key }, receivedAtSeconds: Math.max(0, finite(receivedAtSeconds)) });
    }
    pending.set(key, existing.slice(-policy.maxPending));
    return true;
  }

  function seal(nowSeconds = 0) {
    if (disposed) return freeze({ disposed: true, sequence, signals: [] });
    const all = [];
    for (const [source, list] of pending) {
      for (const signal of list) {
        const age = Math.max(0, finite(nowSeconds) - finite(signal.receivedAtSeconds));
        if (age > policy.maxFrameAgeSeconds && !signal.metadata?.persistent) continue;
        all.push({ ...signal, sequence: sequence++ });
      }
      pending.delete(source);
    }
    const normalized = normalizeLivingWorldStimulusBatch(all)
      .sort(compareStimulusStableOrder)
      .slice(0, policy.maxSignalsPerFrame);
    return freeze({ disposed: false, sequence, rejected, signals: freeze(normalized), sourceCount: pending.size });
  }

  function inspect() {
    const pendingSignals = [...pending.values()].reduce((sum, list) => sum + list.length, 0);
    return freeze({ disposed, sequence, rejected, sourceCount: pending.size, pendingSignals });
  }

  function reset() { pending.clear(); rejected = 0; sequence = 0; }
  function dispose() { if (disposed) return; disposed = true; pending.clear(); }

  return freeze({ push, seal, inspect, reset, dispose, get disposed() { return disposed; } });
}
