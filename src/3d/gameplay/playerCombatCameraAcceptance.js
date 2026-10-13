/**
 * Kızıl Ufuk — deterministic acceptance/evidence projection for combat camera intent.
 *
 * Read-only by design. It accepts already-produced camera intent snapshots and turns them into a
 * bounded evidence record suitable for executable regression and browser evidence collectors.
 * It does not instantiate cameras, touch DOM, inspect assets, create geometry, or own world state.
 *
 * @module gameplay/playerCombatCameraAcceptance
 */

const VERSION = 1;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, precision = 4) => {
	const factor = 10 ** precision;
	return Math.round(finite(value) * factor) / factor;
};
const bool = (value) => Boolean(value);

const REQUIRED_STATES = Object.freeze([
	'idle', 'walk', 'sprint', 'guard', 'parry', 'dodge', 'attack-light', 'attack-heavy', 'guard-break', 'hit-stagger',
]);

function stableStringify(value) {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'string') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
	let hash = 2166136261;
	const source = stableStringify(value);
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function finiteVector(point) {
	return Boolean(point) && [point.x, point.y, point.z].every((value) => Number.isFinite(Number(value)));
}

function summarizeIntent(intent) {
	return Object.freeze({
		version: finite(intent?.version),
		state: typeof intent?.state === 'string' ? intent.state : 'invalid',
		clockSeconds: round(intent?.clockSeconds),
		positionFinite: finiteVector(intent?.position),
		focusFinite: finiteVector(intent?.focusPoint),
		shoulderFinite: finiteVector(intent?.shoulderPoint),
		targetFinite: intent?.target === null ? true : finiteVector(intent?.target?.position),
		yawFinite: Number.isFinite(Number(intent?.orientation?.yawRadians)),
		pitchFinite: Number.isFinite(Number(intent?.orientation?.pitchRadians)),
		distanceMeters: round(intent?.lens?.distanceMeters, 3),
		desiredDistanceMeters: round(intent?.lens?.desiredDistanceMeters, 3),
		heightMeters: round(intent?.lens?.heightMeters, 3),
		fovDegrees: round(intent?.lens?.fovDegrees, 3),
		collisionAvailable: bool(intent?.collision?.available),
		collisionOccluded: bool(intent?.collision?.occluded),
		lockOnRequested: bool(intent?.lockOn?.requested),
		lockOnActive: bool(intent?.lockOn?.active),
		feedbackOutcome: typeof intent?.feedback?.outcome === 'string' ? intent.feedback.outcome : 'none',
		feedbackIntensity: clamp(intent?.feedback?.intensity, 0, 1),
		inputDevice: typeof intent?.input?.device === 'string' ? intent.input.device : 'unknown',
	});
}

function validateState(snapshot, expectedState) {
	return Boolean(snapshot && REQUIRED_STATES.includes(snapshot.state) && (!expectedState || snapshot.state === expectedState));
}

function validateLens(snapshot) {
	const distance = snapshot?.lens?.distanceMeters;
	const height = snapshot?.lens?.heightMeters;
	const fov = snapshot?.lens?.fovDegrees;
	return Number.isFinite(distance) && distance >= 0.5 && distance <= 50
		&& Number.isFinite(height) && height >= -10 && height <= 20
		&& Number.isFinite(fov) && fov >= 35 && fov <= 110;
}

function validateOrientation(snapshot) {
	const yaw = snapshot?.orientation?.yawRadians;
	const pitch = snapshot?.orientation?.pitchRadians;
	return Number.isFinite(yaw) && Number.isFinite(pitch) && pitch > -Math.PI / 2 && pitch < Math.PI / 2;
}

function validateFeedback(snapshot) {
	const shake = snapshot?.feedback?.shakeMeters ?? {};
	return Number.isFinite(shake.x) && Number.isFinite(shake.y) && Number.isFinite(shake.z)
		&& Math.hypot(shake.x, shake.y, shake.z) < 1
		&& Number.isFinite(snapshot?.feedback?.intensity)
		&& snapshot.feedback.intensity >= 0
		&& snapshot.feedback.intensity <= 1;
}

function validateCollision(snapshot) {
	if (!snapshot?.collision?.available) return true;
	return (!snapshot.collision.occluded || Number.isFinite(snapshot.collision.resolvedDistanceMeters))
		&& Number.isFinite(snapshot.collision.paddingMeters)
		&& snapshot.collision.paddingMeters >= 0;
}

function validateTarget(snapshot) {
	if (snapshot?.target === null || snapshot?.target === undefined) return true;
	return finiteVector(snapshot.target.position)
		&& Number.isFinite(snapshot.target.visibility)
		&& snapshot.target.visibility >= 0
		&& snapshot.target.visibility <= 1;
}

