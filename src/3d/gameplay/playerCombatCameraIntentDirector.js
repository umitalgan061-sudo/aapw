/**
 * Kızıl Ufuk — deterministic combat-aware third-person camera intent.
 *
 * This module deliberately does not own a Three.js Camera, OrbitControls, scene graph mutation,
 * collision geometry or target discovery. It projects the already-shipped player/combat event
 * stream into a bounded camera intent that the existing camera owner can consume.
 *
 * Ownership boundaries:
 * - player.js remains authoritative for locomotion/combat state and event production.
 * - camera.js/game3d.js remain authoritative for Camera + OrbitControls mutation.
 * - world/environment owners remain authoritative for terrain/collider/water observations.
 * - lock-on target discovery remains caller-owned; this module only consumes a target snapshot.
 * - MaterialAssignmentCore / WorldAssetPlacementPipeline remain untouched because this slice adds
 *   no model-bearing asset and no placement path.
 *
 * Runtime contract:
 *   aapw:player-camera-intent — frozen deterministic intent snapshot.
 *   aapw:player-motion — existing motion producer.
 *   aapw:player-attack-window — existing attack-window producer.
 *   aapw:player-combat-feedback — existing combat-feedback producer.
 *
 * @module gameplay/playerCombatCameraIntentDirector
 */

const VERSION = 1;
const MOTION_EVENT = 'aapw:player-motion';
const ATTACK_EVENT = 'aapw:player-attack-window';
const FEEDBACK_EVENT = 'aapw:player-combat-feedback';
const CAMERA_INTENT_EVENT = 'aapw:player-camera-intent';

const DEFAULT_CONFIG = Object.freeze({
	defaultDistance: 5.9,
	minDistance: 2.25,
	maxDistance: 9.5,
	defaultHeight: 1.85,
	minHeight: 1.2,
	maxHeight: 3.2,
	defaultFov: 58,
	minFov: 48,
	maxFov: 72,
	maxDeltaSeconds: 0.1,
	lookSensitivity: 2.2,
	pitchMinRadians: -0.34,
	pitchMaxRadians: 0.48,
	yawResponse: 11,
	pitchResponse: 11,
	distanceResponse: 8,
	heightResponse: 8,
	fovResponse: 7,
	shoulderResponse: 9,
	focusResponse: 10,
	deadzone: 0.08,
	shoulderOffsetMeters: 0.62,
	combatShoulderOffsetMeters: 0.72,
	targetLeadMeters: 0.55,
	lockOnLeadMeters: 0.3,
	collisionPaddingMeters: 0.18,
	collisionMinDistanceMeters: 1.4,
	shakeMaxMeters: 0.18,
	shakeMaxRadians: 0.035,
	feedbackMemorySeconds: 0.55,
	targetMemorySeconds: 0.35,
	signalStaleSeconds: 1.25,
	maxRecentEvents: 16,
	maxEventAgeSeconds: 1.5,
});

const PROFILE_TABLE = Object.freeze({
	idle: Object.freeze({ distance: 5.9, height: 1.85, fov: 58, focus: 1.0, shoulder: 1.0 }),
	walk: Object.freeze({ distance: 5.8, height: 1.84, fov: 59, focus: 1.0, shoulder: 1.0 }),
	sprint: Object.freeze({ distance: 6.65, height: 1.96, fov: 63, focus: 1.08, shoulder: 1.05 }),
	exhausted: Object.freeze({ distance: 6.25, height: 1.9, fov: 60, focus: 1.02, shoulder: 1.0 }),
	airborne: Object.freeze({ distance: 6.1, height: 1.98, fov: 60, focus: 1.04, shoulder: 1.0 }),
	guard: Object.freeze({ distance: 5.45, height: 1.9, fov: 57, focus: 1.08, shoulder: 1.16 }),
	parry: Object.freeze({ distance: 5.05, height: 1.92, fov: 57, focus: 1.16, shoulder: 1.22 }),
	dodge: Object.freeze({ distance: 5.15, height: 1.9, fov: 63, focus: 1.05, shoulder: 1.1 }),
	'guard-break': Object.freeze({ distance: 5.75, height: 1.98, fov: 62, focus: 1.1, shoulder: 1.14 }),
	'hit-stagger': Object.freeze({ distance: 5.45, height: 2.0, fov: 64, focus: 1.2, shoulder: 1.18 }),
	'attack-light': Object.freeze({ distance: 5.15, height: 1.9, fov: 62, focus: 1.15, shoulder: 1.22 }),
	'attack-heavy': Object.freeze({ distance: 4.85, height: 1.94, fov: 65, focus: 1.28, shoulder: 1.3 }),
});

