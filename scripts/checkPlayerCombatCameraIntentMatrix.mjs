import assert from 'node:assert/strict';
import { createPlayerCombatCameraIntentDirector } from '../src/3d/gameplay/playerCombatCameraIntentDirector.js';
import { evaluatePlayerCombatCameraIntent } from '../src/3d/gameplay/playerCombatCameraAcceptance.js';
import { createCameraIntentReplay, replayWithDirector } from '../src/3d/gameplay/playerCombatCameraReplayContract.js';

const states = ['idle', 'walk', 'sprint', 'guard', 'parry', 'dodge', 'attack-light', 'attack-heavy', 'guard-break', 'hit-stagger', 'airborne', 'exhausted'];
const devices = ['keyboard', 'mouse', 'gamepad', 'touch', 'pwa'];
const outcomes = ['hit', 'guard', 'parry', 'dodge', 'guard-break', 'hit-stagger', 'critical', 'blocked'];
const failures = [];
let checks = 0;

const finite = (value) => Number.isFinite(Number(value));
const motionFor = (state, index) => ({
	state,
	position: { x: 3 + index * 0.25, y: 1 + (index % 3) * 0.1, z: -5 + index * 0.15 },
	facing: { x: Math.sin(index * 0.31), z: Math.cos(index * 0.31) },
	speedMps: state === 'sprint' ? 8.2 : state === 'walk' ? 2.1 : state === 'dodge' ? 10.5 : 0,
	staminaRatio: Math.max(0, 1 - index / 60),
	poiseRatio: Math.max(0, 1 - (index % 25) / 30),
	guarding: state === 'guard',
	attackRemaining: state.startsWith('attack-') ? 0.25 : 0,
	attackKind: state === 'attack-heavy' ? 'heavy' : state === 'attack-light' ? 'light' : 'none',
	attackPhase: state.startsWith('attack-') ? 'active' : 'none',
	isGrounded: state !== 'airborne',
});
const attackFor = (index, kind) => ({
	serial: index + 1,
	kind,
	comboStep: kind === 'heavy' ? 2 : 1,
	phase: 'active',
	active: true,
	reachMeters: kind === 'heavy' ? 2.05 : 1.65,
	damageScale: kind === 'heavy' ? 1.65 : 1,
	position: { x: 3 + index * 0.25, y: 1, z: -5 + index * 0.15 },
	facing: { x: 0, z: 1 },
});
const feedbackFor = (index, outcome) => ({
	serial: index + 1,
	outcome,
	rawAmount: 5 + index,
	appliedAmount: outcome === 'parry' || outcome === 'dodge' ? 0 : 2 + index,
	blockedAmount: outcome === 'guard' || outcome === 'blocked' ? 3 : 0,
	stamina: 80 - Math.min(60, index),
	poise: 70 - Math.min(50, index),
	state: outcome,
	position: { x: 1, y: 1, z: 1 },
});

