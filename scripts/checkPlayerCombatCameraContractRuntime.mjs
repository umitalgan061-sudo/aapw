import assert from 'node:assert/strict';
import { createPlayerCombatCameraIntentDirector, PLAYER_COMBAT_CAMERA_INTENT_EVENT } from '../src/3d/gameplay/playerCombatCameraIntentDirector.js';
import { createPlayerCombatCameraRuntimeAdapter, buildOrbitApplicationPlan } from '../src/3d/gameplay/playerCombatCameraRuntimeAdapter.js';
import { evaluatePlayerCombatCameraIntent, evaluateCameraSequence } from '../src/3d/gameplay/playerCombatCameraAcceptance.js';
import { normalizePlayerCameraLookInput, buildCameraInputParityFrame, cameraInputParitySummary } from '../src/3d/gameplay/playerCombatCameraInputParity.js';
import { createCameraIntentRecorder, createCameraIntentReplay, replayWithDirector, compareCameraReplayResults } from '../src/3d/gameplay/playerCombatCameraReplayContract.js';

const failures = [];
let checks = 0;
const check = (name, fn) => { checks += 1; try { fn(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); } };
const playerMotion = (state) => ({ state, position: { x: 4, y: 0, z: 7 }, facing: { x: 0, z: 1 }, speedMps: state === 'sprint' ? 8.2 : 2, staminaRatio: 0.8, poiseRatio: 0.9, isGrounded: state !== 'airborne', attackRemaining: state.startsWith('attack-') ? 0.42 : 0, attackKind: state === 'attack-heavy' ? 'heavy' : state === 'attack-light' ? 'light' : 'none', attackPhase: state.startsWith('attack-') ? 'active' : 'none' });
const attack = (kind, serial = 1) => ({ serial, kind, comboStep: kind === 'heavy' ? 2 : 1, phase: 'active', active: true, reachMeters: kind === 'heavy' ? 2.05 : 1.65, damageScale: kind === 'heavy' ? 1.65 : 1, position: { x: 4, y: 0, z: 7 }, facing: { x: 0, z: 1 } });

check('event publication is received by an external owner', () => {
	const target = new EventTarget();
	let count = 0;
	target.addEventListener(PLAYER_COMBAT_CAMERA_INTENT_EVENT, (event) => { count += 1; assert.equal(event.detail.readiness.cameraOwnerRequired, true); });
	const director = createPlayerCombatCameraIntentDirector({ eventTarget: target, device: 'keyboard' });
	director.stepAndPublish(1 / 60, { motion: playerMotion('walk') });
	director.stepAndPublish(1 / 60, { motion: playerMotion('guard') });
	assert.equal(count, 2);
	director.dispose();
});

check('runtime bridge follows a full movement to combat sequence', () => {
	const director = createPlayerCombatCameraIntentDirector({ seed: 71, device: 'gamepad' });
	const adapter = createPlayerCombatCameraRuntimeAdapter();
	const snapshots = [];
	for (const state of ['idle', 'walk', 'sprint', 'guard', 'attack-heavy', 'hit-stagger']) {
		director.consumeMotion(playerMotion(state));
		if (state === 'attack-heavy') director.consumeAttackWindow(attack('heavy'));
		snapshots.push(director.update(0.016));
	}
	const sequence = evaluateCameraSequence(snapshots);
	assert.equal(sequence.invalidFrames, 0);
	for (const snapshot of snapshots) assert.equal(adapter.plan(snapshot).mutatesCamera, false);
	assert.ok(adapter.getPlan());
	adapter.dispose(); director.dispose();
});

check('input parity feeds equivalent PWA and gamepad intent vocabulary', () => {
	const pwa = normalizePlayerCameraLookInput('pwa', { x: 0.61, y: -0.2 });
	const pad = normalizePlayerCameraLookInput('gamepad', { x: 0.61, y: -0.2 });
	assert.equal(pwa.family, 'pwa');
	assert.equal(pad.family, 'gamepad');
	assert.ok(Math.abs(pwa.x - pad.x) < 0.001);
	const frames = [
		buildCameraInputParityFrame({ source: 'pwa', payload: { x: 0.61, y: -0.2 }, shoulder: 'right' }),
		buildCameraInputParityFrame({ source: 'gamepad', payload: { x: 0.61, y: -0.2 }, shoulder: 'right' }),
	];
	assert.equal(cameraInputParitySummary(frames).parityReady, true);
});

check('replay contract survives mixed combat feedback and target frames', () => {
	const recorder = createCameraIntentRecorder({ maxFrames: 50 });
	recorder.record({ deltaSeconds: 0.016, motion: playerMotion('walk') });
	recorder.record({ deltaSeconds: 0.016, motion: playerMotion('guard'), target: { id: 'target-a', position: { x: 8, y: 0, z: 4 }, visibility: 1, lockOn: true } });
	recorder.record({ deltaSeconds: 0.016, motion: playerMotion('attack-heavy'), attackWindow: attack('heavy', 2), target: { id: 'target-a', position: { x: 8, y: 0, z: 4 }, visibility: 1, lockOn: true } });
	recorder.record({ deltaSeconds: 0.016, combatFeedback: { serial: 3, outcome: 'critical', rawAmount: 40, appliedAmount: 40, blockedAmount: 0 } });
	const replay = createCameraIntentReplay(recorder.snapshot().frames);
	const aDirector = createPlayerCombatCameraIntentDirector({ seed: 88, lockOnEnabled: true });
	const bDirector = createPlayerCombatCameraIntentDirector({ seed: 88, lockOnEnabled: true });
	const a = replayWithDirector(replay, aDirector);
	const b = replayWithDirector(replay, bDirector);
	assert.equal(compareCameraReplayResults(a, b).equal, true);
	assert.equal(replay.frameCount, 4);
	recorder.dispose(); aDirector.dispose(); bDirector.dispose();
});

check('acceptance remains fail-closed for stale signal state', () => {
	const director = createPlayerCombatCameraIntentDirector({ signalStaleSeconds: 0.1, device: 'keyboard' });
	director.consumeMotion(playerMotion('idle'));
	director.update(0.11);
	const evidence = evaluatePlayerCombatCameraIntent(director.getSnapshot());
	assert.equal(evidence.accepted, false);
	assert.ok(evidence.riskCodes.includes('P4_STALE_SIGNALS'));
	director.dispose();
});

check('plan geometry remains finite for extreme but bounded inputs', () => {
	const director = createPlayerCombatCameraIntentDirector({ device: 'touch' });
	director.consumeMotion({ ...playerMotion('sprint'), position: { x: 999999, y: -999999, z: 0 }, facing: { x: 1, z: 0 } });
	director.setLookInput(1, -1);
	const plan = buildOrbitApplicationPlan(director.getSnapshot());
	for (const value of Object.values(plan.desiredPosition)) assert.equal(Number.isFinite(value), true);
	for (const value of Object.values(plan.eye)) assert.equal(Number.isFinite(value), true);
	director.dispose();
});

if (failures.length) {
	console.error('PLAYER_COMBAT_CAMERA_CONTRACT_RUNTIME_FAILED');
	for (const failure of failures) console.error(failure);
	process.exitCode = 1;
} else {
	console.log(`PLAYER_COMBAT_CAMERA_CONTRACT_RUNTIME_OK checks=${checks}`);
}
