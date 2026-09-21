// @ts-nocheck
/**
 * Composition facade for the modern AAPW runtime layer.
 *
 * This is intentionally an adapter, not a replacement for gameplay owners. It composes platform
 * probing, fixed-step scheduling, adaptive quality, semantic input, telemetry, health monitoring
 * and persistence behind one lifecycle surface. The caller remains responsible for scene, physics,
 * player, combat, renderer and application state.
 */

import { createDeterministicRuntimeScheduler } from './deterministicRuntimeScheduler.js';
import { createAdaptiveQualityController } from './adaptiveQualityController.js';
import { createInputCommandBuffer } from './inputCommandBuffer.js';
import { createRuntimeTelemetryHub } from './runtimeTelemetryHub.js';
import { createRuntimeHealthMonitor } from './runtimeHealthMonitor.js';
import { createVersionedPersistenceLedger, createLocalStorageAdapter } from './versionedPersistenceLedger.js';
import { probePlatformCapabilities, classifyPlatformProfile, capabilityWarnings } from './platformCapabilityProbe.js';
import { clamp, finiteOr, integerOr, createRuntimeSnapshot, createRuntimeId, createDisposer, resolveLogger } from './modernRuntimeContract.js';

function defaultNow() {
  return Number(globalThis?.performance?.now?.() || Date.now());
}