function check(name, fn) {
	checks += 1;
	try { fn(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

for (let index = 0; index < states.length; index += 1) {
	const state = states[index];
	for (const device of devices) {
		check(`state=${state}/device=${device}`, () => {
			const director = createPlayerCombatCameraIntentDirector({ seed: 100 + index, device });
			director.consumeMotion(motionFor(state, index));
			if (state === 'attack-light' || state === 'attack-heavy') director.consumeAttackWindow(attackFor(index, state === 'attack-heavy' ? 'heavy' : 'light'));
			director.setLookInput(((index % 7) - 3) / 4, ((index % 5) - 2) / 4);
			const snapshot = director.update(1 / 60);
			const evidence = evaluatePlayerCombatCameraIntent(snapshot);
			assert.equal(evidence.stateValid, true);
			assert.equal(evidence.positionFinite, true);
			assert.equal(finite(snapshot.lens.distanceMeters), true);
			assert.equal(finite(snapshot.lens.heightMeters), true);
			assert.equal(finite(snapshot.lens.fovDegrees), true);
			assert.equal(finite(snapshot.orientation.yawRadians), true);
			assert.equal(finite(snapshot.orientation.pitchRadians), true);
			director.dispose();
		});
	}
}

for (let index = 0; index < outcomes.length; index += 1) {
	for (const state of ['guard', 'parry', 'dodge', 'hit-stagger', 'attack-light', 'attack-heavy']) {
		check(`feedback=${outcomes[index]}/state=${state}`, () => {
			const director = createPlayerCombatCameraIntentDirector({ seed: 200 + index });
			director.consumeMotion(motionFor(state, index + 20));
			director.consumeCombatFeedback(feedbackFor(index, outcomes[index]));
			const snapshot = director.update(0.016);
			assert.equal(snapshot.feedback.outcome, outcomes[index]);
			assert.ok(snapshot.feedback.intensity >= 0 && snapshot.feedback.intensity <= 1);
			assert.equal(evaluatePlayerCombatCameraIntent(snapshot).accepted, true);
			director.dispose();
		});
	}
}

for (let index = 0; index < 18; index += 1) {
	check(`lock-on-${index}`, () => {
		const director = createPlayerCombatCameraIntentDirector({ lockOnEnabled: true, seed: 300 + index });
		director.consumeMotion(motionFor(index % 2 ? 'guard' : 'attack-light', index + 30));
		director.setTarget({
			id: `npc-${index}`,
			position: { x: 8 + index, y: 1.2, z: 2 - index / 4 },
			velocity: { x: index / 5, y: 0, z: -index / 8 },
			visibility: 1,
			lockOn: true,
		});
		director.update(0.016);
		const snapshot = director.getSnapshot();
		assert.equal(snapshot.lockOn.active, true);
		assert.equal(snapshot.target.id, `npc-${index}`);
		assert.equal(snapshot.focusPoint.x > snapshot.target.position.x, true);
		director.dispose();
	});
}

for (let index = 0; index < 10; index += 1) {
	check(`collision-${index}`, () => {
		const director = createPlayerCombatCameraIntentDirector({ seed: 400 + index });
		director.consumeMotion(motionFor('attack-heavy', index + 50));
		director.setCollisionProbe({ valid: true, occluded: true, distanceMeters: 1.6 + index * 0.2, normal: { x: 1, y: 0.2, z: 0 }, source: 'terrain' });
		const snapshot = director.update(0.016);
		assert.equal(snapshot.collision.available, true);
		assert.equal(snapshot.collision.occluded, true);
		assert.ok(snapshot.collision.resolvedDistanceMeters >= 1.4);
		director.dispose();
	});
}

for (let index = 0; index < 20; index += 1) {
	check(`determinism-${index}`, () => {
		const options = { seed: 500 + index, device: devices[index % devices.length], lockOnEnabled: index % 2 === 0 };
		const makeReplay = () => createCameraIntentReplay([
			{ deltaSeconds: 0.016, motion: motionFor('idle', index) },
			{ deltaSeconds: 0.016, motion: motionFor('walk', index + 1), lookInput: { x: 0.2, y: -0.1 } },
			{ deltaSeconds: 0.016, motion: motionFor(index % 2 ? 'guard' : 'attack-heavy', index + 2), attackWindow: attackFor(index, index % 2 ? 'light' : 'heavy') },
			{ deltaSeconds: 0.016, combatFeedback: feedbackFor(index, index % 3 === 0 ? 'critical' : 'hit') },
		]);
		const replay = makeReplay();
		const first = replayWithDirector(replay, createPlayerCombatCameraIntentDirector(options));
		const second = replayWithDirector(replay, createPlayerCombatCameraIntentDirector(options));
		assert.equal(first.digest, second.digest);
	});
}

check('sequence covers every authored gameplay profile', () => {
	const director = createPlayerCombatCameraIntentDirector({ device: 'keyboard' });
	const digests = [];
	for (let index = 0; index < states.length; index += 1) {
		const state = states[index];
		director.consumeMotion(motionFor(state, index + 80));
		if (state.startsWith('attack-')) director.consumeAttackWindow(attackFor(index + 80, state === 'attack-heavy' ? 'heavy' : 'light'));
		digests.push(director.update(1 / 60).digest);
	}
	assert.equal(new Set(digests).size, digests.length);
	director.dispose();
});

check('input parity keeps equivalent direction bounded across devices', () => {
	const directions = [
		{ x: 0.2, y: -0.7 },
		{ x: -0.8, y: 0.4 },
		{ x: 1, y: 1 },
		{ x: -1, y: -1 },
	];
	for (const device of devices) {
		for (const direction of directions) {
			const director = createPlayerCombatCameraIntentDirector({ device });
			director.setLookInput(direction.x, direction.y);
			const snapshot = director.update(1 / 60);
			assert.ok(Math.abs(snapshot.input.lookX) <= 1);
			assert.ok(Math.abs(snapshot.input.lookY) <= 1);
			director.dispose();
		}
	}
});

check('signal aging is independent from frame advancement', () => {
	const director = createPlayerCombatCameraIntentDirector({ signalStaleSeconds: 0.25 });
	director.consumeMotion(motionFor('walk', 101));
	for (let index = 0; index < 10; index += 1) {
		const snapshot = director.update(0.02);
		assert.equal(snapshot.staleSignals, index >= 13);
	}
	director.dispose();
});

check('reaction sequence keeps recent event memory bounded', () => {
	const director = createPlayerCombatCameraIntentDirector({ maxRecentEvents: 5, maxEventAgeSeconds: 1 });
	for (let index = 0; index < 20; index += 1) director.consumeMotion(motionFor('walk', index + 110));
	assert.ok(director.getSnapshot().recentEvents.length <= 5);
	director.dispose();
});

if (failures.length) {
	console.error('PLAYER_COMBAT_CAMERA_INTENT_MATRIX_FAILED');
	for (const failure of failures) console.error(failure);
	process.exitCode = 1;
} else {
	console.log(`PLAYER_COMBAT_CAMERA_INTENT_MATRIX_OK checks=${checks}`);
}
