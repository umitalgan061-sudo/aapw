/**
 * Immersive audio policy for the shipped Three.js runtime.
 *
 * The existing audioManager owns the AudioListener and trusted one-shot cues. This policy adds the
 * missing decision layer for an actual world soundscape: distance rolloff, source class priority,
 * environmental intensity, dynamic-range ceilings, mobile voice limits and accessibility-safe motion
 * alternatives. It never constructs Web Audio nodes and never starts playback.
 *
 * Every result is immutable and bounded so the policy can be consumed by a future director, debug panel,
 * or headless contract without requiring browser globals.
 */

const SOURCE_CLASSES = Object.freeze({
	PLAYER: 'player',
	NPC: 'npc',
	ANIMAL: 'animal',
	CREATURE: 'creature',
	DRAGON: 'dragon',
	WATER: 'water',
	WIND: 'wind',
	RAIN: 'rain',
	FIRE: 'fire',
	UI: 'ui',
	AMBIENCE: 'ambience',
	MUSIC: 'music',
	DEBUG: 'debug',
});

const ENVIRONMENTS = Object.freeze({
	PLAINS: 'plains',
	FOREST: 'forest',
	COAST: 'coast',
	RIVER: 'river',
	MOUNTAIN: 'mountain',
	SETTLEMENT: 'settlement',
	CASTLE: 'castle',
	ICE: 'ice',
	NIGHT: 'night',
	STORM: 'storm',
	UNKNOWN: 'unknown',
});

const PRIORITIES = Object.freeze({
	PLAYER: 100,
	DRAGON: 95,
	COMBAT: 92,
	NPC: 70,
	ANIMAL: 65,
	WEATHER: 55,
	WATER: 50,
	AMBIENCE: 30,
	MUSIC: 20,
	DEBUG: 5,
});

const QUALITY_LIMITS = Object.freeze({
	minimal: Object.freeze({ maxSources: 8, maxPositionalSources: 4, maxOscillators: 12, maxNoiseBuffers: 2 }),
	balanced: Object.freeze({ maxSources: 16, maxPositionalSources: 8, maxOscillators: 24, maxNoiseBuffers: 4 }),
	high: Object.freeze({ maxSources: 28, maxPositionalSources: 16, maxOscillators: 40, maxNoiseBuffers: 6 }),
	ultra: Object.freeze({ maxSources: 48, maxPositionalSources: 28, maxOscillators: 64, maxNoiseBuffers: 8 }),
});

