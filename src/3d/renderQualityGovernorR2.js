/**
 * Capability-aware adaptive render quality governor.
 * Pure policy layer: it never creates a renderer, mutates Three.js state, or owns scene/assets.
 * The caller supplies telemetry and applies the returned bounded profile.
 */
const freeze = Object.freeze;
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, finite(v, lo)));
const integer = (v, fallback = 0) => Math.max(0, Math.floor(finite(v, fallback)));
const text = (v, fallback = '') => String(v ?? fallback).trim() || fallback;
const round = (v, p = 4) => { const m = 10 ** p; return Math.round(finite(v) * m) / m; };

export const RENDER_QUALITY_LEVELS = freeze(['ultra', 'high', 'balanced', 'performance', 'compatibility']);
export const RENDER_QUALITY_BACKENDS = freeze(['webgpu', 'webgl2', 'webgl', 'none']);
export const RENDER_QUALITY_POLICY = freeze({ id: 'render-quality-governor-r2-2026-09-16', targetFrameMs: 16.67, softFrameMs: 20, hardFrameMs: 28, recoveryFrameMs: 14.5, stepDownHoldFrames: 8, stepUpHoldFrames: 45, maxHistory: 120, minPixelRatio: 0.7, maxPixelRatio: 2, thermalCritical: 0.92, thermalHot: 0.78, batteryLow: 0.18, batteryCritical: 0.08, hiddenCooldownFrames: 12 });
const tierRank = freeze(Object.fromEntries(RENDER_QUALITY_LEVELS.map((v, i) => [v, i])));
const backendRank = freeze(Object.fromEntries(RENDER_QUALITY_BACKENDS.map((v, i) => [v, i])));
const tierConfig = freeze({ ultra: freeze({ pixelRatio: 1, shadows: 4096, foliage: 1, water: 96, postFx: 1, temporal: 1, animation: 1 }), high: freeze({ pixelRatio: 0.92, shadows: 2048, foliage: 0.84, water: 72, postFx: 1, temporal: 1, animation: 1 }), balanced: freeze({ pixelRatio: 0.82, shadows: 1024, foliage: 0.68, water: 48, postFx: 0.65, temporal: 1, animation: 0.9 }), performance: freeze({ pixelRatio: 0.72, shadows: 512, foliage: 0.5, water: 32, postFx: 0, temporal: 0, animation: 0.78 }), compatibility: freeze({ pixelRatio: 0.7, shadows: 256, foliage: 0.32, water: 20, postFx: 0, temporal: 0, animation: 0.62 }) });

export function normalizeRenderTelemetry(raw = {}) {
  return freeze({ frameMs: Math.max(0, finite(raw.frameMs, RENDER_QUALITY_POLICY.targetFrameMs)), gpuMs: Math.max(0, finite(raw.gpuMs, 0)), cpuMs: Math.max(0, finite(raw.cpuMs, 0)), drawCalls: integer(raw.drawCalls, 0), triangles: integer(raw.triangles, 0), memoryPressure: clamp(raw.memoryPressure), thermalPressure: clamp(raw.thermalPressure), batteryLevel: clamp(raw.batteryLevel, 0, 1), batteryCharging: Boolean(raw.batteryCharging), hidden: Boolean(raw.hidden), visible: raw.visible !== false, inputActive: Boolean(raw.inputActive), qualityBias: clamp(raw.qualityBias, -1, 1), timestamp: Math.max(0, finite(raw.timestamp, 0)) });
}

export function normalizeRenderGovernorContext(raw = {}) {
  const backend = text(raw.backend, 'webgl2').toLowerCase();
  const level = text(raw.level, 'balanced').toLowerCase();
  const userCeiling = text(raw.userCeiling, 'ultra').toLowerCase();
  return freeze({ backend: backendRank[backend] == null ? 'webgl2' : backend, level: tierRank[level] == null ? 'balanced' : level, frameIndex: integer(raw.frameIndex, 0), seed: text(raw.seed, 'render-quality'), userCeiling: tierRank[userCeiling] == null ? 'ultra' : userCeiling, thermalLocked: Boolean(raw.thermalLocked), batteryLocked: Boolean(raw.batteryLocked) });
}

export function computeRenderPressure(telemetry) {
  const frame = clamp((telemetry.frameMs - 12) / 18);
  const gpu = clamp(telemetry.gpuMs / RENDER_QUALITY_POLICY.hardFrameMs);
  const cpu = clamp(telemetry.cpuMs / RENDER_QUALITY_POLICY.hardFrameMs);
  const batteryPenalty = telemetry.batteryCharging ? 0 : clamp((0.35 - telemetry.batteryLevel) / 0.35);
  return round(frame * 0.34 + gpu * 0.2 + cpu * 0.16 + telemetry.memoryPressure * 0.12 + telemetry.thermalPressure * 0.12 + batteryPenalty * 0.06);
}

