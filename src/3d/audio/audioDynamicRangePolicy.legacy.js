/**
 * Dynamic-range and accessibility policy for the immersive audio layer.
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const clamp01 = (v) => clamp(v, 0, 1);

export const AUDIO_RANGE_MODES = Object.freeze({
	FULL: 'full',
	REDUCED: 'reduced',
	NIGHT: 'night',
	HEADPHONE: 'headphone',
});

const MODE_CONFIG = Object.freeze({
	[AUDIO_RANGE_MODES.FULL]: Object.freeze({ minGain: 0.02, maxGain: 1, transientScale: 1, compression: 0.12 }),
	[AUDIO_RANGE_MODES.REDUCED]: Object.freeze({ minGain: 0.08, maxGain: 0.82, transientScale: 0.52, compression: 0.55 }),
	[AUDIO_RANGE_MODES.NIGHT]: Object.freeze({ minGain: 0.1, maxGain: 0.7, transientScale: 0.4, compression: 0.68 }),
	[AUDIO_RANGE_MODES.HEADPHONE]: Object.freeze({ minGain: 0.015, maxGain: 0.9, transientScale: 0.78, compression: 0.3 }),
});

function normalizeMode(mode) {
	return Object.values(AUDIO_RANGE_MODES).includes(mode) ? mode : AUDIO_RANGE_MODES.FULL;
}

export function evaluateDynamicRange({ mode = AUDIO_RANGE_MODES.FULL, gain = 1, transient = 0, speechPriority = false, userGain = 1 } = {}) {
	const activeMode = normalizeMode(mode);
	const config = MODE_CONFIG[activeMode];
	const safeGain = clamp01(gain) * clamp01(userGain);
	const compressed = safeGain * (1 - clamp01(transient) * config.compression);
	const speechBoost = speechPriority ? 1.12 : 1;
	const outputGain = clamp(compressed * speechBoost, config.minGain, config.maxGain);
	return Object.freeze({
		version: 1,
		mode: activeMode,
		inputGain: Number(safeGain.toFixed(6)),
		outputGain: Number(outputGain.toFixed(6)),
		transientScale: config.transientScale,
		compression: config.compression,
		speechPriority: !!speechPriority,
		clipped: outputGain >= config.maxGain - 1e-6,
	});
}

export function summarizeDynamicRange(samples = []) {
	const valid = samples.filter((sample) => sample?.version === 1 && sample.outputGain >= 0 && sample.outputGain <= 1.01);
	const loudest = valid.reduce((max, sample) => Math.max(max, sample.outputGain), 0);
	const average = valid.length ? valid.reduce((sum, sample) => sum + sample.outputGain, 0) / valid.length : 0;
	return Object.freeze({
		version: 1,
		count: samples.length,
		valid: valid.length,
		loudest: Number(loudest.toFixed(6)),
		average: Number(average.toFixed(6)),
	});
}
