import assert from 'node:assert/strict';
import {
	PLAYER_CAMERA_CONTRACT_VERSION,
	PLAYER_CAMERA_EVENTS,
	PLAYER_CAMERA_OWNERSHIP,
	PLAYER_CAMERA_STATES,
	PLAYER_CAMERA_INPUT_FAMILIES,
	PLAYER_CAMERA_FIELD_LIMITS,
	validatePlayerCameraIntentContract,
	buildCameraContractManifest,
	assertCameraContractManifest,
} from '../src/3d/gameplay/playerCombatCameraContract.js';
import { createPlayerCombatCameraIntentDirector } from '../src/3d/gameplay/playerCombatCameraIntentDirector.js';

assert.equal(PLAYER_CAMERA_CONTRACT_VERSION, 1);
assert.equal(PLAYER_CAMERA_EVENTS.MOTION, 'aapw:player-motion');
assert.equal(PLAYER_CAMERA_EVENTS.ATTACK_WINDOW, 'aapw:player-attack-window');
assert.equal(PLAYER_CAMERA_EVENTS.COMBAT_FEEDBACK, 'aapw:player-combat-feedback');
assert.equal(PLAYER_CAMERA_EVENTS.CAMERA_INTENT, 'aapw:player-camera-intent');
assert.equal(PLAYER_CAMERA_OWNERSHIP.CAMERA_OWNER, 'src/3d/camera.js + src/3d/game3d.js');
assert.equal(PLAYER_CAMERA_OWNERSHIP.EDITOR_MATERIAL_UI, 'forbidden in runtime gameplay modules');
assert.equal(PLAYER_CAMERA_STATES.length, 12);
assert.equal(PLAYER_CAMERA_INPUT_FAMILIES.includes('pwa'), true);
assert.equal(PLAYER_CAMERA_FIELD_LIMITS.maxFeedbackIntensity, 1);
assert.equal(PLAYER_CAMERA_FIELD_LIMITS.maxRecentEvents, 16);

const manifest = buildCameraContractManifest();
assert.equal(assertCameraContractManifest(manifest), true);
assert.equal(manifest.assetAdded, false);
assert.equal(manifest.assetOverwritten, false);
assert.equal(manifest.materialUiImported, false);
assert.equal(manifest.secondCameraFramework, false);
assert.equal(manifest.worldMutation, false);

const director = createPlayerCombatCameraIntentDirector({ device: 'keyboard' });
const intent = director.getSnapshot();
const validation = validatePlayerCameraIntentContract(intent);
assert.equal(validation.valid, true);
assert.equal(validation.versionValid, true);
assert.equal(validation.positionValid, true);
assert.equal(validation.focusValid, true);
assert.equal(validation.shoulderValid, true);
assert.equal(validation.orientationValid, true);
assert.equal(validation.lensValid, true);
assert.equal(validation.feedbackValid, true);
assert.equal(validation.ownershipValid, true);
director.dispose();

const tampered = { ...intent, version: 2 };
assert.equal(validatePlayerCameraIntentContract(tampered).versionValid, false);

console.log('PLAYER_COMBAT_CAMERA_CONTRACT_OK checks=34');
