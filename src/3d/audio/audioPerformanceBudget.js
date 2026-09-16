/**
 * Audio graph performance budget.
 *
 * Audio has its own CPU and memory pressure that does not show up as a renderer triangle count. This
 * policy converts runtime quality and measured graph occupancy into hard admission targets for procedural
 * layers, panners, transient cues and generated buffers. The policy never allocates nodes itself.
 */

const QUALITY = Object.freeze({ minimal: 0, balanced: 1, high: 2, ultra: 3 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

const BASE = Object.freeze({
\tminimal: { maxSources: 8, maxPanners: 4, maxProceduralLayers: 3, maxTransientPerSecond: 6, maxGeneratedBuffers: 4, updateHz: 12 },
\tbalanced: { maxSources: 16, maxPanners: 8, maxProceduralLayers: 5, maxTransientPerSecond: 12, maxGeneratedBuffers: 6, updateHz: 18 },
\thigh: { maxSources: 28, maxPanners: 16, maxProceduralLayers: 5, maxTransientPerSecond: 20, maxGeneratedBuffers: 8, updateHz: 24 },
\tultra: { maxSources: 48, maxPanners: 28, maxProceduralLayers: 6, maxTransientPerSecond: 30, maxGeneratedBuffers: 10, updateHz: 30 },
});

export function createAudioPerformanceBudget({ quality = 'balanced', coarsePointer = false, lowPowerMode = false, measuredCpuMs = 0, measuredSources = 0, measuredTransientRate = 0 } = {}) {
\tconst tier = Object.prototype.hasOwnProperty.call(BASE, quality) ? quality : 'balanced';
\tconst base = { ...BASE[tier] };
\tif (coarsePointer) { base.maxSources = Math.min(base.maxSources, 12); base.maxPanners = Math.min(base.maxPanners, 6); base.maxProceduralLayers = Math.min(base.maxProceduralLayers, 4); base.updateHz = Math.min(base.updateHz, 18); }
\tif (lowPowerMode) { base.maxSources = Math.min(base.maxSources, 8); base.maxPanners = Math.min(base.maxPanners, 4); base.maxTransientPerSecond = Math.min(base.maxTransientPerSecond, 6); base.updateHz = Math.min(base.updateHz, 12); }
\tconst cpuRatio = clamp(finiteOr(measuredCpuMs, 0) / 4, 0, 2);
\tconst sourceRatio = clamp(finiteOr(measuredSources, 0) / Math.max(base.maxSources, 1), 0, 2);
\tconst transientRatio = clamp(finiteOr(measuredTransientRate, 0) / Math.max(base.maxTransientPerSecond, 1), 0, 2);
\tconst pressure = clamp(cpuRatio * 0.5 + sourceRatio * 0.3 + transientRatio * 0.2, 0, 2);
\tif (pressure >= 1.2) base.maxProceduralLayers = Math.max(1, base.maxProceduralLayers - 2);
\telse if (pressure >= 0.85) base.maxProceduralLayers = Math.max(2, base.maxProceduralLayers - 1);
\treturn freeze({ version: 1, quality: tier, pressure: Number(pressure.toFixed(4)), budget: base, measurements: { cpuMs: finiteOr(measuredCpuMs, 0), sources: Math.max(0, Math.round(finiteOr(measuredSources, 0))), transientRate: Math.max(0, finiteOr(measuredTransientRate, 0)) }, rules: { hardVoiceCap: true, prioritizeCriticalCues: true, virtualizeFarSources: true, skipOptionalLayersUnderPressure: pressure >= 0.85 } });
}

export function audioPerformanceAdmission(policy, { critical = false, kind = 'source', current = 0, estimatedCost = 1 } = {}) {
\tconst budget = policy?.budget ?? {};
\tconst key = kind === 'panner' ? 'maxPanners' : kind === 'transient' ? 'maxTransientPerSecond' : kind === 'procedural' ? 'maxProceduralLayers' : kind === 'buffer' ? 'maxGeneratedBuffers' : 'maxSources';
\tconst limit = Math.max(0, Number(budget[key] ?? 0));
\tif (critical) return { allowed: true, reason: 'critical-priority', reserved: Math.max(0, estimatedCost) };
\tif (current + estimatedCost > limit) return { allowed: false, reason: 'budget-exhausted', reserved: 0 };
\tif (policy.pressure >= 1.2 && kind === 'procedural') return { allowed: false, reason: 'critical-audio-pressure', reserved: 0 };
\treturn { allowed: true, reason: 'budget-available', reserved: Math.max(0, estimatedCost) };
}

export function evaluateAudioPerformanceBudget(input = {}) {
\tconst policy = createAudioPerformanceBudget(input);
\treturn freeze({ ...policy, admission: audioPerformanceAdmission(policy, { kind: 'source', current: policy.measurements.sources, estimatedCost: 1 }), qualityIndex: audioPerformanceQualityIndex(policy.quality) });
}

export function audioPerformanceQualityIndex(quality) { return QUALITY[quality] ?? QUALITY.balanced; }
export function audioPerformanceBudgetConstants() { return freeze({ quality: QUALITY, base: BASE }); }
