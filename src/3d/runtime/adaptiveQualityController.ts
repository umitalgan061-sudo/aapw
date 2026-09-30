// @ts-nocheck
/**
 * Adaptive quality controller for AAPW.
 *
 * Uses rolling frame telemetry and platform signals to adjust presentation quality without taking
 * ownership of renderer state. A caller reads the resulting plan and applies it to Three.js or
 * another renderer. Hysteresis prevents quality oscillation near thresholds.
 */

import {
  QUALITY_TIERS,
  clamp,
  finiteOr,
  integerOr,
  exponentialSmoothing,
  createRuntimeBudget,
} from './modernRuntimeContract.js';

const TIER_INDEX = Object.freeze(Object.fromEntries(QUALITY_TIERS.map((tier, index) => [tier, index])));
const DEFAULT_ORDER = QUALITY_TIERS;

const DEFAULT_PROFILES = Object.freeze({
  minimal: Object.freeze({ pixelRatio: 0.65, shadows: 0, effects: 0.35, foliage: 0.3, animationRate: 0.75, maxActiveZones: 1, targetFps: 30 }),
  low: Object.freeze({ pixelRatio: 0.8, shadows: 0.25, effects: 0.55, foliage: 0.5, animationRate: 0.85, maxActiveZones: 2, targetFps: 40 }),
  medium: Object.freeze({ pixelRatio: 1, shadows: 0.6, effects: 0.75, foliage: 0.72, animationRate: 0.95, maxActiveZones: 4, targetFps: 55 }),
  high: Object.freeze({ pixelRatio: 1.35, shadows: 0.85, effects: 0.9, foliage: 0.9, animationRate: 1, maxActiveZones: 6, targetFps: 60 }),
  ultra: Object.freeze({ pixelRatio: 1.75, shadows: 1, effects: 1, foliage: 1, animationRate: 1, maxActiveZones: 8, targetFps: 60 }),
});

function normalizeProfile(profile) {
  return Object.freeze({
    pixelRatio: clamp(finiteOr(profile?.pixelRatio, 1), 0.5, 2),
    shadows: clamp(finiteOr(profile?.shadows, 1), 0, 1),
    effects: clamp(finiteOr(profile?.effects, 1), 0, 1),
    foliage: clamp(finiteOr(profile?.foliage, 1), 0, 1),
    animationRate: clamp(finiteOr(profile?.animationRate, 1), 0.5, 1.25),
    maxActiveZones: clamp(integerOr(profile?.maxActiveZones, 4), 0, 64),
    targetFps: clamp(finiteOr(profile?.targetFps, 60), 20, 120),
  });
}

function createProfiles(custom = {}) {
  const merged = {};
  for (const tier of DEFAULT_ORDER) merged[tier] = normalizeProfile({ ...DEFAULT_PROFILES[tier], ...(custom[tier] || {}) });
  return Object.freeze(merged);
}