const ACTION_PRIORITY = Object.freeze({
	'hit-stagger': 100,
	'guard-break': 95,
	parry: 92,
	dodge: 88,
	'attack-heavy': 84,
	'attack-light': 80,
	guard: 68,
	sprint: 44,
	airborne: 38,
	walk: 30,
	exhausted: 26,
	idle: 10,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, precision = 4) => {
	const factor = 10 ** precision;
	return Math.round(finite(value) * factor) / factor;
};
const nonNegative = (value, fallback = 0) => Math.max(0, finite(value, fallback));
const unit = (value, fallback = 0) => clamp(finite(value, fallback), -1, 1);
const positive = (value, fallback = 1) => Math.max(0.0001, finite(value, fallback));

function normalizeVector2(value, fallback = { x: 0, z: 0 }) {
	const x = finite(value?.x, fallback.x);
	const z = finite(value?.z, fallback.z);
	const magnitude = Math.hypot(x, z);
	if (magnitude <= 1e-6) return Object.freeze({ x: 0, z: 0, magnitude: 0 });
	return Object.freeze({ x: round(x / magnitude), z: round(z / magnitude), magnitude: round(Math.min(1, magnitude)) });
}

function normalizePosition(value) {
	return Object.freeze({
		x: round(finite(value?.x)),
		y: round(finite(value?.y)),
		z: round(finite(value?.z)),
	});
}

function normalizeFacing(value) {
	const vector = normalizeVector2(value, { x: 0, z: 1 });
	if (vector.magnitude <= 1e-6) return Object.freeze({ x: 0, z: 1 });
	return Object.freeze({ x: vector.x, z: vector.z });
}

function normalizeMotion(detail = {}) {
	const rawState = typeof detail.state === 'string' ? detail.state : 'idle';
	const state = PROFILE_TABLE[rawState] ? rawState : rawState.startsWith('attack-') ? rawState : 'idle';
	return Object.freeze({
		state,
		position: normalizePosition(detail.position),
		facing: normalizeFacing(detail.facing),
		speedMps: nonNegative(detail.speedMps),
		staminaRatio: clamp(finite(detail.staminaRatio, 1), 0, 1),
		poiseRatio: clamp(finite(detail.poiseRatio, 1), 0, 1),
		guarding: Boolean(detail.guarding),
		attackActive: Boolean(detail.attackActive),
		attackKind: detail.attackKind === 'heavy' ? 'heavy' : detail.attackKind === 'light' ? 'light' : 'none',
		attackPhase: typeof detail.attackPhase === 'string' ? detail.attackPhase : 'none',
		attackRemaining: nonNegative(detail.attackRemaining),
		isGrounded: detail.isGrounded !== false,
	});
}

function normalizeAttack(detail = {}) {
	return Object.freeze({
		serial: Math.max(0, Math.floor(finite(detail.serial))),
		kind: detail.kind === 'heavy' ? 'heavy' : detail.kind === 'light' ? 'light' : 'none',
		comboStep: clamp(Math.floor(finite(detail.comboStep)), 0, 3),
		phase: typeof detail.phase === 'string' ? detail.phase : 'unknown',
		active: Boolean(detail.active),
		reachMeters: nonNegative(detail.reachMeters),
		damageScale: nonNegative(detail.damageScale, 1),
		position: normalizePosition(detail.position),
		facing: normalizeFacing(detail.facing),
	});
}

function normalizeFeedback(detail = {}) {
	const outcomeVocabulary = new Set([
		'hit', 'guard', 'parry', 'dodge', 'guard-break', 'hit-stagger', 'defeat', 'miss', 'critical', 'blocked',
	]);
	const outcome = outcomeVocabulary.has(detail.outcome) ? detail.outcome : 'unknown';
	return Object.freeze({
		serial: Math.max(0, Math.floor(finite(detail.serial))),
		outcome,
		rawAmount: nonNegative(detail.rawAmount),
		appliedAmount: nonNegative(detail.appliedAmount),
		blockedAmount: nonNegative(detail.blockedAmount),
		stamina: nonNegative(detail.stamina),
		poise: nonNegative(detail.poise),
		state: typeof detail.state === 'string' ? detail.state : 'idle',
		position: normalizePosition(detail.position),
	});
}

function normalizeTarget(detail = {}) {
	if (!detail || detail.enabled === false || detail.valid === false) return null;
	const id = typeof detail.id === 'string' ? detail.id.trim().slice(0, 96) : '';
	const position = detail.position ?? detail.point;
	if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
	return Object.freeze({
		id: id || 'target',
		position: normalizePosition(position),
		velocity: Object.freeze({ x: round(finite(detail.velocity?.x)), y: round(finite(detail.velocity?.y)), z: round(finite(detail.velocity?.z)) }),
		distanceMeters: nonNegative(detail.distanceMeters, Number.POSITIVE_INFINITY),
		visibility: clamp(finite(detail.visibility, 1), 0, 1),
		lockOn: Boolean(detail.lockOn),
	});
}

function normalizeConfig(options = {}) {
	const merge = { ...DEFAULT_CONFIG, ...(options || {}) };
	const minDistance = clamp(positive(merge.minDistance, DEFAULT_CONFIG.minDistance), 0.5, 50);
	const maxDistance = Math.max(minDistance + 0.25, positive(merge.maxDistance, DEFAULT_CONFIG.maxDistance));
	const minHeight = clamp(finite(merge.minHeight, DEFAULT_CONFIG.minHeight), -5, 20);
	const maxHeight = Math.max(minHeight + 0.25, finite(merge.maxHeight, DEFAULT_CONFIG.maxHeight));
	const pitchMin = clamp(finite(merge.pitchMinRadians, DEFAULT_CONFIG.pitchMinRadians), -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
	const pitchMax = Math.max(pitchMin + 0.05, clamp(finite(merge.pitchMaxRadians, DEFAULT_CONFIG.pitchMaxRadians), -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05));
	return Object.freeze({
		...merge,
		defaultDistance: clamp(finite(merge.defaultDistance, DEFAULT_CONFIG.defaultDistance), minDistance, maxDistance),
		minDistance,
		maxDistance,
		defaultHeight: clamp(finite(merge.defaultHeight, DEFAULT_CONFIG.defaultHeight), minHeight, maxHeight),
		minHeight,
		maxHeight,
		defaultFov: clamp(finite(merge.defaultFov, DEFAULT_CONFIG.defaultFov), 35, 100),
		minFov: clamp(finite(merge.minFov, DEFAULT_CONFIG.minFov), 35, 100),
		maxFov: Math.max(finite(merge.minFov, DEFAULT_CONFIG.minFov), clamp(finite(merge.maxFov, DEFAULT_CONFIG.maxFov), 35, 100)),
		maxDeltaSeconds: clamp(finite(merge.maxDeltaSeconds, DEFAULT_CONFIG.maxDeltaSeconds), 0.016, 0.25),
		deadzone: clamp(finite(merge.deadzone, DEFAULT_CONFIG.deadzone), 0, 0.5),
		feedbackMemorySeconds: clamp(finite(merge.feedbackMemorySeconds, DEFAULT_CONFIG.feedbackMemorySeconds), 0.05, 2),
		targetMemorySeconds: clamp(finite(merge.targetMemorySeconds, DEFAULT_CONFIG.targetMemorySeconds), 0.05, 2),
		signalStaleSeconds: clamp(finite(merge.signalStaleSeconds, DEFAULT_CONFIG.signalStaleSeconds), 0.2, 10),
		maxRecentEvents: clamp(Math.floor(finite(merge.maxRecentEvents, DEFAULT_CONFIG.maxRecentEvents)), 1, 64),
		maxEventAgeSeconds: clamp(finite(merge.maxEventAgeSeconds, DEFAULT_CONFIG.maxEventAgeSeconds), 0.1, 10),
	});
}

function stableStringify(value) {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashString(value) {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function expApproach(current, target, response, delta) {
	if (!(delta > 0)) return current;
	const factor = 1 - Math.exp(-Math.max(0.001, response) * delta);
	return current + (target - current) * factor;
}

function smoothAngle(current, target, response, delta) {
	const twoPi = Math.PI * 2;
	let deltaAngle = ((target - current + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
	if (deltaAngle > Math.PI) deltaAngle -= twoPi;
	return current + deltaAngle * (1 - Math.exp(-Math.max(0.001, response) * Math.max(0, delta)));
}

function applyDeadzone(value, deadzone) {
	const magnitude = Math.abs(finite(value));
	if (magnitude <= deadzone) return 0;
	const normalized = (magnitude - deadzone) / Math.max(0.0001, 1 - deadzone);
	return Math.sign(value) * clamp(normalized, 0, 1);
}

function resolveStatePriority(motion, attack) {
	const candidates = [];
	if (motion.state === 'hit-stagger' || motion.attackPhase === 'hit-stagger') candidates.push('hit-stagger');
	if (motion.state === 'guard-break' || motion.attackPhase === 'guard-break') candidates.push('guard-break');
	if (motion.state === 'parry' || motion.defenseResult === 'parry') candidates.push('parry');
	if (motion.state === 'dodge') candidates.push('dodge');
	if (attack.kind !== 'none' && motion.attackRemaining > 0) candidates.push(`attack-${attack.kind}`);
	if (motion.state === 'guard') candidates.push('guard');
	if (motion.state === 'sprint') candidates.push('sprint');
	if (!motion.isGrounded) candidates.push('airborne');
	if (motion.state === 'walk') candidates.push('walk');
	if (motion.state === 'exhausted') candidates.push('exhausted');
	candidates.push('idle');
	candidates.sort((left, right) => (ACTION_PRIORITY[right] ?? 0) - (ACTION_PRIORITY[left] ?? 0));
	return candidates[0] || 'idle';
}

function deriveTargetPoint(position, facing, target, config, focusScale, lockOn) {
	if (target) {
		const lead = target.lockOn || lockOn ? config.lockOnLeadMeters : config.targetLeadMeters;
		return Object.freeze({
			x: round(target.position.x + target.velocity.x * lead),
			y: round(target.position.y + 1.05 * focusScale),
			z: round(target.position.z + target.velocity.z * lead),
		});
	}
	return Object.freeze({
		x: round(position.x + facing.x * config.targetLeadMeters),
		y: round(position.y + config.defaultHeight * 0.42 * focusScale),
		z: round(position.z + facing.z * config.targetLeadMeters),
	});
}

function deriveShoulderTarget(position, facing, targetPoint, shoulderDirection, offset) {
	const sideX = facing.z * shoulderDirection;
	const sideZ = -facing.x * shoulderDirection;
	return Object.freeze({
		x: round(targetPoint.x + sideX * offset),
		y: round(targetPoint.y),
		z: round(targetPoint.z + sideZ * offset),
	});
}

function normalizeCollisionProbe(detail = {}) {
	if (!detail || detail.valid === false || detail.occluded === false && detail.distanceMeters === undefined) return null;
	if (!Number.isFinite(Number(detail.distanceMeters)) && !Number.isFinite(Number(detail.safeDistanceMeters))) return null;
	return Object.freeze({
		valid: detail.valid !== false,
		occluded: Boolean(detail.occluded),
		distanceMeters: nonNegative(detail.distanceMeters ?? detail.safeDistanceMeters, Number.POSITIVE_INFINITY),
		normal: Object.freeze({ x: unit(detail.normal?.x), y: unit(detail.normal?.y, 1), z: unit(detail.normal?.z) }),
		source: typeof detail.source === 'string' ? detail.source.slice(0, 48) : 'caller',
	});
}

function deterministicShake(seed, amplitude) {
	const a = Math.sin(seed * 12.9898) * 43758.5453;
	const b = Math.sin((seed + 17.31) * 78.233) * 12791.613;
	const c = Math.sin((seed + 41.7) * 39.425) * 947.713;
	const frac = (value) => value - Math.floor(value);
	return Object.freeze({
		x: round((frac(a) * 2 - 1) * amplitude),
		y: round((frac(b) * 2 - 1) * amplitude),
		z: round((frac(c) * 2 - 1) * amplitude),
	});
}

function feedbackWeight(feedback, ageSeconds, config) {
	if (!feedback || ageSeconds < 0 || ageSeconds > config.feedbackMemorySeconds) return 0;
	const base = feedback.outcome === 'critical' ? 1.0 : feedback.outcome === 'hit' ? 0.75 : feedback.outcome === 'guard-break' ? 0.9 : feedback.outcome === 'parry' ? 0.72 : feedback.outcome === 'dodge' ? 0.45 : feedback.outcome === 'hit-stagger' ? 0.8 : 0.55;
	return base * Math.exp(-ageSeconds * 5.5);
}

function buildEventRecord(kind, detail, clock) {
	return Object.freeze({
		kind,
		timeSeconds: round(clock),
		serial: Math.max(0, Math.floor(finite(detail?.serial))),
		phase: typeof detail?.phase === 'string' ? detail.phase : typeof detail?.outcome === 'string' ? detail.outcome : 'unknown',
	});
}

function makeSnapshot(state, config) {
	const motion = state.motion;
	const profile = PROFILE_TABLE[state.selectedState] ?? PROFILE_TABLE.idle;
	const targetPoint = deriveTargetPoint(motion.position, motion.facing, state.target, config, profile.focus, state.lockOnEnabled);
	const shoulderTarget = deriveShoulderTarget(
		motion.position,
		motion.facing,
		targetPoint,
		state.shoulderSign,
		(profile.shoulder ?? 1) * (state.selectedState.startsWith('attack-') || state.selectedState === 'guard' || state.selectedState === 'parry' ? config.combatShoulderOffsetMeters : config.shoulderOffsetMeters),
	);
	const now = state.clockSeconds;
	const targetAge = state.target ? Math.max(0, now - state.targetUpdatedAtSeconds) : Infinity;
	const signalAge = Math.max(0, now - state.lastSignalTimeSeconds);
	const staleTarget = !state.target || targetAge > config.targetMemorySeconds || state.target.visibility <= 0;
	const staleSignals = signalAge > config.signalStaleSeconds;
	const feedbackAge = state.lastFeedback ? Math.max(0, now - state.lastFeedbackTimeSeconds) : Infinity;
	const feedbackMagnitude = feedbackWeight(state.lastFeedback, feedbackAge, config);
	const collisionDistance = state.collisionProbe?.distanceMeters;
	const baseDistance = clamp(profile.distance, config.minDistance, config.maxDistance);
	const desiredDistance = clamp(
		state.selectedState === 'dodge' ? baseDistance - 0.45 : baseDistance - feedbackMagnitude * 0.22,
		config.minDistance,
		config.maxDistance,
	);
	const resolvedDistance = Number.isFinite(collisionDistance)
		? clamp(collisionDistance - config.collisionPaddingMeters, config.collisionMinDistanceMeters, desiredDistance)
		: desiredDistance;
	const shakeAmplitude = clamp(feedbackMagnitude * config.shakeMaxMeters, 0, config.shakeMaxMeters);
	const shakePhase = Math.floor(now * 60);
	const shake = deterministicShake(shakePhase + state.seed, shakeAmplitude);
	const pitchKick = round(feedbackMagnitude * config.shakeMaxRadians * (state.lastFeedback?.outcome === 'hit' ? -1 : 0.35));
	const yawKick = round(shake.x * config.shakeMaxRadians);
	return {
		version: VERSION,
		clockSeconds: round(now),
		state: state.selectedState,
		staleSignals,
		position: motion.position,
		facing: motion.facing,
		focusPoint: targetPoint,
		shoulderPoint: shoulderTarget,
		target: staleTarget ? null : state.target,
		lockOn: Object.freeze({ requested: state.lockOnEnabled, active: !staleTarget && state.lockOnEnabled, stale: staleTarget }),
		orientation: Object.freeze({
			yawRadians: round(state.yaw + yawKick),
			pitchRadians: clamp(round(state.pitch + pitchKick), config.pitchMinRadians, config.pitchMaxRadians),
		}),
		lens: Object.freeze({
			distanceMeters: round(resolvedDistance),
			desiredDistanceMeters: round(desiredDistance),
			heightMeters: round(state.height),
			fovDegrees: round(state.fov),
		}),
		collision: Object.freeze({
			available: Boolean(state.collisionProbe),
			occluded: Boolean(state.collisionProbe?.occluded),
			inputDistanceMeters: Number.isFinite(collisionDistance) ? round(collisionDistance) : null,
			paddingMeters: round(config.collisionPaddingMeters),
			resolvedDistanceMeters: round(resolvedDistance),
		}),
		feedback: Object.freeze({
			outcome: state.lastFeedback?.outcome ?? 'none',
			ageSeconds: Number.isFinite(feedbackAge) ? round(feedbackAge) : null,
			intensity: round(feedbackMagnitude),
			shakeMeters: shake,
		}),
		input: Object.freeze({
			lookX: round(state.lookX),
			lookY: round(state.lookY),
			shoulderSign: state.shoulderSign,
			device: state.device,
		}),
		recentEvents: Object.freeze(state.recentEvents.map((event) => Object.freeze({ ...event }))),
		readiness: Object.freeze({
			finite: true,
			cameraOwnerRequired: true,
			collisionProbeOptional: true,
			targetDiscoveryRequired: state.lockOnEnabled,
			inputParityReady: state.device !== 'unknown',
		}),
	};
}

export function createPlayerCombatCameraIntentDirector(options = {}) {
	const config = normalizeConfig(options);
	const eventTarget = options.eventTarget ?? globalThis;
	const state = {
		clockSeconds: 0,
		seed: Math.max(1, Math.floor(finite(options.seed, 17))),
		motion: normalizeMotion(options.initialMotion ?? {}),
		lastAttack: normalizeAttack(),
		lastFeedback: null,
		lastFeedbackTimeSeconds: -Infinity,
		lastSignalTimeSeconds: 0,
		target: null,
		targetUpdatedAtSeconds: -Infinity,
		collisionProbe: null,
		selectedState: 'idle',
		yaw: finite(options.initialYaw),
		pitch: clamp(finite(options.initialPitch), config.pitchMinRadians, config.pitchMaxRadians),
		distance: config.defaultDistance,
		height: config.defaultHeight,
		fov: config.defaultFov,
		shoulderSign: finite(options.shoulderSign, 1) < 0 ? -1 : 1,
		lookX: 0,
		lookY: 0,
		lockOnEnabled: Boolean(options.lockOnEnabled),
		device: typeof options.device === 'string' ? options.device : 'unknown',
		recentEvents: [],
		attached: false,
		disposed: false,
	};

	function assertActive() {
		if (state.disposed) throw new Error('PlayerCombatCameraIntentDirector disposed');
	}

	function rememberEvent(kind, detail) {
		state.recentEvents.push(buildEventRecord(kind, detail, state.clockSeconds));
		const cutoff = state.clockSeconds - config.maxEventAgeSeconds;
		state.recentEvents = state.recentEvents.filter((event) => event.timeSeconds >= cutoff).slice(-config.maxRecentEvents);
	}

	function consumeMotion(detail) {
		assertActive();
		state.motion = normalizeMotion(detail);
		state.lastSignalTimeSeconds = state.clockSeconds;
		state.selectedState = resolveStatePriority(state.motion, state.lastAttack);
		rememberEvent('motion', detail);
		return getSnapshot();
	}

	function consumeAttackWindow(detail) {
		assertActive();
		state.lastAttack = normalizeAttack(detail);
		state.lastSignalTimeSeconds = state.clockSeconds;
		state.selectedState = resolveStatePriority(state.motion, state.lastAttack);
		rememberEvent('attack', detail);
		return getSnapshot();
	}

	function consumeCombatFeedback(detail) {
		assertActive();
		state.lastFeedback = normalizeFeedback(detail);
		state.lastFeedbackTimeSeconds = state.clockSeconds;
		state.lastSignalTimeSeconds = state.clockSeconds;
		rememberEvent('feedback', detail);
		return getSnapshot();
	}

	function setDevice(device) {
		assertActive();
		state.device = device === 'keyboard' || device === 'mouse' || device === 'gamepad' || device === 'touch' || device === 'pwa' ? device : 'unknown';
	}

	function setLookInput(valueX, valueY) {
		assertActive();
		state.lookX = applyDeadzone(clamp(finite(valueX), -1, 1), config.deadzone);
		state.lookY = applyDeadzone(clamp(finite(valueY), -1, 1), config.deadzone);
	}

	function setTarget(detail) {
		assertActive();
		state.target = normalizeTarget(detail);
		state.targetUpdatedAtSeconds = state.clockSeconds;
	}

	function clearTarget() {
		assertActive();
		state.target = null;
		state.targetUpdatedAtSeconds = -Infinity;
	}

	function setShoulderSwap(value) {
		assertActive();
		if (typeof value === 'boolean') state.shoulderSign = value ? -1 : 1;
		else if (Number.isFinite(Number(value))) state.shoulderSign = Number(value) < 0 ? -1 : 1;
	}

	function setLockOnEnabled(value) {
		assertActive();
		state.lockOnEnabled = Boolean(value);
	}

	function setCollisionProbe(detail) {
		assertActive();
		state.collisionProbe = normalizeCollisionProbe(detail);
	}

	function update(deltaSeconds = 0, overrides = {}) {
		assertActive();
		const delta = clamp(finite(deltaSeconds), 0, config.maxDeltaSeconds);
		state.clockSeconds += delta;
		if (overrides.motion) consumeMotion(overrides.motion);
		if (overrides.attackWindow) consumeAttackWindow(overrides.attackWindow);
		if (overrides.combatFeedback) consumeCombatFeedback(overrides.combatFeedback);
		if (overrides.target !== undefined) setTarget(overrides.target);
		if (overrides.collisionProbe !== undefined) setCollisionProbe(overrides.collisionProbe);
		if (overrides.lookInput) setLookInput(overrides.lookInput.x, overrides.lookInput.y);
		const profile = PROFILE_TABLE[state.selectedState] ?? PROFILE_TABLE.idle;
		const targetYaw = Math.atan2(state.motion.facing.x, state.motion.facing.z);
		state.yaw = smoothAngle(state.yaw, targetYaw + state.lookX * config.lookSensitivity, config.yawResponse, delta);
		const targetPitch = clamp(-state.lookY * 0.42, config.pitchMinRadians, config.pitchMaxRadians);
		state.pitch = expApproach(state.pitch, targetPitch, config.pitchResponse, delta);
		state.distance = expApproach(state.distance, clamp(profile.distance, config.minDistance, config.maxDistance), config.distanceResponse, delta);
		state.height = expApproach(state.height, clamp(profile.height, config.minHeight, config.maxHeight), config.heightResponse, delta);
		state.fov = expApproach(state.fov, clamp(profile.fov, config.minFov, config.maxFov), config.fovResponse, delta);
		state.selectedState = resolveStatePriority(state.motion, state.lastAttack);
		state.recentEvents = state.recentEvents.filter((event) => state.clockSeconds - event.timeSeconds <= config.maxEventAgeSeconds).slice(-config.maxRecentEvents);
		return getSnapshot();
	}

	function getSnapshot() {
		assertActive();
		const raw = makeSnapshot(state, config);
		const digest = hashString(stableStringify(raw));
		return Object.freeze({
			...raw,
			configVersion: VERSION,
			digest,
		});
	}

	function stepAndPublish(deltaSeconds = 0, overrides = {}) {
		const snapshot = update(deltaSeconds, overrides);
		if (typeof eventTarget?.dispatchEvent === 'function' && typeof eventTarget?.CustomEvent === 'function') {
			eventTarget.dispatchEvent(new eventTarget.CustomEvent(CAMERA_INTENT_EVENT, { detail: snapshot }));
		}
		return snapshot;
	}

	function attach() {
		assertActive();
		if (state.attached || typeof eventTarget?.addEventListener !== 'function') return getSnapshot();
		state.attached = true;
		state.onMotion = (event) => consumeMotion(event?.detail);
		state.onAttack = (event) => consumeAttackWindow(event?.detail);
		state.onFeedback = (event) => consumeCombatFeedback(event?.detail);
		eventTarget.addEventListener(MOTION_EVENT, state.onMotion);
		eventTarget.addEventListener(ATTACK_EVENT, state.onAttack);
		eventTarget.addEventListener(FEEDBACK_EVENT, state.onFeedback);
		return getSnapshot();
	}

	function detach() {
		if (!state.attached || typeof eventTarget?.removeEventListener !== 'function') return;
		eventTarget.removeEventListener(MOTION_EVENT, state.onMotion);
		eventTarget.removeEventListener(ATTACK_EVENT, state.onAttack);
		eventTarget.removeEventListener(FEEDBACK_EVENT, state.onFeedback);
		state.attached = false;
	}

	function reset() {
		assertActive();
		state.clockSeconds = 0;
		state.lastAttack = normalizeAttack();
		state.lastFeedback = null;
		state.lastFeedbackTimeSeconds = -Infinity;
		state.lastSignalTimeSeconds = 0;
		state.target = null;
		state.targetUpdatedAtSeconds = -Infinity;
		state.collisionProbe = null;
		state.selectedState = 'idle';
		state.yaw = 0;
		state.pitch = 0;
		state.distance = config.defaultDistance;
		state.height = config.defaultHeight;
		state.fov = config.defaultFov;
		state.lookX = 0;
		state.lookY = 0;
		state.recentEvents = [];
		return getSnapshot();
	}

	function dispose() {
		if (state.disposed) return;
		detach();
		state.disposed = true;
	}

	return Object.freeze({
		version: VERSION,
		config,
		consumeMotion,
		consumeAttackWindow,
		consumeCombatFeedback,
		setDevice,
		setLookInput,
		setTarget,
		clearTarget,
		setShoulderSwap,
		setLockOnEnabled,
		setCollisionProbe,
		update,
		stepAndPublish,
		getSnapshot,
		attach,
		detach,
		reset,
		dispose,
	});
}

export const PLAYER_COMBAT_CAMERA_INTENT_EVENT = CAMERA_INTENT_EVENT;
export const PLAYER_COMBAT_CAMERA_INTENT_VERSION = VERSION;
export const PLAYER_COMBAT_CAMERA_INTENT_DEFAULT_CONFIG = DEFAULT_CONFIG;
export const __testing = Object.freeze({
	DEFAULT_CONFIG,
	PROFILE_TABLE,
	normalizeMotion,
	normalizeAttack,
	normalizeFeedback,
	normalizeTarget,
	normalizeCollisionProbe,
	normalizeConfig,
	stableStringify,
	hashString,
	expApproach,
	smoothAngle,
	applyDeadzone,
	resolveStatePriority,
	deriveTargetPoint,
	deriveShoulderTarget,
	feedbackWeight,
});