const DEFAULTS = Object.freeze({
	maxDistance: 120,
	nearDistance: 6,
	referenceDistance: 8,
	rolloffFactor: 1.5,
	maxVolume: 0.45,
	masterVolume: 0.8,
	dynamicRange: 0.85,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function freeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
	return value;
}

function normalizeQuality(value) {
	return Object.prototype.hasOwnProperty.call(QUALITY_LIMITS, value) ? value : 'balanced';
}

function normalizeClass(value) {
	return Object.values(SOURCE_CLASSES).includes(value) ? value : SOURCE_CLASSES.AMBIENCE;
}

function normalizeEnvironment(value) {
	return Object.values(ENVIRONMENTS).includes(value) ? value : ENVIRONMENTS.UNKNOWN;
}

function priorityForClass(sourceClass) {
	if (sourceClass === SOURCE_CLASSES.PLAYER) return PRIORITIES.PLAYER;
	if (sourceClass === SOURCE_CLASSES.DRAGON) return PRIORITIES.DRAGON;
	if (sourceClass === SOURCE_CLASSES.NPC || sourceClass === SOURCE_CLASSES.CREATURE) return PRIORITIES.NPC;
	if (sourceClass === SOURCE_CLASSES.ANIMAL) return PRIORITIES.ANIMAL;
	if ([SOURCE_CLASSES.WIND, SOURCE_CLASSES.RAIN].includes(sourceClass)) return PRIORITIES.WEATHER;
	if (sourceClass === SOURCE_CLASSES.WATER) return PRIORITIES.WATER;
	if (sourceClass === SOURCE_CLASSES.MUSIC) return PRIORITIES.MUSIC;
	if (sourceClass === SOURCE_CLASSES.DEBUG) return PRIORITIES.DEBUG;
	return PRIORITIES.AMBIENCE;
}

function distanceAttenuation(distance, settings) {
	const safeDistance = Math.max(0, finiteOr(distance, settings.maxDistance));
	if (safeDistance >= settings.maxDistance) return 0;
	if (safeDistance <= settings.nearDistance) return 1;
	const normalized = (safeDistance - settings.nearDistance) / Math.max(settings.maxDistance - settings.nearDistance, 1);
	const curve = Math.pow(1 - clamp(normalized, 0, 1), settings.rolloffFactor);
	return Number(clamp(curve, 0, 1).toFixed(5));
}

function environmentGain(environment, sourceClass) {
	const table = {
		[ENVIRONMENTS.PLAINS]: { wind: 1, water: 0.35, rain: 0.8, ambience: 0.7 },
		[ENVIRONMENTS.FOREST]: { wind: 0.8, water: 0.25, rain: 0.9, ambience: 1 },
		[ENVIRONMENTS.COAST]: { wind: 1.25, water: 1.25, rain: 0.75, ambience: 0.9 },
		[ENVIRONMENTS.RIVER]: { wind: 0.7, water: 1.4, rain: 0.75, ambience: 0.85 },
		[ENVIRONMENTS.MOUNTAIN]: { wind: 1.2, water: 0.2, rain: 0.7, ambience: 0.65 },
		[ENVIRONMENTS.SETTLEMENT]: { wind: 0.5, water: 0.15, rain: 0.7, ambience: 1.15 },
		[ENVIRONMENTS.CASTLE]: { wind: 0.55, water: 0.1, rain: 0.65, ambience: 1.25 },
		[ENVIRONMENTS.ICE]: { wind: 1.35, water: 0.45, rain: 0.35, ambience: 0.6 },
		[ENVIRONMENTS.NIGHT]: { wind: 1.05, water: 0.9, rain: 0.75, ambience: 0.8 },
		[ENVIRONMENTS.STORM]: { wind: 1.4, water: 1, rain: 1.35, ambience: 1.1 },
	};
	const gains = table[environment] ?? table[ENVIRONMENTS.PLAINS];
	const key = sourceClass === SOURCE_CLASSES.WIND ? 'wind'
		: sourceClass === SOURCE_CLASSES.WATER ? 'water'
			: sourceClass === SOURCE_CLASSES.RAIN ? 'rain'
				: 'ambience';
	return gains[key] ?? 1;
}

function motionModifier(reducedMotion, sourceClass) {
	if (!reducedMotion) return 1;
	if ([SOURCE_CLASSES.WIND, SOURCE_CLASSES.RAIN, SOURCE_CLASSES.AMBIENCE].includes(sourceClass)) return 0.75;
	if ([SOURCE_CLASSES.DRAGON, SOURCE_CLASSES.CREATURE, SOURCE_CLASSES.ANIMAL].includes(sourceClass)) return 0.9;
	return 1;
}

function sourceVoiceCost(sourceClass) {
	if ([SOURCE_CLASSES.DRAGON, SOURCE_CLASSES.PLAYER].includes(sourceClass)) return 2;
	if ([SOURCE_CLASSES.WATER, SOURCE_CLASSES.WIND, SOURCE_CLASSES.RAIN].includes(sourceClass)) return 1.5;
	return 1;
}

export function createImmersiveAudioPolicy(input = {}) {
	const quality = normalizeQuality(input.quality);
	const qualityLimits = QUALITY_LIMITS[quality];
	const reducedMotion = input.reducedMotion === true;
	const coarsePointer = input.coarsePointer === true;
	const environment = normalizeEnvironment(input.environment);
	const maxDistance = clamp(finiteOr(input.maxDistance, DEFAULTS.maxDistance), 20, 500);
	const referenceDistance = clamp(finiteOr(input.referenceDistance, DEFAULTS.referenceDistance), 1, maxDistance);
	const maxVolume = clamp(finiteOr(input.maxVolume, DEFAULTS.maxVolume), 0, 1);
	const masterVolume = clamp(finiteOr(input.masterVolume, DEFAULTS.masterVolume), 0, 1);
	const dynamicRange = clamp(finiteOr(input.dynamicRange, DEFAULTS.dynamicRange), 0.2, 1);
	const policy = {
		version: 1,
		quality,
		environment,
		listener: {
			maxDistance,
			referenceDistance,
			rolloffFactor: clamp(finiteOr(input.rolloffFactor, DEFAULTS.rolloffFactor), 0.25, 4),
			masterVolume,
			dynamicRange,
		},
		limits: {
			...qualityLimits,
			maxSources: coarsePointer ? Math.min(qualityLimits.maxSources, 12) : qualityLimits.maxSources,
			maxPositionalSources: coarsePointer ? Math.min(qualityLimits.maxPositionalSources, 6) : qualityLimits.maxPositionalSources,
		},
		accessibility: {
			reducedMotion,
			motionCompensation: motionModifier(reducedMotion, SOURCE_CLASSES.WIND),
			allowSharpTransients: true,
		},
		classes: Object.fromEntries(Object.values(SOURCE_CLASSES).map((sourceClass) => [sourceClass, {
			priority: priorityForClass(sourceClass),
			voiceCost: sourceVoiceCost(sourceClass),
			environmentGain: environmentGain(environment, sourceClass),
		}]))
	};
	return freeze(policy);
}

export function evaluateAudioSource(request = {}, policy = createImmersiveAudioPolicy()) {
	const sourceClass = normalizeClass(request.class);
	const priority = clamp(Math.round(finiteOr(request.priority, priorityForClass(sourceClass))), 0, 100);
	const distance = Math.max(0, finiteOr(request.distance, policy.listener.maxDistance));
	const baseGain = clamp(finiteOr(request.gain, policy.maxVolume ?? DEFAULTS.maxVolume), 0, 1);
	const distanceGain = distanceAttenuation(distance, policy.listener);
	const envGain = clamp(finiteOr(request.environmentGain, policy.classes[sourceClass]?.environmentGain ?? 1), 0, 2);
	const motionGain = motionModifier(policy.accessibility.reducedMotion, sourceClass);
	const occlusion = clamp(finiteOr(request.occlusion, 0), 0, 1);
	const occlusionGain = 1 - occlusion * 0.82;
	const finalGain = clamp(baseGain * distanceGain * envGain * motionGain * occlusionGain * policy.listener.masterVolume, 0, 1);
	const audible = distance < policy.listener.maxDistance && finalGain > 0.0001;
	const positional = request.positional !== false && sourceClass !== SOURCE_CLASSES.UI && sourceClass !== SOURCE_CLASSES.MUSIC;
	const cost = sourceVoiceCost(sourceClass);
	return freeze({
		version: 1,
		id: typeof request.id === 'string' ? request.id.slice(0, 96) : null,
		class: sourceClass,
		priority,
		distance: Number(distance.toFixed(3)),
		gains: {
			base: Number(baseGain.toFixed(5)),
			distance: distanceGain,
			environment: Number(envGain.toFixed(5)),
			motion: Number(motionGain.toFixed(5)),
			occlusion: Number(occlusionGain.toFixed(5)),
			final: Number(finalGain.toFixed(5)),
		},
		positional,
		audible,
		voiceCost: cost,
		shouldVirtualize: !audible || distanceGain < 0.02,
		shouldDuck: priority >= PRIORITIES.COMBAT,
	});
}

export function allocateAudioSources(requests = [], policy = createImmersiveAudioPolicy()) {
	const ranked = requests.slice().map((request, index) => ({ request, index, decision: evaluateAudioSource(request, policy) }))
		.sort((a, b) => b.decision.priority - a.decision.priority || a.decision.distance - b.decision.distance || String(a.decision.id ?? a.index).localeCompare(String(b.decision.id ?? b.index)));
	let sourceBudget = policy.limits.maxSources;
	let positionalBudget = policy.limits.maxPositionalSources;
	let voiceBudget = policy.limits.maxOscillators;
	const admitted = [];
	for (const item of ranked) {
		const cost = item.decision.voiceCost;
		const positionalCost = item.decision.positional ? 1 : 0;
		if (!item.decision.audible) continue;
		if (sourceBudget <= 0 || voiceBudget < cost || (item.decision.positional && positionalBudget < positionalCost)) continue;
		admitted.push(item.decision);
		sourceBudget -= 1;
		voiceBudget -= cost;
		if (item.decision.positional) positionalBudget -= positionalCost;
	}
	return freeze({ version: 1, requested: requests.length, admitted: admitted.length, virtualized: Math.max(0, requests.length - admitted.length), remainingSources: sourceBudget, remainingPositionalSources: positionalBudget, remainingVoices: Number(voiceBudget.toFixed(3)), sources: admitted });
}

export function computeListenerOrientation(forward = {}, up = { x: 0, y: 1, z: 0 }) {
	const fx = finiteOr(forward.x, 0);
	const fy = finiteOr(forward.y, 0);
	const fz = finiteOr(forward.z, -1);
	const length = Math.hypot(fx, fy, fz) || 1;
	return freeze({ forward: { x: Number((fx / length).toFixed(6)), y: Number((fy / length).toFixed(6)), z: Number((fz / length).toFixed(6)) }, up: { x: finiteOr(up.x, 0), y: finiteOr(up.y, 1), z: finiteOr(up.z, 0) } });
}

export function computeDistanceGain(distance, policy) {
	return distanceAttenuation(distance, policy?.listener ?? DEFAULTS);
}

export function immersiveAudioConstants() {
	return freeze({ sourceClasses: SOURCE_CLASSES, environments: ENVIRONMENTS, priorities: PRIORITIES, qualityLimits: QUALITY_LIMITS });
}