function createHistory(capacity) {
  const data = new Array(Math.max(8, integerOr(capacity, 120)));
  let cursor = 0;
  let length = 0;
  return {
    push(value) {
      data[cursor] = value;
      cursor = (cursor + 1) % data.length;
      length = Math.min(length + 1, data.length);
    },
    values() {
      const start = length === data.length ? cursor : 0;
      return Array.from({ length }, (_, index) => data[(start + index) % data.length]);
    },
    get length() { return length; },
  };
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * clamp(q, 0, 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function clampTierIndex(index) {
  return clamp(integerOr(index, TIER_INDEX.medium), 0, DEFAULT_ORDER.length - 1);
}

export function chooseInitialTier({ capabilities = {}, prefersReducedMotion = false, requested = 'medium' } = {}) {
  if (requested === 'minimal' || prefersReducedMotion) return 'minimal';
  const cores = integerOr(capabilities.hardwareConcurrency, 4);
  const dpr = finiteOr(capabilities.devicePixelRatio, 1);
  if (!capabilities.webgl && !capabilities.webgpu) return 'minimal';
  if (capabilities.webgpu && cores >= 8 && dpr <= 2) return requested === 'medium' ? 'high' : requested;
  if (cores <= 2 || dpr >= 3) return 'low';
  return QUALITY_TIERS.includes(requested) ? requested : 'medium';
}

export function createAdaptiveQualityController(options = {}) {
  const profiles = createProfiles(options.profiles);
  const budget = createRuntimeBudget(options.budget);
  const history = createHistory(options.historySize || 180);
  const downThreshold = finiteOr(options.downThreshold, 0.88);
  const upThreshold = finiteOr(options.upThreshold, 1.06);
  const minimumDwellMs = Math.max(500, finiteOr(options.minimumDwellMs, 4000));
  const warmupFrames = Math.max(8, integerOr(options.warmupFrames, 30));
  const initialTier = chooseInitialTier(options);

  let tier = initialTier;
  let locked = Boolean(options.locked);
  let lastChangeMs = finiteOr(options.startTimeMs, 0);
  let smoothedFrameMs = budget.frameMs;
  let smoothedGpuMs = 0;
  let smoothedCpuMs = 0;
  let frameCount = 0;
  let pressure = 0;
  let reason = 'initial';

  function profile() { return profiles[tier]; }

  function setTier(next, timestampMs, nextReason) {
    const normalized = QUALITY_TIERS.includes(next) ? next : tier;
    if (normalized === tier) return false;
    tier = normalized;
    lastChangeMs = timestampMs;
    reason = nextReason;
    return true;
  }

  function sample(sampleInput = {}) {
    const timestampMs = Math.max(0, finiteOr(sampleInput.timestampMs, lastChangeMs));
    const deltaMs = clamp(finiteOr(sampleInput.deltaMs, budget.frameMs), 0, 250);
    const cpuMs = clamp(finiteOr(sampleInput.cpuMs, deltaMs), 0, 250);
    const gpuMs = clamp(finiteOr(sampleInput.gpuMs, 0), 0, 250);
    const visibility = sampleInput.visibility || 'visible';
    const hidden = visibility === 'hidden' || visibility === 'prerender';
    const targetFrameMs = 1000 / Math.max(20, profile().targetFps);

    history.push(deltaMs);
    frameCount += 1;
    smoothedFrameMs = exponentialSmoothing(smoothedFrameMs, deltaMs, 650, Math.max(1, deltaMs));
    smoothedCpuMs = exponentialSmoothing(smoothedCpuMs, cpuMs, 650, Math.max(1, deltaMs));
    smoothedGpuMs = exponentialSmoothing(smoothedGpuMs, gpuMs, 650, Math.max(1, deltaMs));

    const frameLoad = smoothedFrameMs / targetFrameMs;
    const cpuLoad = budget.simulationMs > 0 ? smoothedCpuMs / budget.simulationMs : 0;
    const gpuLoad = profile().pixelRatio > 0 && budget.presentationMs > 0 ? smoothedGpuMs / budget.presentationMs : 0;
    const combinedLoad = Math.max(frameLoad, cpuLoad * 0.9, gpuLoad * 0.95);
    pressure = exponentialSmoothing(pressure, combinedLoad, 500, Math.max(1, deltaMs));

    let action = 'hold';
    if (!locked && !hidden && frameCount >= warmupFrames && timestampMs - lastChangeMs >= minimumDwellMs) {
      if (pressure >= downThreshold) {
        const nextIndex = clampTierIndex(TIER_INDEX[tier] - 1);
        if (nextIndex !== TIER_INDEX[tier]) {
          setTier(DEFAULT_ORDER[nextIndex], timestampMs, `pressure:${pressure.toFixed(3)}`);
          action = 'decrease';
        }
      } else if (pressure <= 1 / upThreshold) {
        const nextIndex = clampTierIndex(TIER_INDEX[tier] + 1);
        if (nextIndex !== TIER_INDEX[tier]) {
          setTier(DEFAULT_ORDER[nextIndex], timestampMs, `recovery:${pressure.toFixed(3)}`);
          action = 'increase';
        }
      }
    }

    return Object.freeze({
      changed: action !== 'hold',
      action,
      tier,
      pressure,
      targetFrameMs,
      smoothedFrameMs,
      smoothedCpuMs,
      smoothedGpuMs,
      sampleCount: frameCount,
      reason,
      profile: profile(),
    });
  }

  function force(nextTier, timestampMs = lastChangeMs, forceReason = 'manual') {
    const changed = setTier(nextTier, timestampMs, forceReason);
    return Object.freeze({ changed, tier, reason, profile: profile() });
  }

  function setLocked(value) {
    locked = Boolean(value);
    return locked;
  }

  function getPlan(context = {}) {
    const activeZones = Math.max(0, integerOr(context.activeZones, 0));
    const distanceScale = clamp(finiteOr(context.distanceScale, 1), 0.25, 2);
    const profileValue = profile();
    return Object.freeze({
      tier,
      locked,
      reason,
      scale: profileValue.pixelRatio * distanceScale,
      pixelRatio: profileValue.pixelRatio,
      shadows: profileValue.shadows,
      effects: profileValue.effects,
      foliage: profileValue.foliage,
      animationRate: profileValue.animationRate,
      maxActiveZones: Math.min(profileValue.maxActiveZones, activeZones || profileValue.maxActiveZones),
      targetFps: profileValue.targetFps,
      visibility: context.visibility || 'visible',
    });
  }

  function diagnostics() {
    const values = history.values();
    return Object.freeze({
      tier,
      locked,
      reason,
      pressure,
      sampleCount: frameCount,
      frame: Object.freeze({ p50: quantile(values, 0.5), p90: quantile(values, 0.9), p99: quantile(values, 0.99) }),
      smoothed: Object.freeze({ frameMs: smoothedFrameMs, cpuMs: smoothedCpuMs, gpuMs: smoothedGpuMs }),
      thresholds: Object.freeze({ down: downThreshold, up: upThreshold, dwellMs: minimumDwellMs }),
    });
  }

  return Object.freeze({
    sample,
    force,
    setLocked,
    getPlan,
    diagnostics,
    get tier() { return tier; },
    get locked() { return locked; },
  });
}

export function createQualityDecisionTable() {
  return Object.freeze(QUALITY_TIERS.map((tier, index) => Object.freeze({
    tier,
    index,
    lower: DEFAULT_ORDER[index - 1] || null,
    higher: DEFAULT_ORDER[index + 1] || null,
    profile: DEFAULT_PROFILES[tier],
  })));
}

export function validateQualityProfile(profile) {
  const normalized = normalizeProfile(profile);
  const problems = [];
  if (normalized.pixelRatio <= 0) problems.push('pixelRatio must be positive');
  if (normalized.targetFps < 20) problems.push('targetFps must be at least 20');
  if (normalized.animationRate <= 0) problems.push('animationRate must be positive');
  if (normalized.maxActiveZones < 0) problems.push('maxActiveZones cannot be negative');
  return Object.freeze({ valid: problems.length === 0, problems, normalized });
}

export const DEFAULT_QUALITY_PROFILES = DEFAULT_PROFILES;