export function selectQualityTarget(context, telemetry) {
  const pressure = computeRenderPressure(telemetry);
  const current = tierRank[context.level];
  const ceiling = tierRank[context.userCeiling];
  let target = current;
  if (context.thermalLocked || context.batteryLocked || telemetry.thermalPressure >= RENDER_QUALITY_POLICY.thermalCritical || telemetry.batteryLevel <= RENDER_QUALITY_POLICY.batteryCritical) target = Math.min(tierRank.compatibility, current + 2);
  else if (pressure >= 0.82 || telemetry.frameMs >= RENDER_QUALITY_POLICY.hardFrameMs) target = Math.min(tierRank.compatibility, current + 1);
  else if (pressure <= 0.3 && telemetry.frameMs <= RENDER_QUALITY_POLICY.recoveryFrameMs && telemetry.thermalPressure < RENDER_QUALITY_POLICY.thermalHot) target = Math.max(0, current - 1);
  target = Math.min(Math.max(0, ceiling), target);
  return RENDER_QUALITY_LEVELS[target];
}

export function updateQualityState(state, telemetry, context) {
  const safe = state && typeof state === 'object' ? state : {};
  const currentLevel = text(safe.level, context.level);
  const target = selectQualityTarget({ ...context, level: currentLevel }, telemetry);
  const targetRank = tierRank[target]; const currentRank = tierRank[currentLevel] ?? tierRank.balanced;
  const overloaded = targetRank > currentRank; const recovering = targetRank < currentRank;
  const downStreak = overloaded ? integer(safe.stepDownStreak) + 1 : 0;
  const upStreak = recovering ? integer(safe.stepUpStreak) + 1 : 0;
  let nextLevel = currentLevel;
  if (overloaded && downStreak >= RENDER_QUALITY_POLICY.stepDownHoldFrames) nextLevel = target;
  if (recovering && upStreak >= RENDER_QUALITY_POLICY.stepUpHoldFrames) nextLevel = target;
  if (telemetry.hidden && !telemetry.inputActive) nextLevel = 'compatibility';
  return freeze({ level: nextLevel, target, stepDownStreak: downStreak, stepUpStreak: nextLevel === currentLevel ? upStreak : 0, framesInLevel: integer(safe.framesInLevel) + 1, pressure: computeRenderPressure(telemetry) });
}

export function buildQualityProfile(context, telemetry, state) {
  const safeLevel = tierRank[state?.level] == null ? context.level : state.level;
  const cfg = tierConfig[safeLevel] ?? tierConfig.balanced;
  const mobileScale = telemetry.inputActive && telemetry.batteryLevel < RENDER_QUALITY_POLICY.batteryLow ? 0.92 : 1;
  const thermalScale = telemetry.thermalPressure >= RENDER_QUALITY_POLICY.thermalHot ? 0.86 : 1;
  const pressureScale = telemetry.frameMs >= RENDER_QUALITY_POLICY.softFrameMs ? 0.9 : 1;
  const backendScale = context.backend === 'webgpu' ? 1 : context.backend === 'webgl2' ? 0.96 : 0.86;
  const scale = mobileScale * thermalScale * pressureScale * backendScale;
  const ratio = Math.max(RENDER_QUALITY_POLICY.minPixelRatio, round(Math.min(RENDER_QUALITY_POLICY.maxPixelRatio, cfg.pixelRatio * scale), 3));
  return freeze({ level: safeLevel, backend: context.backend, pixelRatio: ratio, shadows: Math.max(128, Math.round(cfg.shadows * scale)), foliageMultiplier: round(clamp(cfg.foliage * scale, 0.15, 1), 3), waterSegments: Math.max(12, Math.round(cfg.water * scale)), postFxQuality: round(clamp(cfg.postFx * scale), 3), temporalHistory: Boolean(cfg.temporal && context.backend === 'webgpu' && telemetry.memoryPressure < 0.86), animationRate: round(clamp(cfg.animation * (telemetry.frameMs > RENDER_QUALITY_POLICY.softFrameMs ? 0.9 : 1), 0.5, 1), 3), reducedMotion: Boolean(telemetry.hidden || telemetry.thermalPressure >= RENDER_QUALITY_POLICY.thermalCritical) });
}

