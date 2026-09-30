// @ts-nocheck
/**
 * Deterministic policy for continuous ambient emitters.
 * Keeps emitter intent separate from the Web Audio graph and provides bounded curves for
 * movement, environment and player-state driven layers.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const clamp01 = (value) => clamp(value, 0, 1);

const smoothStep = (edge0, edge1, value) => {
	const span = Math.max(1e-6, edge1 - edge0);
	const t = clamp01((value - edge0) / span);
	return t * t * (3 - 2 * t);
};

export const CONTINUOUS_AUDIO_EMITTERS = Object.freeze({
	WIND: 'wind',
	WATER: 'water',
	RAIN: 'rain',
	FIRE: 'fire',
	FOREST: 'forest',
	CAMP: 'camp',
	CAVE: 'cave',
	NIGHT: 'night',
});

const DEFAULTS = Object.freeze({
	maxDistance: 140,
	fadeInDistance: 12,
	fadeOutDistance: 132,
	minGain: 0,
	maxGain: 1,
	maxPitchDelta: 0.12,
});

function normalizeEmitter(input = {}) {
	return {
		id: String(input.id ?? '').slice(0, 80),
		kind: Object.values(CONTINUOUS_AUDIO_EMITTERS).includes(input.kind) ? input.kind : CONTINUOUS_AUDIO_EMITTERS.WIND,
		position: {
			x: Number.isFinite(input.position?.x) ? input.position.x : 0,
			y: Number.isFinite(input.position?.y) ? input.position.y : 0,
			z: Number.isFinite(input.position?.z) ? input.position.z : 0,
		},
		baseGain: clamp01(input.baseGain ?? 0.35),
		energy: clamp01(input.energy ?? 0.5),
		loop: input.loop !== false,
		priority: clamp(input.priority ?? 30, 0, 100),
		occlusion: clamp01(input.occlusion ?? 0),
	};
}

export function evaluateContinuousEmitter(emitterInput, listenerPosition = {}, environment = {}) {
	const emitter = normalizeEmitter(emitterInput);
	const listener = {
		x: Number.isFinite(listenerPosition.x) ? listenerPosition.x : 0,
		y: Number.isFinite(listenerPosition.y) ? listenerPosition.y : 0,
		z: Number.isFinite(listenerPosition.z) ? listenerPosition.z : 0,
	};
	const distance = Math.hypot(
		emitter.position.x - listener.x,
		emitter.position.y - listener.y,
		emitter.position.z - listener.z,
	);
	const proximity = 1 - smoothStep(DEFAULTS.fadeInDistance, DEFAULTS.fadeOutDistance, distance);
	const humidity = clamp01(environment.humidity ?? 0.5);
	const wind = clamp01(environment.wind ?? emitter.energy);
	const rain = clamp01(environment.rain ?? 0);
	const night = clamp01(environment.night ?? 0);
	const temperature = clamp(environment.temperature ?? 0.5, 0, 1);

	const kindGain = {
		[CONTINUOUS_AUDIO_EMITTERS.WIND]: 0.62 + wind * 0.38,
		[CONTINUOUS_AUDIO_EMITTERS.WATER]: 0.58 + humidity * 0.22,
		[CONTINUOUS_AUDIO_EMITTERS.RAIN]: 0.15 + rain * 0.85,
		[CONTINUOUS_AUDIO_EMITTERS.FIRE]: 0.42 + (1 - temperature) * 0.32,
		[CONTINUOUS_AUDIO_EMITTERS.FOREST]: 0.42 + humidity * 0.24 + wind * 0.18,
		[CONTINUOUS_AUDIO_EMITTERS.CAMP]: 0.72 + night * 0.2,
		[CONTINUOUS_AUDIO_EMITTERS.CAVE]: 0.38 + humidity * 0.25,
		[CONTINUOUS_AUDIO_EMITTERS.NIGHT]: 0.38 + night * 0.62,
	};

	const unoccluded = 1 - emitter.occlusion * 0.68;
	const gain = clamp(emitter.baseGain * emitter.energy * proximity * (kindGain[emitter.kind] ?? 0.5) * unoccluded, DEFAULTS.minGain, DEFAULTS.maxGain);
	const pitch = 1 + clamp((wind - 0.5) * DEFAULTS.maxPitchDelta, -DEFAULTS.maxPitchDelta, DEFAULTS.maxPitchDelta);
	const lowpassHz = clamp(260 + (1 - emitter.occlusion) * 3_400 + humidity * 500, 180, 4_500);
	return Object.freeze({
		version: 1,
		id: emitter.id,
		kind: emitter.kind,
		distance: Number(distance.toFixed(4)),
		proximity: Number(proximity.toFixed(4)),
		gain: Number(gain.toFixed(6)),
		pitch: Number(pitch.toFixed(6)),
		lowpassHz: Number(lowpassHz.toFixed(2)),
		virtualized: gain < 0.002 || distance > DEFAULTS.maxDistance,
		priority: emitter.priority,
	});
}

export function validateContinuousEmitterReceipt(receipt) {
	return Boolean(
		receipt &&
		receipt.version === 1 &&
		typeof receipt.id === 'string' &&
		Object.values(CONTINUOUS_AUDIO_EMITTERS).includes(receipt.kind) &&
		receipt.distance >= 0 &&
		receipt.proximity >= 0 && receipt.proximity <= 1 &&
		receipt.gain >= 0 && receipt.gain <= 1 &&
		receipt.pitch >= 0.5 && receipt.pitch <= 1.5 &&
		receipt.lowpassHz >= 180 && receipt.lowpassHz <= 4500
	);
}

export function summarizeContinuousEmitterReceipts(receipts = []) {
	const valid = receipts.filter(validateContinuousEmitterReceipt);
	const active = valid.filter((receipt) => !receipt.virtualized);
	const gain = active.length ? active.reduce((sum, receipt) => sum + receipt.gain, 0) / active.length : 0;
	return Object.freeze({
		version: 1,
		total: receipts.length,
		valid: valid.length,
		active: active.length,
		virtualized: valid.length - active.length,
		averageGain: Number(gain.toFixed(6)),
	});
}