function buildRiskLedger(snapshot) {
	const rows = [
		['P0_NONFINITE_POSITION', !snapshot.positionFinite],
		['P0_NONFINITE_FOCUS', !snapshot.focusFinite],
		['P0_NONFINITE_SHOULDER', !snapshot.shoulderFinite],
		['P1_INVALID_ORIENTATION', !snapshot.orientationValid],
		['P1_INVALID_LENS', !snapshot.lensValid],
		['P2_INVALID_FEEDBACK', !snapshot.feedbackValid],
		['P2_INVALID_COLLISION', !snapshot.collisionValid],
		['P3_INVALID_TARGET', !snapshot.targetValid],
		['P4_STALE_SIGNALS', snapshot.staleSignals],
		['P4_STALE_LOCK_ON', snapshot.lockOn?.requested && snapshot.lockOn?.stale],
	];
	return Object.freeze(rows.filter(([, breached]) => breached).map(([code]) => code));
}

export function evaluatePlayerCombatCameraIntent(intent, options = {}) {
	const summary = summarizeIntent(intent);
	const lensValid = validateLens(intent);
	const orientationValid = validateOrientation(intent);
	const feedbackValid = validateFeedback(intent);
	const collisionValid = validateCollision(intent);
	const targetValid = validateTarget(intent);
	const stateValid = validateState(intent, options.expectedState);
	const expectedVersionValid = summary.version === VERSION;
	const staleSignals = bool(intent?.staleSignals);
	const evaluated = Object.freeze({
		...summary,
		stateValid,
		expectedVersionValid,
		lensValid,
		orientationValid,
		feedbackValid,
		collisionValid,
		targetValid,
		staleSignals,
		lockOn: intent?.lockOn ?? Object.freeze({ requested: false, active: false, stale: false }),
	});
	const riskCodes = buildRiskLedger(evaluated);
	const accepted = stateValid && expectedVersionValid && lensValid && orientationValid && feedbackValid && collisionValid && targetValid && riskCodes.length === 0;
	const evidence = Object.freeze({
		version: VERSION,
		accepted,
		state: summary.state,
		clockSeconds: summary.clockSeconds,
		riskCodes,
		metrics: Object.freeze({
			positionFinite: Number(summary.positionFinite),
			focusFinite: Number(summary.focusFinite),
			shoulderFinite: Number(summary.shoulderFinite),
			targetFinite: Number(summary.targetFinite),
			distanceMeters: summary.distanceMeters,
			fovDegrees: summary.fovDegrees,
			feedbackIntensity: summary.feedbackIntensity,
		}),
		ownership: Object.freeze({
			cameraMutation: false,
			targetDiscovery: false,
			worldMutation: false,
			assetMutation: false,
		}),
		boundary: Object.freeze({
			editorMaterialStudioImported: false,
			primitiveGeometryCreated: false,
			secondCameraFramework: false,
		}),
		digest: digest({
			accepted,
			state: summary.state,
			riskCodes,
			metrics: {
				distanceMeters: summary.distanceMeters,
				fovDegrees: summary.fovDegrees,
				feedbackIntensity: summary.feedbackIntensity,
			},
		}),
	});
	return evidence;
}

export function evaluateCameraSequence(snapshots, options = {}) {
	const rows = Array.isArray(snapshots) ? snapshots.slice(0, Math.max(0, Math.floor(finite(options.maxFrames, 64)))) : [];
	const evidence = rows.map((snapshot) => evaluatePlayerCombatCameraIntent(snapshot));
	const invalid = evidence.filter((row) => !row.accepted);
	const states = [...new Set(evidence.map((row) => row.state))].sort();
	const digestInput = evidence.map((row) => ({ accepted: row.accepted, state: row.state, riskCodes: row.riskCodes, digest: row.digest }));
	return Object.freeze({
		version: VERSION,
		frameCount: evidence.length,
		acceptedFrames: evidence.length - invalid.length,
		invalidFrames: invalid.length,
		states: Object.freeze(states),
		riskCodes: Object.freeze([...new Set(invalid.flatMap((row) => row.riskCodes))].sort()),
		firstInvalidIndex: invalid.length > 0 ? evidence.findIndex((row) => !row.accepted) : -1,
		digest: digest(digestInput),
		frames: Object.freeze(evidence),
	});
}

export function assertPlayerCombatCameraEvidence(intent, options = {}) {
	const evidence = evaluatePlayerCombatCameraIntent(intent, options);
	if (!evidence.accepted) {
		throw new Error(`PLAYER_COMBAT_CAMERA_ACCEPTANCE_FAILED state=${evidence.state} risks=${evidence.riskCodes.join(',') || 'unknown'}`);
	}
	return evidence;
}

export const PLAYER_COMBAT_CAMERA_ACCEPTANCE_VERSION = VERSION;
export const __testing = Object.freeze({
	stableStringify,
	digest,
	finiteVector,
	summarizeIntent,
	validateState,
	validateLens,
	validateOrientation,
	validateFeedback,
	validateCollision,
	validateTarget,
	buildRiskLedger,
});
