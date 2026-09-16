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
	minimal: { maxSources: 8, maxPanners: 4, maxProceduralLayers: 3, maxTransientPerSecond: 6, maxGeneratedBuffers: 4, updateHz: 12 },
	balanced: { maxSources: 16, maxPanners: 8, maxProceduralLayers: 5, maxTransientPerSecond: 12, maxGeneratedBuffers: 6, updateHz: 18 },
	high: { maxSources: 28, maxPanners: 16, maxProceduralLayers: 5, maxTransientPerSecond: 20, maxGeneratedBuffers: 8, updateHz: 24 },
	ultra: { maxSources: 48, maxPanners: 28, maxProceduralLayers: 6, maxTransientPerSecond: 30, maxGeneratedBuffers: 10, updateHz: 30 },
});

export function createAudioPerformanceBudget({ quality = 'balanced', coarsePointer = false, lowPowerMode = false, measuredCpuMs = 0, measuredSources = 0, measuredTransientRate = 0 } = {}) {
	const tier = Object.prototype.hasOwnProperty.call(BASE, quality) ? quality : 'balanced';
	const base = { ...BASE[tier] };
	if (coarsePointer) { base.maxSources = Math.min(base.maxSources, 12); base.maxPanners = Math.min(base.maxPanners, 6); base.maxProceduralLayers = Math.min(base.maxProceduralLayers, 4); base.updateHz = Math.min(base.updateHz, 18); }
	if (lowPowerMode) { base.maxSources = Math.min(base.maxSources, 8); base.maxPanners = Math.min(base.maxPanners, 4); base.maxTransientPerSecond = Math.min(base.maxTransientPerSecond, 6); base.updateHz = Math.min(base.updateHz, 12); }
	const cpuRatio = clamp(finiteOr(measuredCpuMs, 0) / 4, 0, 2);
	const sourceRatio = clamp(finiteOr(measuredSources, 0) / Math.max(base.maxSources, 1), 0, 2);
	const transientRatio = clamp(finiteOr(measuredTransientRate, 0) / Math.max(base.maxTransientPerSecond, 1), 0, 2);
	const pressure = clamp(cpuRatio * 0.5 + sourceRatio * 0.3 + transientRatio * 0.2, 0, 2);
	if (pressure >= 1.2) base.maxProceduralLayers = Math.max(1, base.maxProceduralLayers - 2);
	else if (pressure >= 0.85) base.maxProceduralLayers = Math.max(2, base.maxProceduralLayers - 1);
	return freeze({ version: 1, quality: tier, pressure: Number(pressure.toFixed(4)), budget: base, measurements: { cpuMs: finiteOr(measuredCpuMs, 0), sources: Math.max(0, Math.round(finiteOr(measuredSources, 0))), transientRate: Math.max(0, finiteOr(measuredTransientRate, 0)) }, rules: { hardVoiceCap: true, prioritizeCriticalCues: true, virtualizeFarSources: true, skipOptionalLayersUnderPressure: pressure >= 0.85 } });
}

export function audioPerformanceAdmission(policy, { critical = false, kind = 'source', current = 0, estimatedCost = 1 } = {}) {
	const budget = policy?.budget ?? {};
	const key = kind === 'panner' ? 'maxPanners' : kind === 'transient' ? 'maxTransientPerSecond' : kind === 'procedural' ? 'maxProceduralLayers' : kind === 'buffer' ? 'maxGeneratedBuffers' : 'maxSources';
	const limit = Math.max(0, Number(budget[key] ?? 0));
	if (critical) return { allowed: true, reason: 'critical-priority', reserved: Math.max(0, estimatedCost) };
	if (current + estimatedCost > limit) return { allowed: false, reason: 'budget-exhausted', reserved: 0 };
	if (policy.pressure >= 1.2 && kind === 'procedural') return { allowed: false, reason: 'critical-audio-pressure', reserved: 0 };
	return { allowed: true, reason: 'budget-available', reserved: Math.max(0, estimatedCost) };
}

export function audioPerformanceQualityIndex(quality) { return QUALITY[quality] ?? QUALITY.balanced; }
export function audioPerformanceBudgetConstants() { return freeze({ quality: QUALITY, base: BASE }); }
