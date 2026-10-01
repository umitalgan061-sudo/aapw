/**
 * Geography-aware animation presentation adapter.
 *
 * Player.js remains the owner of movement/combat state and AnimationMixer lifecycle. This adapter only
 * resolves presentation parameters from the already-resolved geographic visual state and current player
 * motion telemetry. It provides deterministic blend weights/timescales for idle, walk, run and attack
 * families, plus environmental contact hints that animation/VFX layers can consume.
 *
 * No animation asset is synthesized here. The caller must supply the existing shipped animation family.
 * This intentionally stays small enough to be called from the current player controller without creating
 * a second movement or combat state machine.
 *
 * @module gameplay/playerGeographicAnimationPresentation
 */

const PRESENTATION_VERSION = '2026-09-07-v1';
const MAX_SPEED_MPS = 10;
const RUN_THRESHOLD_MPS = 5.5;
const WALK_THRESHOLD_MPS = 0.35;
const MAX_SLOPE_DEGREES = 45;
const MAX_TIMESCALE = 1.65;
const MIN_TIMESCALE = 0.55;
const COMBAT_TURN_DAMPING = 0.68;
const ATTACK_SPEED_MIN = 0.82;
const ATTACK_SPEED_MAX = 1.18;

const ANIMATION_FAMILIES = Object.freeze({
	idle: Object.freeze({ required: true, motion: 'idle', assetHint: 'idle.fbx' }),
	walk: Object.freeze({ required: true, motion: 'walk', assetHint: 'walking.fbx' }),
	run: Object.freeze({ required: true, motion: 'run', assetHint: 'running.fbx' }),
	lightAttack: Object.freeze({ required: false, motion: 'attack-light', assetHint: 'attack-light.fbx' }),
	heavyAttack: Object.freeze({ required: false, motion: 'attack-heavy', assetHint: 'attack-heavy.fbx' }),
	dodge: Object.freeze({ required: false, motion: 'dodge', assetHint: 'dodge.fbx' }),
	guard: Object.freeze({ required: false, motion: 'guard', assetHint: 'guard.fbx' }),
	parry: Object.freeze({ required: false, motion: 'parry', assetHint: 'parry.fbx' }),
});

const CLIMATE_MOTION_POLICY = Object.freeze({
	dry: Object.freeze({ strideMultiplier: 1.00, turnMultiplier: 1.00, attackMultiplier: 1.00, footPlantBias: 0.02 }),
	temperate: Object.freeze({ strideMultiplier: 1.00, turnMultiplier: 1.00, attackMultiplier: 1.00, footPlantBias: 0.00 }),
	wet: Object.freeze({ strideMultiplier: 0.96, turnMultiplier: 0.92, attackMultiplier: 0.97, footPlantBias: 0.08 }),
	frost: Object.freeze({ strideMultiplier: 0.91, turnMultiplier: 0.86, attackMultiplier: 0.95, footPlantBias: 0.14 }),
});

const BIOME_MOTION_BIAS = Object.freeze({
	snow: Object.freeze({ speedMultiplier: 0.90, accelerationMultiplier: 0.87 }),
	'cold-grassland': Object.freeze({ speedMultiplier: 0.96, accelerationMultiplier: 0.94 }),
	marsh: Object.freeze({ speedMultiplier: 0.88, accelerationMultiplier: 0.82 }),
	mountain: Object.freeze({ speedMultiplier: 0.84, accelerationMultiplier: 0.79 }),
	'rocky-hills': Object.freeze({ speedMultiplier: 0.91, accelerationMultiplier: 0.86 }),
	'lush-grassland': Object.freeze({ speedMultiplier: 1.00, accelerationMultiplier: 1.00 }),
	desert: Object.freeze({ speedMultiplier: 0.97, accelerationMultiplier: 0.91 }),
	steppe: Object.freeze({ speedMultiplier: 0.98, accelerationMultiplier: 0.95 }),
	arid: Object.freeze({ speedMultiplier: 0.97, accelerationMultiplier: 0.92 }),
	jungle: Object.freeze({ speedMultiplier: 0.90, accelerationMultiplier: 0.84 }),
	'temperate-coast': Object.freeze({ speedMultiplier: 0.97, accelerationMultiplier: 0.94 }),
});

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function finite(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 4) {
	const factor = 10 ** digits;
	return Math.round(finite(value) * factor) / factor;
}

function normalizeClimate(climate) {
	const value = String(climate || 'temperate').toLowerCase();
	return CLIMATE_MOTION_POLICY[value] ? value : 'temperate';
}

function resolveBiomeBias(biomeKind) {
	return BIOME_MOTION_BIAS[String(biomeKind || '').toLowerCase()] || Object.freeze({ speedMultiplier: 1, accelerationMultiplier: 1 });
}

