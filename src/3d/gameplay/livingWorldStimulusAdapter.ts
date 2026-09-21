// @ts-nocheck
/**
 * Integration seam between the new stimulus orchestrator and existing living-world owners.
 *
 * The adapter intentionally speaks in semantic packets. It never calls navigation, combat, actor
 * mutation or renderer APIs. Existing owners may subscribe to the returned packet and decide whether
 * and how to apply it.
 */

import { createLivingWorldStimulusOrchestrator } from './livingWorldStimulusOrchestrator.js';
import { createLivingWorldStimulusTelemetry } from './livingWorldStimulusTelemetry.js';
import { livingWorldStimulusDigest, auditLivingWorldStimulusFrame } from './livingWorldStimulusAudit.js';

const freeze = Object.freeze;

export const LIVING_WORLD_STIMULUS_ADAPTER_POLICY = freeze({
  id: 'living-world-stimulus-adapter-2026-09-v1',
  maxConsumers: 16,
  maxSignals: 64,
});

export function createLivingWorldStimulusAdapter(options = {}) {
  const orchestrator = options.orchestrator || createLivingWorldStimulusOrchestrator(options);
  const telemetry = options.telemetry || createLivingWorldStimulusTelemetry(options.telemetryOptions);
  const consumers = new Map();
  let disposed = false;

  function subscribe(name, callback) {
    if (disposed || typeof callback !== 'function' || consumers.size >= LIVING_WORLD_STIMULUS_ADAPTER_POLICY.maxConsumers) return () => {};
    const key = String(name || `consumer-${consumers.size}`).slice(0, 64);
    consumers.set(key, callback);
    return () => consumers.delete(key);
  }

  function dispatch(frame) {
    for (const callback of consumers.values()) {
      try { callback(frame); } catch (error) { telemetry.count('consumer.errors'); telemetry.event('consumer.error', { message: error?.message || 'unknown' }, frame?.nowSeconds); }
    }
    return frame;
  }

  function tick(input = {}) {
    if (disposed) return freeze({ disposed: true, decisions: [] });
    const signals = Array.isArray(input.signals) ? input.signals.slice(0, LIVING_WORLD_STIMULUS_ADAPTER_POLICY.maxSignals) : [];
    const frame = orchestrator.tickOnce({ ...input, signals });
    telemetry.recordTick(frame);
    const audit = auditLivingWorldStimulusFrame(frame, { maxPlansPerTick: options.policy?.maxPlansPerTick });
    if (!audit.valid) telemetry.count('audit.failures', audit.failures.length);
    const packet = freeze({ ...frame, digest: livingWorldStimulusDigest(frame), audit });
    return dispatch(packet);
  }

  function snapshot(nowSeconds) {
    return freeze({ policy: LIVING_WORLD_STIMULUS_ADAPTER_POLICY, orchestrator: orchestrator.snapshot(nowSeconds), telemetry: telemetry.snapshot(), consumers: consumers.size, disposed });
  }

  function reset() {
    if (disposed) return;
    orchestrator.reset();
    telemetry.reset();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    consumers.clear();
    orchestrator.dispose();
    telemetry.dispose();
  }

  return freeze({ subscribe, tick, snapshot, reset, dispose, orchestrator, telemetry, get disposed() { return disposed; } });
}
