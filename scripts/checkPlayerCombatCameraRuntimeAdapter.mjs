import assert from 'node:assert/strict';
import { createPlayerCombatCameraIntentDirector } from '../src/3d/gameplay/playerCombatCameraIntentDirector.js';
import {
	buildCameraLensState,
	buildCameraTargetTransform,
	buildCameraFeedbackOffset,
	buildOrbitApplicationPlan,
	resolveCameraPlacement,
	createPlayerCombatCameraRuntimeAdapter,
} from '../src/3d/gameplay/playerCombatCameraRuntimeAdapter.js';
import { evaluatePlayerCombatCameraIntent } from '../src/3d/gameplay/playerCombatCameraAcceptance.js';

const failures = [];
let checks = 0;
const check = (name, fn) => {
	checks += 1;
	try { fn(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
};

const makeIntent = (state = 'idle', seed = 9) => {
	const director = createPlayerCombatCameraIntentDirector({ seed, device: 'gamepad' });
	director.consumeMotion({
		state,
		position: { x: 2, y: 1.2, z: 4 },
		facing: { x: 0.4, z: 0.9 },
		speedMps: state === 'sprint' ? 8 : 0,
		staminaRatio: 0.7,
		poiseRatio: 0.8,
		isGrounded: state !== 'airborne',
		attackRemaining: state.startsWith('attack-') ? 0.5 : 0,
		attackKind: state === 'attack-heavy' ? 'heavy' : state === 'attack-light' ? 'light' : 'none',
	});
	if (state.startsWith('attack-')) director.consumeAttackWindow({
		serial: 1,
		kind: state === 'attack-heavy' ? 'heavy' : 'light',
		comboStep: state === 'attack-heavy' ? 2 : 1,
		phase: 'active',
		active: true,
		reachMeters: state === 'attack-heavy' ? 2.05 : 1.65,
		damageScale: state === 'attack-heavy' ? 1.65 : 1,
		position: { x: 2, y: 1.2, z: 4 },
		facing: { x: 0.4, z: 0.9 },
	});
	const intent = director.getSnapshot();
	director.dispose();
	return intent;
};

check('lens helper rejects non-object intent', () => assert.throws(() => buildCameraLensState(null), /camera intent is required/));
check('target transform exposes only finite owner-facing values', () => {
	const transform = buildCameraTargetTransform(makeIntent('walk'));
	for (const value of Object.values(transform.position)) assert.equal(Number.isFinite(value), true);
	assert.equal(Number.isFinite(transform.yawRadians), true);
	assert.equal(Number.isFinite(transform.pitchRadians), true);
});
check('feedback helper is bounded for critical impact', () => {
	const director = createPlayerCombatCameraIntentDirector({ seed: 2 });
	director.consumeCombatFeedback({ serial: 1, outcome: 'critical', rawAmount: 999, appliedAmount: 999, blockedAmount: 0 });
	const feedback = buildCameraFeedbackOffset(director.getSnapshot());
	assert.ok(feedback.intensity <= 1);
	assert.ok(Math.hypot(feedback.xMeters, feedback.yMeters, feedback.zMeters) <= 0.5);
	director.dispose();
});
check('orbit plan uses shoulder target but does not own camera', () => {
	const plan = buildOrbitApplicationPlan(makeIntent('guard'));
	assert.equal(plan.cameraOwner, 'existing-camera-owner');
	assert.equal(plan.mutatesCamera, false);
	assert.equal(plan.version, 1);
});

class FakeVector3 {
	constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
	distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
}

check('collision bridge preserves desired position when no collidables are supplied', () => {
	const intent = makeIntent('idle');
	const result = resolveCameraPlacement({ intent, target: { x: 0, y: 1, z: 0 }, desiredPosition: { x: 0, y: 2, z: 4 } });
	assert.equal(result.occluded, false);
	assert.equal(result.resolved, false);
});
check('collision bridge converts a real vector result to plain data', () => {
	const intent = makeIntent('attack-heavy');
	const result = resolveCameraPlacement({
		intent,
		target: { x: 0, y: 1, z: 0 },
		desiredPosition: new FakeVector3(0, 2, 4),
		raycaster: {},
		collidables: [{}],
		collisionResolver: (_raycaster, target, desired) => new FakeVector3(target.x + 0.5, target.y, desired.z / 2),
	});
	assert.equal(result.occluded, true);
	assert.equal(result.resolved, true);
	assert.equal(Number.isFinite(result.position.x), true);
	assert.equal(Number.isFinite(result.distanceMeters), true);
});
check('collision errors fail closed', () => {
	const result = resolveCameraPlacement({
		intent: makeIntent('walk'),
		target: { x: 0, y: 1, z: 0 },
		desiredPosition: new FakeVector3(0, 2, 4),
		raycaster: {},
		collidables: [{}],
		collisionResolver: () => { throw new Error('synthetic collision failure'); },
	});
	assert.equal(result.occluded, false);
	assert.match(result.error, /synthetic collision failure/);
});

for (const state of ['idle', 'walk', 'sprint', 'guard', 'parry', 'dodge', 'attack-light', 'attack-heavy', 'guard-break', 'hit-stagger']) {
	check(`owner plan state ${state} remains acceptance-safe`, () => {
		const intent = makeIntent(state, state.length + 30);
		const evidence = evaluatePlayerCombatCameraIntent(intent);
		assert.equal(evidence.accepted, true);
		const plan = buildOrbitApplicationPlan(intent);
		assert.ok(plan.lens.distanceMeters > 0);
		assert.ok(plan.lens.fovDegrees >= 35 && plan.lens.fovDegrees <= 110);
		assert.equal(plan.mutatesCamera, false);
	});
}

check('adapter stores and returns its last plan', () => {
	const adapter = createPlayerCombatCameraRuntimeAdapter();
	const intent = makeIntent('sprint');
	const first = adapter.plan(intent);
	assert.equal(adapter.getPlan().state, first.state);
	adapter.reset();
	assert.equal(adapter.getPlan(), null);
	adapter.dispose();
});

check('adapter rejects invalid intent versions', () => {
	const adapter = createPlayerCombatCameraRuntimeAdapter();
	assert.throws(() => adapter.plan({ version: 2 }), /unsupported camera intent version/);
	adapter.dispose();
});

check('adapter configuration clamps unsafe collision values', () => {
	const adapter = createPlayerCombatCameraRuntimeAdapter({ marginMeters: 999, minDistanceMeters: -5 });
	assert.equal(adapter.config.marginMeters, 2);
	assert.equal(adapter.config.minDistanceMeters, 0.5);
	adapter.dispose();
});

check('director and adapter keep deterministic output for repeated same input', () => {
	const aDirector = createPlayerCombatCameraIntentDirector({ seed: 123, device: 'pwa' });
	const bDirector = createPlayerCombatCameraIntentDirector({ seed: 123, device: 'pwa' });
	const input = { motion: { state: 'attack-heavy', position: { x: 2, y: 1, z: 3 }, facing: { x: 0, z: 1 }, attackRemaining: 0.4, attackKind: 'heavy', isGrounded: true }, attackWindow: { serial: 1, kind: 'heavy', comboStep: 2, phase: 'active', active: true, reachMeters: 2.05, damageScale: 1.65, position: { x: 2, y: 1, z: 3 }, facing: { x: 0, z: 1 } } };
	const a = aDirector.update(1 / 60, input);
	const b = bDirector.update(1 / 60, input);
	assert.equal(a.digest, b.digest);
	aDirector.dispose();
	bDirector.dispose();
});

check('look input stays bounded through adapter-facing plan', () => {
	const director = createPlayerCombatCameraIntentDirector({ device: 'touch' });
	director.setLookInput(10, -10);
	const intent = director.update(1 / 60);
	assert.equal(Math.abs(intent.input.lookX) <= 1, true);
	assert.equal(Math.abs(intent.input.lookY) <= 1, true);
	director.dispose();
});

check('lock-on request remains explicit and never implies target discovery', () => {
	const director = createPlayerCombatCameraIntentDirector({ lockOnEnabled: true, device: 'gamepad' });
	const intent = director.getSnapshot();
	assert.equal(intent.lockOn.requested, true);
	assert.equal(intent.readiness.targetDiscoveryRequired, true);
	assert.equal(intent.target, null);
	director.dispose();
});

check('camera adapter does not fabricate collision data', () => {
	const plan = buildOrbitApplicationPlan(makeIntent('idle'));
	assert.equal(plan.collision.available, false);
	assert.equal(plan.collision.occluded, false);
});

if (failures.length) {
	console.error('PLAYER_COMBAT_CAMERA_RUNTIME_ADAPTER_FAILED');
	for (const failure of failures) console.error(failure);
	process.exitCode = 1;
} else {
	console.log(`PLAYER_COMBAT_CAMERA_RUNTIME_ADAPTER_OK checks=${checks}`);
}