function normalizeSpeed(speedMps) {
	return clamp(finite(speedMps), 0, MAX_SPEED_MPS);
}

function normalizeSlope(slopeDegrees) {
	return clamp(Math.abs(finite(slopeDegrees)), 0, MAX_SLOPE_DEGREES);
}

function resolveLocomotionPhase(speedMps) {
	const speed = normalizeSpeed(speedMps);
	if (speed < WALK_THRESHOLD_MPS) return 'idle';
	if (speed < RUN_THRESHOLD_MPS) return 'walk';
	return 'run';
}

function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

function resolveBlendWeights(speedMps) {
	const speed = normalizeSpeed(speedMps);
	const walkWeight = smoothstep(WALK_THRESHOLD_MPS * 0.55, RUN_THRESHOLD_MPS, speed);
	const runWeight = smoothstep(RUN_THRESHOLD_MPS * 0.80, MAX_SPEED_MPS, speed);
	const idleWeight = clamp(1 - speed / Math.max(WALK_THRESHOLD_MPS, 0.01), 0, 1);
	return Object.freeze({
		idle: round(idleWeight),
		walk: round(clamp(walkWeight - runWeight * 0.65, 0, 1)),
		run: round(runWeight),
	});
}

function resolveMotionScale({ phase, speedMps, climate, biomeKind, slopeDegrees, exhausted = false }) {
	const climatePolicy = CLIMATE_MOTION_POLICY[normalizeClimate(climate)];
	const biome = resolveBiomeBias(biomeKind);
	const slope = normalizeSlope(slopeDegrees);
	const slopePenalty = 1 - clamp(slope / MAX_SLOPE_DEGREES, 0, 1) * 0.13;
	const base = phase === 'idle' ? 1 : clamp(normalizeSpeed(speedMps) / (phase === 'run' ? MAX_SPEED_MPS : RUN_THRESHOLD_MPS), 0, 1);
	const exhaustionPenalty = exhausted ? 0.90 : 1;
	const environmental = climatePolicy.strideMultiplier * biome.speedMultiplier * slopePenalty * exhaustionPenalty;
	return clamp(MIN_TIMESCALE + base * environmental * (MAX_TIMESCALE - MIN_TIMESCALE), MIN_TIMESCALE, MAX_TIMESCALE);
}

function resolveTurnMultiplier({ climate, slopeDegrees, guarding = false, attacking = false, dodging = false }) {
	const climatePolicy = CLIMATE_MOTION_POLICY[normalizeClimate(climate)];
	const slopePenalty = 1 - clamp(normalizeSlope(slopeDegrees) / MAX_SLOPE_DEGREES, 0, 1) * 0.10;
	const defensePenalty = guarding ? 0.68 : 1;
	const attackPenalty = attacking ? COMBAT_TURN_DAMPING : 1;
	const dodgePenalty = dodging ? 0.84 : 1;
	return round(clamp(climatePolicy.turnMultiplier * slopePenalty * defensePenalty * attackPenalty * dodgePenalty, 0.45, 1));
}

function resolveAttackSpeed({ kind, staminaRatio = 1, poiseRatio = 1, climate, biomeKind }) {
	const environmental = CLIMATE_MOTION_POLICY[normalizeClimate(climate)].attackMultiplier;
	const biome = resolveBiomeBias(biomeKind).speedMultiplier;
	const readiness = clamp((clamp(staminaRatio, 0, 1) * 0.72) + (clamp(poiseRatio, 0, 1) * 0.28), 0.35, 1);
	const kindMultiplier = String(kind || 'light').toLowerCase() === 'heavy' ? 0.92 : 1;
	return round(clamp(ATTACK_SPEED_MIN + readiness * environmental * biome * kindMultiplier * (ATTACK_SPEED_MAX - ATTACK_SPEED_MIN), ATTACK_SPEED_MIN, ATTACK_SPEED_MAX));
}

function resolveFootPlantBias({ climate, frost = 0, wet = 0, slopeDegrees = 0 }) {
	const climateBias = CLIMATE_MOTION_POLICY[normalizeClimate(climate)].footPlantBias;
	const terrainBias = clamp(normalizeSlope(slopeDegrees) / MAX_SLOPE_DEGREES, 0, 1) * 0.12;
	return round(clamp(climateBias + clamp(finite(frost), 0, 1) * 0.06 + clamp(finite(wet), 0, 1) * 0.04 + terrainBias, 0, 0.35));
}

function normalizeAttackKind(attackKind) {
	const kind = String(attackKind || '').toLowerCase();
	if (kind.includes('heavy')) return 'heavy';
	if (kind.includes('light')) return 'light';
	return 'none';
}

