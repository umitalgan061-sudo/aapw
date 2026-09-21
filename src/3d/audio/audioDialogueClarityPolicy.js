/**
 * Dialogue intelligibility policy for noisy immersive scenes.
 * Produces deterministic mix guidance without owning UI or dialogue state.
 */

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const clamp01 = (v) => clamp(v, 0, 1);

export function evaluateDialogueClarity({ baseGain = 0.7, ambience = 0.5, weather = 0, combat = 0, distance = 0, occlusion = 0, reducedHearing = false } = {}) {
	const d = clamp(distance, 0, 80);
	const distanceAttenuation = 1 - 0.008 * d;
	const competing = clamp01(ambience) * 0.26 + clamp01(weather) * 0.22 + clamp01(combat) * 0.34;
	const occlusionPenalty = clamp01(occlusion) * 0.3;
	const clarityBoost = reducedHearing ? 1.12 : 1;
	const gain = clamp(clamp01(baseGain) * Math.max(0.35, distanceAttenuation) * (1 + clarityBoost * 0.08) + competing * 0.08 - occlusionPenalty, 0.08, 1);
	const lowpassHz = clamp(5_600 - occlusionPenalty * 3_500 - d * 18, 1_500, 5_600);
	return Object.freeze({
		version: 1,
		gain: Number(gain.toFixed(6)),
		lowpassHz: Number(lowpassHz.toFixed(2)),
		competingAmbienceSuppression: Number(clamp01(competing * 1.35).toFixed(6)),
		centerPan: 1,
		reducedHearing: !!reducedHearing,
	});
}

export function validateDialogueClarityReceipt(receipt) {
	return Boolean(receipt?.version === 1 && receipt.gain >= 0 && receipt.gain <= 1 && receipt.lowpassHz >= 1500 && receipt.lowpassHz <= 5600);
}
