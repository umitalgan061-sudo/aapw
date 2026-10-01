/**
 * Kızıl Ufuk — public camera-intent contract manifest.
 *
 * One small declarative source for the event names, versions, ownership boundaries and observable
 * fields shared by the director, acceptance scripts and the existing runtime camera owner. Keeping
 * this vocabulary centralized avoids silently introducing another player/camera framework.
 *
 * This module contains no Three.js imports, DOM APIs, scene writes or asset paths.
 * @module gameplay/playerCombatCameraContract
 */

export const PLAYER_CAMERA_CONTRACT_VERSION = 1;

export const PLAYER_CAMERA_EVENTS = Object.freeze({
	MOTION: 'aapw:player-motion',
	ATTACK_WINDOW: 'aapw:player-attack-window',
	COMBAT_FEEDBACK: 'aapw:player-combat-feedback',
	CAMERA_INTENT: 'aapw:player-camera-intent',
});

export const PLAYER_CAMERA_OWNERSHIP = Object.freeze({
	PLAYER_STATE: 'src/3d/gameplay/player.js',
	CAMERA_OWNER: 'src/3d/camera.js + src/3d/game3d.js',
	WORLD_COLLISION: 'caller-owned world/terrain collider',
	TARGET_DISCOVERY: 'caller-owned lock-on/interaction source',
	MATERIAL_PLACEMENT: 'src/3d/materials/MaterialAssignmentCore.js + src/3d/world/WorldAssetPlacementPipeline.js',
	EDITOR_MATERIAL_UI: 'forbidden in runtime gameplay modules',
});

export const PLAYER_CAMERA_STATES = Object.freeze([
	'idle',
	'walk',
	'sprint',
	'exhausted',
	'airborne',
	'guard',
	'parry',
	'dodge',
	'guard-break',
	'hit-stagger',
	'attack-light',
	'attack-heavy',
]);

export const PLAYER_CAMERA_INPUT_FAMILIES = Object.freeze(['keyboard', 'mouse', 'gamepad', 'touch', 'pwa', 'unknown']);

export const PLAYER_CAMERA_FIELD_LIMITS = Object.freeze({
	minPitchRadians: -0.34,
	maxPitchRadians: 0.48,
	minFovDegrees: 48,
	maxFovDegrees: 72,
	minDistanceMeters: 1.4,
	maxDistanceMeters: 9.5,
	maxFeedbackIntensity: 1,
	maxShakeMeters: 0.18,
	maxRecentEvents: 16,
});

function finite(value) {
	return Number.isFinite(Number(value));
}

function pointValid(point) {
	return Boolean(point) && finite(point.x) && finite(point.y) && finite(point.z);
}

export function validatePlayerCameraIntentContract(intent) {
	const stateValid = PLAYER_CAMERA_STATES.includes(intent?.state);
	const versionValid = intent?.version === PLAYER_CAMERA_CONTRACT_VERSION;
	const positionValid = pointValid(intent?.position);
	const focusValid = pointValid(intent?.focusPoint);
	const shoulderValid = pointValid(intent?.shoulderPoint);
	const orientationValid = finite(intent?.orientation?.yawRadians)
		&& finite(intent?.orientation?.pitchRadians)
		&& intent.orientation.pitchRadians >= -Math.PI / 2
		&& intent.orientation.pitchRadians <= Math.PI / 2;
	const lensValid = finite(intent?.lens?.distanceMeters)
		&& intent.lens.distanceMeters >= 0.5
		&& finite(intent?.lens?.heightMeters)
		&& finite(intent?.lens?.fovDegrees)
		&& intent.lens.fovDegrees >= 35
		&& intent.lens.fovDegrees <= 110;
	const feedbackValid = finite(intent?.feedback?.intensity)
		&& intent.feedback.intensity >= 0
		&& intent.feedback.intensity <= PLAYER_CAMERA_FIELD_LIMITS.maxFeedbackIntensity
		&& pointValid(intent?.feedback?.shakeMeters);
	const ownershipValid = intent?.readiness?.cameraOwnerRequired === true;
	return Object.freeze({
		valid: stateValid && versionValid && positionValid && focusValid && shoulderValid && orientationValid && lensValid && feedbackValid && ownershipValid,
		stateValid,
		versionValid,
		positionValid,
		focusValid,
		shoulderValid,
		orientationValid,
		lensValid,
		feedbackValid,
		ownershipValid,
	});
}

export function buildCameraContractManifest() {
	return Object.freeze({
		version: PLAYER_CAMERA_CONTRACT_VERSION,
		events: PLAYER_CAMERA_EVENTS,
		states: PLAYER_CAMERA_STATES,
		inputFamilies: PLAYER_CAMERA_INPUT_FAMILIES,
		fieldLimits: PLAYER_CAMERA_FIELD_LIMITS,
		ownership: PLAYER_CAMERA_OWNERSHIP,
		assetAdded: false,
		assetOverwritten: false,
		materialUiImported: false,
		secondCameraFramework: false,
		worldMutation: false,
	});
}

export function assertCameraContractManifest(manifest = buildCameraContractManifest()) {
	if (manifest.version !== PLAYER_CAMERA_CONTRACT_VERSION) throw new Error('camera contract version mismatch');
	if (manifest.events.CAMERA_INTENT !== PLAYER_CAMERA_EVENTS.CAMERA_INTENT) throw new Error('camera intent event mismatch');
	if (manifest.ownership.CAMERA_OWNER !== PLAYER_CAMERA_OWNERSHIP.CAMERA_OWNER) throw new Error('camera owner mismatch');
	if (manifest.materialUiImported || manifest.secondCameraFramework || manifest.worldMutation || manifest.assetOverwritten) throw new Error('camera contract ownership violation');
	return true;
}

export const __testing = Object.freeze({ finite, pointValid });