function defaultFrame(callback) {
  if (typeof globalThis?.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(() => callback(defaultNow()), 16);
}

function defaultCancel(handle) {
  if (typeof globalThis?.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

export async function createModernRuntime(options = {}) {
  const logger = resolveLogger(options.logger);
  const sessionId = String(options.sessionId || createRuntimeId('session'));
  const capabilities = options.capabilities || await probePlatformCapabilities(options.platform || {});
  const platformProfile = classifyPlatformProfile(capabilities);
  const warnings = capabilityWarnings(capabilities);
  const storage = options.storageAdapter || createLocalStorageAdapter(options.storage);
  const telemetry = createRuntimeTelemetryHub({ sessionId, logger, historySize: options.telemetryHistorySize || 512 });
  const scheduler = createDeterministicRuntimeScheduler(options.scheduler);
  const quality = createAdaptiveQualityController({
    ...(options.quality || {}),
    capabilities: capabilities.capabilities,
    prefersReducedMotion: capabilities.capabilities.prefersReducedMotion,
    locked: options.quality?.locked,
  });
  const input = createInputCommandBuffer(options.input);
  const health = createRuntimeHealthMonitor(options.health);
  const persistence = createVersionedPersistenceLedger({
    adapter: storage,
    schemaVersion: integerOr(options.saveSchemaVersion, 1),
    slotA: options.slotA,
    slotB: options.slotB,
  });
  const disposer = createDisposer();

  let phase = 'bootstrap';
  let visibility = 'visible';
  let running = false;
  let frameHandle = null;
  let previousNow = null;
  let lastSnapshot = null;
  let frameIndex = 0;
  let appHooks = {};

  function setPhase(nextPhase) {
    phase = String(nextPhase || 'bootstrap');
    telemetry.event(`runtime.${phase}`, { sessionId }, defaultNow());
    return phase;
  }

  function attachHooks(hooks = {}) {
    appHooks = { ...appHooks, ...hooks };
    return Object.freeze({ ...appHooks });
  }

  function ingestInput(command) {
    return input.push(command);
  }

  function sampleQuality(deltaMs, timestampMs) {
    const result = quality.sample({ deltaMs, timestampMs, visibility });
    if (result.changed) {
      telemetry.quality(result, timestampMs);
      appHooks.onQualityChanged?.(result);
    }
    return result;
  }

  function runFrame(nowMs) {
    if (!running) return;
    const now = Math.max(0, finiteOr(nowMs, defaultNow()));
    const rawDelta = previousNow == null ? 16.67 : now - previousNow;
    previousNow = now;
    const deltaMs = clamp(rawDelta, 0, 250);
    frameIndex += 1;

    let framePlan = null;
    framePlan = scheduler.frame(deltaMs, {
      simulate(context) {
        input.setTick(context.tick);
        const commands = input.drainUntil(context.tick);
        appHooks.simulate?.(context, commands);
      },
      onSpiralGuard(context) {
        telemetry.event('scheduler.spiral-guard', context, now);
        appHooks.onSchedulerGuard?.(context);
      },
      present(context) {
        const healthSample = health.sample({
          deltaMs,
          simulationMs: finiteOr(appHooks.lastSimulationMs, 0),
          presentationMs: finiteOr(appHooks.lastPresentationMs, 0),
          timestampMs: now,
          dropped: Boolean(framePlan?.spiralGuard),
        });
        const qualitySample = sampleQuality(deltaMs, now);
        const qualityPlan = quality.getPlan({ activeZones: appHooks.activeZones?.() || 0, visibility });
        const snapshot = createRuntimeSnapshot({
          sessionId,
          phase: visibility === 'visible' ? 'present' : 'throttle',
          visibility,
          timestampMs: now,
          frame: {
            deltaMs,
            fps: deltaMs > 0 ? 1000 / deltaMs : 0,
            cpuMs: finiteOr(appHooks.lastSimulationMs, 0),
            gpuMs: finiteOr(appHooks.lastPresentationMs, 0),
            dropped: Boolean(framePlan?.spiralGuard),
          },
          world: {
            tick: context.tick,
            entityCount: appHooks.entityCount?.() || 0,
            activeZones: appHooks.activeZones?.() || 0,
          },
          quality: { tier: qualityPlan.tier, scale: qualityPlan.scale, locked: quality.locked },
          flags: { platformProfile, frameIndex },
        });
        lastSnapshot = snapshot;
        telemetry.frame({
          timestampMs: now,
          deltaMs,
          fps: deltaMs > 0 ? 1000 / deltaMs : 0,
          cpuMs: finiteOr(appHooks.lastSimulationMs, 0),
          gpuMs: finiteOr(appHooks.lastPresentationMs, 0),
          dropped: Boolean(framePlan?.spiralGuard),
        });
        appHooks.present?.(context, snapshot, qualityPlan, healthSample, qualitySample);
      },
    });

    appHooks.frame?.(framePlan, lastSnapshot);
    frameHandle = defaultFrame(runFrame);
  }

  async function start() {
    if (running) return lastSnapshot;
    running = true;
    setPhase('bootstrap');
    setPhase(visibility === 'visible' ? 'resume' : 'throttle');
    previousNow = defaultNow();
    telemetry.event('runtime.start', { platformProfile, warnings }, previousNow);
    appHooks.onStart?.({ sessionId, capabilities, platformProfile, warnings });
    frameHandle = defaultFrame(runFrame);
    return lastSnapshot;
  }

  async function stop() {
    if (!running) return;
    running = false;
    if (frameHandle != null) defaultCancel(frameHandle);
    frameHandle = null;
    setPhase('shutdown');
    telemetry.event('runtime.stop', { frameIndex }, defaultNow());
    appHooks.onStop?.();
  }

  function pause(reason = 'manual') {
    scheduler.pause();
    health.setVisibility(reason === 'hidden' ? 'hidden' : visibility);
    setPhase('suspend');
    telemetry.event('runtime.pause', { reason }, defaultNow());
    appHooks.onPause?.(reason);
  }

  function resume(reason = 'manual') {
    scheduler.resume();
    previousNow = defaultNow();
    health.setVisibility('visible');
    setPhase('resume');
    telemetry.event('runtime.resume', { reason }, previousNow);
    appHooks.onResume?.(reason);
  }

  function setVisibility(next) {
    visibility = ['visible', 'hidden', 'prerender', 'unknown'].includes(next) ? next : 'unknown';
    health.setVisibility(visibility);
    if (visibility === 'visible') resume('visibility');
    else pause(visibility);
    return visibility;
  }

  async function save(payload, metadata = {}) {
    const result = await persistence.save(payload, {
      ...metadata,
      tick: metadata.tick ?? scheduler.tick,
      timestampMs: metadata.timestampMs ?? defaultNow(),
    });
    telemetry.event('runtime.save', { revision: result.revision, checksum: result.checksum }, defaultNow());
    appHooks.onSave?.(result);
    return result;
  }

  async function load() {
    try {
      const result = await persistence.load();
      telemetry.event('runtime.load', { found: result.found, migrated: result.migrated, revision: result.revision }, defaultNow());
      appHooks.onLoad?.(result);
      return result;
    } catch (error) {
      telemetry.error(error, { operation: 'load' }, defaultNow());
      appHooks.onPersistenceError?.(error);
      throw error;
    }
  }

  function diagnostics() {
    return Object.freeze({
      sessionId,
      phase,
      running,
      visibility,
      platformProfile,
      capabilities,
      warnings,
      scheduler: scheduler.snapshot(),
      quality: quality.diagnostics(),
      health: health.summary(),
      telemetry: telemetry.snapshot(),
      persistence,
      input: input.snapshot(),
      lastSnapshot,
    });
  }

  function exposeLifecycleEvents(target = globalThis?.document) {
    if (!target?.addEventListener) return () => {};
    const onVisibility = () => setVisibility(target.visibilityState || 'unknown');
    const onPageHide = () => pause('pagehide');
    const onPageShow = () => resume('pageshow');
    target.addEventListener('visibilitychange', onVisibility, { passive: true });
    globalThis?.addEventListener?.('pagehide', onPageHide, { passive: true });
    globalThis?.addEventListener?.('pageshow', onPageShow, { passive: true });
    const remove = () => {
      target.removeEventListener('visibilitychange', onVisibility);
      globalThis?.removeEventListener?.('pagehide', onPageHide);
      globalThis?.removeEventListener?.('pageshow', onPageShow);
    };
    disposer.add(remove);
    return remove;
  }

  function shutdown() {
    void stop();
    try { disposer.dispose(); } catch (error) { telemetry.error(error, { operation: 'shutdown' }); }
    appHooks = {};
    input.clear();
  }

  return Object.freeze({
    sessionId,
    capabilities,
    platformProfile,
    warnings,
    scheduler,
    quality,
    input,
    health,
    telemetry,
    persistence,
    start,
    stop,
    pause,
    resume,
    setVisibility,
    attachHooks,
    ingestInput,
    save,
    load,
    diagnostics,
    exposeLifecycleEvents,
    shutdown,
    get phase() { return phase; },
    get running() { return running; },
    get snapshot() { return lastSnapshot; },
  });
}

export function bindBrowserLifecycle(runtime, target = globalThis?.document) {
  if (!runtime?.setVisibility || !target?.addEventListener) return () => {};
  const onVisibility = () => runtime.setVisibility(target.visibilityState || 'unknown');
  const onPageHide = () => runtime.pause('pagehide');
  const onPageShow = () => runtime.resume('pageshow');
  target.addEventListener('visibilitychange', onVisibility, { passive: true });
  globalThis?.addEventListener?.('pagehide', onPageHide, { passive: true });
  globalThis?.addEventListener?.('pageshow', onPageShow, { passive: true });
  return () => {
    target.removeEventListener('visibilitychange', onVisibility);
    globalThis?.removeEventListener?.('pagehide', onPageHide);
    globalThis?.removeEventListener?.('pageshow', onPageShow);
  };
}

export function createRuntimeAcceptanceReport(runtime) {
  const diagnostics = runtime?.diagnostics?.() || {};
  const checks = [
    ['session-id', Boolean(diagnostics.sessionId)],
    ['platform-profile', Boolean(diagnostics.platformProfile)],
    ['scheduler', diagnostics.scheduler?.fixedStepMs > 0],
    ['quality', Boolean(diagnostics.quality?.tier)],
    ['health', Boolean(diagnostics.health?.health)],
    ['telemetry', diagnostics.telemetry?.eventCount >= 0],
    ['input-buffer', diagnostics.input?.capacity > 0],
  ];
  const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
  return Object.freeze({ valid: failures.length === 0, checks: Object.freeze(checks), failures: Object.freeze(failures) });
}
