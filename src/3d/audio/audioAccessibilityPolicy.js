/**
 * Hearing accessibility policy.
 *
 * Gives the audio director explicit controls for reduced dynamic range, transient limiting, low-frequency
 * preservation, high-frequency softening and non-positional center cues. This is independent of visual
 * reduced-motion preference: users may need either, both, or neither.
 */

const PROFILES = Object.freeze({
	FULL: 'full',
	REDUCED_DYNAMIC_RANGE: 'reduced-dynamic-range',
	SOFT_TRANSIENTS: 'soft-transients',
	MONO_CENTER: 'mono-center',
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;
const freeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) freeze(child); return value; };

export function createAudioAccessibilityPolicy(input = {}) {
	const profile = Object.values(PROFILES).includes(input.profile) ? input.profile : PROFILES.FULL;
	const reducedDynamicRange = input.reducedDynamicRange === true || profile === PROFILES.REDUCED_DYNAMIC_RANGE;
	const softTransients = input.softTransients === true || profile === PROFILES.SOFT_TRANSIENTS || reducedDynamicRange;
	const monoCenter = input.monoCenter === true || profile === PROFILES.MONO_CENTER;
	const hearingBoost = clamp(finiteOr(input.hearingBoost, 0), 0, 1);
	return freeze({
		version: 1,
		profile,
		dynamicRange: { compressorRatio: reducedDynamicRange ? 6 : 3, compressorThresholdDb: reducedDynamicRange ? -34 : -24, maxPeak: reducedDynamicRange ? 0.6 : 0.92 },
		transients: { enabled: softTransients, gain: softTransients ? 0.55 : 1, maxDurationMs: softTransients ? 85 : 160 },
		frequency: { lowShelfDb: hearingBoost * 4, highShelfDb: softTransients ? -2.5 : 0, speechBandDb: hearingBoost * 1.5 },
		spatial: { monoCenter, preserveDistanceCue: !monoCenter, centerGain: monoCenter ? 1 : 0.9 },
	});
}

export function applyAudioAccessibilityGain(gain, policy, { transient = false, dialogue = false } = {}) {
	let value = clamp(finiteOr(gain, 0), 0, 1);
	if (policy?.transients?.enabled && transient) value *= policy.transients.gain;
	if (dialogue) value *= 1 + clamp(finiteOr(policy?.frequency?.speechBandDb, 0) / 12, 0, 0.2);
	return clamp(value, 0, 1);
}

export function audioAccessibilityConstants() { return freeze({ profiles: PROFILES }); }
