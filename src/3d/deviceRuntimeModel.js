/**
 * Browser/device runtime model used to tune quality without assuming a UA string.
 *
 * Signals are capability based: hardware concurrency, reported memory, pointer modality, battery,
 * connection type and graphics backend. Unknown values remain unknown instead of being guessed. The
 * model only returns a normalized profile; it never changes renderer state.
 * @module deviceRuntimeModel
 */

export const DEVICE_TIERS = Object.freeze(['constrained', 'balanced', 'performance', 'enthusiast']);
function n(v, f = 0) { return Number.isFinite(Number(v)) ? Number(v) : f; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, n(v, lo))); }
function bool(value) { return value === true; }

export function readBatteryHint(navigatorObject = globalThis.navigator) {
  const battery = navigatorObject?.getBattery;
  if (typeof battery !== 'function') return Object.freeze({ available: false, saver: null, level: null, charging: null });
  return Object.freeze({ available: true, saver: null, level: null, charging: null, source: 'async-battery-api' });
}

export function deriveCpuClass(hardwareConcurrency) {
  const cores = Math.max(1, Math.round(n(hardwareConcurrency, 1)));
  if (cores >= 12) return 'enthusiast';
  if (cores >= 8) return 'performance';
  if (cores >= 4) return 'balanced';
  return 'constrained';
}

export function deriveMemoryClass(deviceMemoryGiB) {
  const memory = n(deviceMemoryGiB, 0);
  if (memory >= 12) return 'enthusiast';
  if (memory >= 8) return 'performance';
  if (memory >= 4) return 'balanced';
  if (memory > 0) return 'constrained';
  return 'balanced';
}

export function deriveGpuClass({ webgpu = false, webgl2 = false, webgl = false } = {}) {
  if (webgpu) return 'enthusiast';
  if (webgl2) return 'performance';
  if (webgl) return 'balanced';
  return 'constrained';
}

const ORDER = Object.freeze({ constrained: 0, balanced: 1, performance: 2, enthusiast: 3 });
function lowest(a, b) { return ORDER[a] <= ORDER[b] ? a : b; }

export function classifyDeviceSignals(signals = {}) {
  const cpu = deriveCpuClass(signals.hardwareConcurrency);
  const memory = deriveMemoryClass(signals.deviceMemory);
  const gpu = deriveGpuClass(signals);
  let tier = lowest(cpu, memory);
  tier = lowest(tier, gpu);
  if (bool(signals.coarsePointer)) tier = lowest(tier, 'balanced');
  if (bool(signals.saveData)) tier = lowest(tier, 'balanced');
  if (n(signals.thermalPressure, 0) >= 0.5) tier = lowest(tier, 'balanced');
  if (bool(signals.batterySaver)) tier = lowest(tier, 'balanced');
  return Object.freeze({ tier, cpuClass: cpu, memoryClass: memory, gpuClass: gpu });
}

export function buildDeviceRuntimeProfile(signals = {}) {
  const classes = classifyDeviceSignals(signals);
  const presets = {
    constrained: { renderScale: 0.62, shadowMap: 512, faunaHz: 10, maxVisibleVegetation: 180, streamStarts: 0, streamBudgetMs: 1 },
    balanced: { renderScale: 0.78, shadowMap: 1024, faunaHz: 20, maxVisibleVegetation: 420, streamStarts: 1, streamBudgetMs: 2 },
    performance: { renderScale: 0.9, shadowMap: 2048, faunaHz: 30, maxVisibleVegetation: 800, streamStarts: 2, streamBudgetMs: 3 },
    enthusiast: { renderScale: 1, shadowMap: 4096, faunaHz: 45, maxVisibleVegetation: 1400, streamStarts: 3, streamBudgetMs: 4 },
  };
  const base = presets[classes.tier];
  const thermalFactor = 1 - Math.min(0.45, Math.max(0, n(signals.thermalPressure, 0)) * 0.45);
  const batteryFactor = bool(signals.batterySaver) ? 0.8 : 1;
  const mobileFactor = bool(signals.coarsePointer) ? 0.82 : 1;
  return Object.freeze({
    ...classes,
    renderScale: Number((base.renderScale * thermalFactor * batteryFactor * mobileFactor).toFixed(3)),
    shadowMap: Math.max(256, Math.round(base.shadowMap * thermalFactor)),
    faunaHz: Math.max(5, Math.round(base.faunaHz * thermalFactor * batteryFactor)),
    maxVisibleVegetation: Math.max(80, Math.round(base.maxVisibleVegetation * mobileFactor * batteryFactor)),
    streamStarts: Math.max(0, Math.round(base.streamStarts * batteryFactor)),
    streamBudgetMs: Number((base.streamBudgetMs * thermalFactor * batteryFactor).toFixed(3)),
  });
}

export function createDeviceRuntimeProbe({ navigatorObject = globalThis.navigator, windowObject = globalThis.window } = {}) {
  let last = null;
  return {
    sample(extra = {}) {
      const profile = buildDeviceRuntimeProfile({
        hardwareConcurrency: navigatorObject?.hardwareConcurrency,
        deviceMemory: navigatorObject?.deviceMemory,
        coarsePointer: Boolean(windowObject?.matchMedia?.('(pointer: coarse)')?.matches),
        saveData: Boolean(navigatorObject?.connection?.saveData),
        effectiveType: navigatorObject?.connection?.effectiveType ?? null,
        ...extra,
      });
      last = profile;
      return profile;
    },
    last() { return last; },
    reset() { last = null; },
  };
}

export function validateDeviceProfile(profile) {
  return Boolean(profile && DEVICE_TIERS.includes(profile.tier) && profile.renderScale > 0 && profile.shadowMap >= 256 && profile.faunaHz >= 5);
}
