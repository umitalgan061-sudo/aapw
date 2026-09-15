/**
 * Kızıl Ufuk — runtime bridge from camera intent to the existing camera owner.
 *
 * This file is intentionally an adapter, not a camera framework. It converts a frozen
 * PlayerCombatCameraIntentDirector snapshot into caller-owned values that can be applied by the
 * already-shipped `camera.js` / `game3d.js` owner. The adapter never constructs OrbitControls,
 * never owns a camera, never discovers targets, and never creates geometry.
 *
 * `resolveCameraCollision` is injected by default from the existing camera module so wall/terrain
 * avoidance remains centralized. The adapter can also accept a caller-provided collision result,
 * which keeps unit tests DOM-free and lets world/environment agents own the actual collidables.
 *
 * @module gameplay/playerCombatCameraRuntimeAdapter
 */

import { resolveCameraCollision } from '../camera.js';

const VERSION = 1;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, precision = 4) => {
	const factor = 10 ** precision;
	return Math.round(finite(value) * factor) / factor;
};

function normalizePoint(point) {
	return Object.freeze({ x: round(point?.x), y: round(point?.y), z: round(point?.z) });
}

function normalizeIntent(intent) {
	if (!intent || typeof intent !== 'object') throw new TypeError('camera intent is required');
	if (intent.version !== 1) throw new RangeError('unsupported camera intent version');
	return intent;
}

export function buildCameraTargetTransform(intentInput) {
	const intent = normalizeIntent(intentInput);
	const point = normalizePoint(intent.shoulderPoint ?? intent.focusPoint ?? intent.position);
	return Object.freeze({
		position: point,
		yawRadians: round(intent.orientation?.yawRadians),
		pitchRadians: round(intent.orientation?.pitchRadians),
	});
}

export function buildCameraLensState(intentInput) {
	const intent = normalizeIntent(intentInput);
	const lens = intent.lens ?? {};
	return Object.freeze({
		distanceMeters: Math.max(0.1, round(lens.distanceMeters, 3)),
		heightMeters: round(lens.heightMeters, 3),
		fovDegrees: clamp(lens.fovDegrees, 35, 110),
	});
}

export function buildCameraFeedbackOffset(intentInput) {
	const intent = normalizeIntent(intentInput);
	const shake = intent.feedback?.shakeMeters ?? {};
	return Object.freeze({
		xMeters: round(shake.x, 4),
		yMeters: round(shake.y, 4),
		zMeters: round(shake.z, 4),
		intensity: clamp(intent.feedback?.intensity, 0, 1),
	});
}

export function resolveCameraPlacement({
	intent,
	target,
	desiredPosition,
	raycaster = null,
	collidables = [],
	marginMeters = 0.18,
	minDistanceMeters = 1.4,
	collisionResolver = resolveCameraCollision,
}) {
	const normalized = normalizeIntent(intent);
	const targetPoint = normalizePoint(target ?? normalized.shoulderPoint ?? normalized.focusPoint ?? normalized.position);
	const desired = normalizePoint(desiredPosition ?? normalized.position);
	if (!raycaster || !Array.isArray(collidables) || collidables.length === 0 || typeof collisionResolver !== 'function') {
		return Object.freeze({
			position: desired,
			resolved: false,
			occluded: false,
			distanceMeters: round(normalized.lens?.distanceMeters ?? 0, 3),
		});
	}
	const THREEVector3 = desiredPosition?.constructor;
	if (typeof THREEVector3 !== 'function') {
		return Object.freeze({ position: desired, resolved: false, occluded: false, distanceMeters: 0 });
	}
	try {
		const targetVector = new THREEVector3(targetPoint.x, targetPoint.y, targetPoint.z);
		const desiredVector = new THREEVector3(desired.x, desired.y, desired.z);
		const resolvedVector = collisionResolver(raycaster, targetVector, desiredVector, collidables, marginMeters, minDistanceMeters);
		const distanceMeters = targetVector.distanceTo(resolvedVector);
		return Object.freeze({
			position: Object.freeze({ x: round(resolvedVector.x, 3), y: round(resolvedVector.y, 3), z: round(resolvedVector.z, 3) }),
			resolved: resolvedVector !== desiredVector,
			occluded: resolvedVector !== desiredVector,
			distanceMeters: round(distanceMeters, 3),
		});
	} catch (error) {
		return Object.freeze({
			position: desired,
			resolved: false,
			occluded: false,
			distanceMeters: round(normalized.lens?.distanceMeters ?? 0, 3),
			error: error instanceof Error ? error.message.slice(0, 120) : 'collision-failed',
		});
	}
}