export function resolvePlayerGeographicAnimationPresentation({
	visualState = null,
	speedMps = 0,
	slopeDegrees = 0,
	staminaRatio = 1,
	poiseRatio = 1,
	exhausted = false,
	guarding = false,
	attacking = false,
	dodging = false,
	attackKind = 'none',
	comboStep = 1,
} = {}) {
	const climate = normalizeClimate(visualState?.condition?.climate);
	const biomeKind = visualState?.biomeKind || null;
	const phase = resolveLocomotionPhase(speedMps);
	const blend = resolveBlendWeights(speedMps);
	const timescale = round(resolveMotionScale({ phase, speedMps, climate, biomeKind, slopeDegrees, exhausted }), 3);
	const turnMultiplier = resolveTurnMultiplier({ climate, slopeDegrees, guarding, attacking, dodging });
	const normalizedAttackKind = normalizeAttackKind(attackKind);
	const attackTimescale = normalizedAttackKind === 'none' ? 1 : resolveAttackSpeed({ kind: normalizedAttackKind, staminaRatio, poiseRatio, climate, biomeKind });
	const footPlantBias = resolveFootPlantBias({ climate, frost: visualState?.condition?.frost, wet: visualState?.condition?.wet, slopeDegrees });
	const combo = clamp(Math.floor(finite(comboStep, 1)), 1, 3);
	const commitMultiplier = 1 + (combo - 1) * 0.08;
	return Object.freeze({
		version: PRESENTATION_VERSION,
		phase,
		blend,
		locomotionTimescale: timescale,
		turnMultiplier,
		attackTimescale: round(attackTimescale, 3),
		attackKind: normalizedAttackKind,
		comboStep: combo,
		attackCommitMultiplier: round(commitMultiplier, 3),
		footPlantBias,
		climate,
		biomeKind,
		slopeDegrees: round(normalizeSlope(slopeDegrees), 2),
		exhausted: Boolean(exhausted),
		animationFamily: Object.freeze({ ...ANIMATION_FAMILIES }),
	});
}

export function selectAvailableAnimationFamily(loadedActions = {}, { preferredPhase = 'idle', attackKind = 'none', guarding = false, dodging = false, parrying = false } = {}) {
	const available = new Set(Object.keys(loadedActions || {}));
	const candidates = [];
	const normalizedAttack = normalizeAttackKind(attackKind);
	if (parrying) candidates.push('parry');
	else if (dodging) candidates.push('dodge');
	else if (normalizedAttack === 'heavy') candidates.push('heavyAttack');
	else if (normalizedAttack === 'light') candidates.push('lightAttack');
	else if (guarding) candidates.push('guard');
	candidates.push(preferredPhase, 'idle');
	for (const candidate of candidates) if (available.has(candidate)) return candidate;
	return null;
}

export function auditAnimationFamily(loadedActions = {}, { required = ['idle', 'walk', 'run'], optional = ['lightAttack', 'heavyAttack', 'dodge', 'guard', 'parry'] } = {}) {
	const available = new Set(Object.keys(loadedActions || {}));
	const missingRequired = required.filter((name) => !available.has(name));
	const availableOptional = optional.filter((name) => available.has(name));
	return Object.freeze({
		ok: missingRequired.length === 0,
		missingRequired: Object.freeze(missingRequired),
		availableOptional: Object.freeze(availableOptional),
		loaded: Object.freeze([...available].sort()),
		requiredCount: required.length,
		optionalCount: optional.length,
	});
}

export function createPlayerAnimationPresentationState(initial = {}) {
	let previousPhase = null;
	let phaseTransitionAge = 0;
	let disposed = false;
	function update(deltaSeconds = 0, input = {}) {
		if (disposed) throw new Error('player animation presentation state is disposed');
		const next = resolvePlayerGeographicAnimationPresentation(input);
		const delta = Math.max(0, Math.min(0.25, finite(deltaSeconds)));
		if (previousPhase !== next.phase) {
			previousPhase = next.phase;
			phaseTransitionAge = 0;
		} else {
			phaseTransitionAge += delta;
		}
		return Object.freeze({
			...next,
			phaseTransitionAge: round(phaseTransitionAge, 3),
			phaseChanged: phaseTransitionAge === 0,
		});
	}
	function dispose() {
		disposed = true;
		previousPhase = null;
	}
	return Object.freeze({ update, dispose, getInitial: () => initial });
}

export const PLAYER_GEOGRAPHIC_ANIMATION_PRESENTATION_POLICY = Object.freeze({
	version: PRESENTATION_VERSION,
	maxSpeedMps: MAX_SPEED_MPS,
	runThresholdMps: RUN_THRESHOLD_MPS,
	walkThresholdMps: WALK_THRESHOLD_MPS,
	maxSlopeDegrees: MAX_SLOPE_DEGREES,
	animationFamilies: ANIMATION_FAMILIES,
	domFree: true,
	playerStateOwnerUnchanged: true,
	materialOwnerUnchanged: true,
	worldTerrainOwnerUnchanged: true,
});