export function pushTelemetry(history, rawTelemetry, maxHistory = RENDER_QUALITY_POLICY.maxHistory) {
  const next = Array.isArray(history) ? history.slice() : []; next.push(normalizeRenderTelemetry(rawTelemetry));
  const limit = Math.min(RENDER_QUALITY_POLICY.maxHistory, Math.max(1, integer(maxHistory, RENDER_QUALITY_POLICY.maxHistory)));
  return freeze(next.slice(-limit));
}

export function summarizeRenderTelemetry(history = []) {
  const safe = Array.isArray(history) ? history : [];
  if (!safe.length) return freeze({ samples: 0, avgFrameMs: 0, p95FrameMs: 0, avgGpuMs: 0, avgCpuMs: 0, peakThermal: 0, peakMemory: 0 });
  const frames = safe.map((s) => finite(s.frameMs)).sort((a, b) => a - b); const average = (key) => safe.reduce((sum, s) => sum + finite(s[key]), 0) / safe.length;
  const p95 = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))];
  return freeze({ samples: safe.length, avgFrameMs: round(average('frameMs')), p95FrameMs: round(p95), avgGpuMs: round(average('gpuMs')), avgCpuMs: round(average('cpuMs')), peakThermal: round(Math.max(...safe.map((s) => finite(s.thermalPressure)))), peakMemory: round(Math.max(...safe.map((s) => finite(s.memoryPressure)))) });
}

export function createRenderQualityGovernor(options = {}) {
  let disposed = false; let state = { level: text(options.level, 'balanced'), stepDownStreak: 0, stepUpStreak: 0, framesInLevel: 0 }; let history = [];
  const evaluate = (rawTelemetry = {}, rawContext = {}) => {
    if (disposed) return freeze({ disposed: true, state: freeze(state), profile: freeze({ level: 'compatibility', backend: 'none', pixelRatio: 0.7, shadows: 128, foliageMultiplier: 0.15, waterSegments: 12, postFxQuality: 0, temporalHistory: false, animationRate: 0.5, reducedMotion: true }) });
    const telemetry = normalizeRenderTelemetry(rawTelemetry); const context = normalizeRenderGovernorContext({ ...rawContext, level: state.level });
    state = updateQualityState(state, telemetry, context); history = pushTelemetry(history, telemetry);
    return freeze({ disposed: false, state, telemetry, profile: buildQualityProfile(context, telemetry, state), summary: summarizeRenderTelemetry(history) });
  };
  const snapshot = () => freeze({ disposed, state: freeze({ ...state }), history: freeze(history.slice()) });
  const reset = (level = options.level) => { state = { level: text(level, 'balanced'), stepDownStreak: 0, stepUpStreak: 0, framesInLevel: 0 }; history = []; };
  const dispose = () => { disposed = true; history = []; };
  return freeze({ evaluate, snapshot, reset, dispose });
}

export function renderQualityDigest(result) {
  const s = result?.state ?? {}; const p = result?.profile ?? {}; const raw = [s.level, s.target, p.backend, p.pixelRatio, p.shadows, p.foliageMultiplier, p.waterSegments, p.postFxQuality, p.temporalHistory, p.animationRate, result?.summary?.p95FrameMs].join('|');
  let h = 2166136261; for (const c of raw) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h ^ (h >>> 16)).toString(16).padStart(8, '0');
}

export function validateRenderQualityResult(result) {
  const errors = []; if (result?.disposed) return freeze({ valid: true, errors: freeze([]) });
  if (!RENDER_QUALITY_LEVELS.includes(result?.state?.level)) errors.push('level');
  if (!RENDER_QUALITY_LEVELS.includes(result?.state?.target)) errors.push('target');
  if (!RENDER_QUALITY_BACKENDS.includes(result?.profile?.backend)) errors.push('backend');
  if (!Number.isFinite(result?.profile?.pixelRatio) || result.profile.pixelRatio < 0.7 || result.profile.pixelRatio > 2) errors.push('pixelRatio');
  if (!Number.isInteger(result?.profile?.shadows) || result.profile.shadows < 128) errors.push('shadows');
  if (!Number.isFinite(result?.profile?.animationRate) || result.profile.animationRate < 0.5 || result.profile.animationRate > 1) errors.push('animationRate');
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function replayRenderQuality(cases = [], initial = {}) {
  const governor = createRenderQualityGovernor(initial); return freeze((Array.isArray(cases) ? cases : []).map((item) => governor.evaluate(item.telemetry, item.context)));
}