export function buildOrbitApplicationPlan(intentInput, options = {}) {
	const intent = normalizeIntent(intentInput);
	const transform = buildCameraTargetTransform(intent);
	const lens = buildCameraLensState(intent);
	const feedback = buildCameraFeedbackOffset(intent);
	const target = normalizePoint(options.target ?? transform.position);
	const eyeDirection = {
		x: Math.sin(transform.yawRadians) * Math.cos(transform.pitchRadians),
		y: Math.sin(transform.pitchRadians),
		z: Math.cos(transform.yawRadians) * Math.cos(transform.pitchRadians),
	};
	const shoulderSign = finite(intent.input?.shoulderSign, 1) < 0 ? -1 : 1;
	const desiredPosition = {
		x: target.x - eyeDirection.x * lens.distanceMeters + feedback.xMeters,
		y: target.y + lens.heightMeters - eyeDirection.y * lens.distanceMeters + feedback.yMeters,
		z: target.z - eyeDirection.z * lens.distanceMeters + feedback.zMeters,
	};
	const placement = resolveCameraPlacement({
		intent,
		target,
		desiredPosition: options.desiredPositionVector ?? desiredPosition,
		raycaster: options.raycaster,
		collidables: options.collidables,
		marginMeters: finite(options.marginMeters, 0.18),
		minDistanceMeters: finite(options.minDistanceMeters, 1.4),
		collisionResolver: options.collisionResolver ?? resolveCameraCollision,
	});
	return Object.freeze({
		version: VERSION,
		state: intent.state,
		focusPoint: normalizePoint(intent.focusPoint),
		shoulderPoint: normalizePoint(intent.shoulderPoint),
		target,
		eye: Object.freeze({ x: round(eyeDirection.x), y: round(eyeDirection.y), z: round(eyeDirection.z) }),
		desiredPosition: Object.freeze({ x: round(desiredPosition.x, 3), y: round(desiredPosition.y, 3), z: round(desiredPosition.z, 3) }),
		resolvedPosition: placement.position,
		lens,
		feedback,
		shoulderSign,
		lockOn: intent.lockOn,
		collision: placement,
		cameraOwner: 'existing-camera-owner',
		mutatesCamera: false,
	});
}

export function createPlayerCombatCameraRuntimeAdapter(options = {}) {
	const config = Object.freeze({
		marginMeters: clamp(options.marginMeters, 0, 2),
		minDistanceMeters: clamp(options.minDistanceMeters, 0.5, 10),
	});
	let disposed = false;
	let lastPlan = null;

	function assertActive() {
		if (disposed) throw new Error('PlayerCombatCameraRuntimeAdapter disposed');
	}

	function plan(intent, context = {}) {
		assertActive();
		lastPlan = buildOrbitApplicationPlan(intent, {
			...context,
			marginMeters: context.marginMeters ?? config.marginMeters,
			minDistanceMeters: context.minDistanceMeters ?? config.minDistanceMeters,
		});
		return lastPlan;
	}

	function getPlan() {
		assertActive();
		return lastPlan;
	}

	function reset() {
		assertActive();
		lastPlan = null;
	}

	function dispose() {
		disposed = true;
		lastPlan = null;
	}

	return Object.freeze({ version: VERSION, config, plan, getPlan, reset, dispose });
}

export const __testing = Object.freeze({ normalizePoint, normalizeIntent });
