import assert from 'node:assert/strict';
import {
	createPlayerCombatCameraIntentDirector,
	PLAYER_COMBAT_CAMERA_INTENT_EVENT,
	__testing as directorTesting,
} from '../src/3d/gameplay/playerCombatCameraIntentDirector.js';
import {
	buildCameraLensState,
	buildCameraTargetTransform,
	buildCameraFeedbackOffset,
	buildOrbitApplicationPlan,
	resolveCameraPlacement,
	createPlayerCombatCameraRuntimeAdapter,
} from '../src/3d/gameplay/playerCombatCameraRuntimeAdapter.js';
import {
	evaluatePlayerCombatCameraIntent,
	evaluateCameraSequence,
	assertPlayerCombatCameraEvidence,
} from '../src/3d/gameplay/playerCombatCameraAcceptance.js';
import {
	createCameraIntentRecorder,
	createCameraIntentReplay,
	replayWithDirector,
	compareCameraReplayResults,
	summarizeReplay,
} from '../src/3d/gameplay/playerCombatCameraReplayContract.js';

const checks = [];
const record = (name, fn) => checks.push({ name, fn });
const run = async () => {
	for (const check of checks) await check.fn();
	console.log(`PLAYER_COMBAT_CAMERA_INTENT_OK checks=${checks.length}`);
};

const motion = (state = 'idle', extra = {}) => ({
	state,
	position: { x: 10, y: 3.5, z: -4 },
	facing: { x: 0, z: 1 },
	speedMps: state === 'sprint' ? 8 : 2,
	staminaRatio: 0.8,
	poiseRatio: 0.9,
	isGrounded: !['airborne'].includes(state),
	attackRemaining: state.startsWith('attack-') ? 0.5 : 0,
	attackKind: state === 'attack-heavy' ? 'heavy' : state === 'attack-light' ? 'light' : 'none',
	attackPhase: state.startsWith('attack-') ? 'active' : 'none',
	...extra,
});

const attack = (kind = 'light', phase = 'start', serial = 1) => ({
	serial,
	kind,
	comboStep: kind === 'heavy' ? 2 : 1,
	phase,
	active: phase === 'active-start' || phase === 'active',
	reachMeters: kind === 'heavy' ? 2.05 : 1.65,
	damageScale: kind === 'heavy' ? 1.65 : 1,
	position: { x: 10, y: 3.5, z: -4 },
	facing: { x: 0, z: 1 },
});

const feedback = (outcome = 'hit', amount = 20, serial = 1) => ({
	serial,
	outcome,
	rawAmount: amount,
	appliedAmount: amount,
	blockedAmount: 0,
	stamina: 80,
	poise: 70,
	state: outcome,
	position: { x: 10, y: 3.5, z: -4 },
});

record('default snapshot is finite and frozen', () => {
	const director = createPlayerCombatCameraIntentDirector({ seed: 11, device: 'keyboard' });
	const snapshot = director.getSnapshot();
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(snapshot.state, 'idle');
	assert.equal(snapshot.readiness.finite, true);
	assert.match(snapshot.digest, /^[0-9a-f]{8}$/);
	director.dispose();
});

record('normalization rejects malformed motion by falling back to finite idle fields', () => {
	const normalized = directorTesting.normalizeMotion({ state: 'bogus', speedMps: NaN, position: { x: NaN, y: Infinity, z: 'bad' }, facing: { x: Infinity, z: NaN } });
	assert.equal(normalized.state, 'idle');
	assert.equal(Number.isFinite(normalized.speedMps), true);
	assert.deepEqual(normalized.position, { x: 0, y: 0, z: 0 });
	assert.deepEqual(normalized.facing, { x: 0, z: 1 });
});

record('attack state gets higher priority than locomotion', () => {
	const result = directorTesting.resolveStatePriority(motion('sprint', { attackRemaining: 0.5, attackKind: 'heavy', attackPhase: 'active' }), directorTesting.normalizeAttack(attack('heavy', 'active')));
	assert.equal(result, 'attack-heavy');
});

record('defense and reaction states outrank attacks', () => {
	assert.equal(directorTesting.resolveStatePriority(motion('hit-stagger', { attackRemaining: 0.4 }), directorTesting.normalizeAttack(attack('light', 'active'))), 'hit-stagger');
	assert.equal(directorTesting.resolveStatePriority(motion('guard-break', { attackRemaining: 0.4 }), directorTesting.normalizeAttack(attack('light', 'active'))), 'guard-break');
	assert.equal(directorTesting.resolveStatePriority(motion('parry'), directorTesting.normalizeAttack(attack('heavy', 'active'))), 'parry');
});

record('event target receives frozen camera intent', () => {
	const target = new EventTarget();
	let received = null;
	target.addEventListener(PLAYER_COMBAT_CAMERA_INTENT_EVENT, (event) => { received = event.detail; });
	const director = createPlayerCombatCameraIntentDirector({ eventTarget: target, device: 'gamepad' });
	director.stepAndPublish(1 / 60, { motion: motion('walk') });
	assert.ok(received);
	assert.equal(Object.isFrozen(received), true);
	assert.equal(received.state, 'walk');
	director.dispose();
});

record('attach consumes existing player event vocabulary', () => {
	const target = new EventTarget();
	const director = createPlayerCombatCameraIntentDirector({ eventTarget: target });
	director.attach();
	target.dispatchEvent(new CustomEvent('aapw:player-motion', { detail: motion('sprint') }));
	assert.equal(director.getSnapshot().state, 'sprint');
	target.dispatchEvent(new CustomEvent('aapw:player-attack-window', { detail: attack('heavy', 'active') }));
	assert.equal(director.getSnapshot().state, 'attack-heavy');
	director.detach();
	target.dispatchEvent(new CustomEvent('aapw:player-motion', { detail: motion('walk') }));
	assert.equal(director.getSnapshot().state, 'attack-heavy');
	director.dispose();
});

record('feedback produces bounded intensity and no NaN shake', () => {
	const director = createPlayerCombatCameraIntentDirector({ seed: 5 });
	director.consumeMotion(motion('hit-stagger'));
	director.consumeCombatFeedback(feedback('critical', 100));
	const snapshot = director.update(1 / 60);
	assert.ok(snapshot.feedback.intensity > 0);
	assert.ok(snapshot.feedback.intensity <= 1);
	for (const value of Object.values(snapshot.feedback.shakeMeters)) assert.equal(Number.isFinite(value), true);
	director.dispose();
});

record('stale signal detection eventually becomes true without new producer events', () => {
	const director = createPlayerCombatCameraIntentDirector({ signalStaleSeconds: 0.25 });
	director.consumeMotion(motion('walk'));
	assert.equal(director.getSnapshot().staleSignals, false);
	director.update(0.3);
	assert.equal(director.getSnapshot().staleSignals, true);
	director.dispose();
});

record('stale targets do not remain lock-on active', () => {
	const director = createPlayerCombatCameraIntentDirector({ lockOnEnabled: true, targetMemorySeconds: 0.2 });
	director.consumeMotion(motion('attack-light'));
	director.setTarget({ id: 'wolf-1', position: { x: 12, y: 1, z: -1 }, visibility: 1, lockOn: true });
	director.update(0.21);
	assert.equal(director.getSnapshot().target, null);
	assert.equal(director.getSnapshot().lockOn.active, false);
	director.dispose();
});

record('lock-on target lead uses target velocity', () => {
	const director = createPlayerCombatCameraIntentDirector({ lockOnEnabled: true, lockOnLeadMeters: 0.5 });
	director.consumeMotion(motion('guard'));
	director.setTarget({ id: 'guard-target', position: { x: 20, y: 2, z: 4 }, velocity: { x: 2, y: 0, z: -4 }, visibility: 1, lockOn: true });
	const snapshot = director.getSnapshot();
	assert.equal(snapshot.lockOn.active, true);
	assert.equal(snapshot.focusPoint.x, 21);
	assert.equal(snapshot.focusPoint.z, 2);
	director.dispose();
});

record('look deadzone suppresses small input and keeps larger input', () => {
	assert.equal(directorTesting.applyDeadzone(0.04, 0.08), 0);
	assert.ok(directorTesting.applyDeadzone(0.54, 0.08) > 0);
	assert.equal(directorTesting.applyDeadzone(-0.9, 0.08) < 0, true);
});

record('angle smoothing chooses shortest turn path', () => {
	const nearWrap = directorTesting.smoothAngle(Math.PI - 0.02, -Math.PI + 0.02, 12, 1 / 60);
	assert.ok(Math.abs(nearWrap) > 2.9);
});

record('config clamps invalid distance and FOV ranges', () => {
	const config = directorTesting.normalizeConfig({ minDistance: 0, maxDistance: 0, defaultDistance: 100, minFov: 0, maxFov: 500 });
	assert.ok(config.minDistance >= 0.5);
	assert.ok(config.maxDistance > config.minDistance);
	assert.ok(config.defaultDistance <= config.maxDistance);
	assert.ok(config.maxFov <= 100);
});

record('shoulder side swap changes shoulder point deterministically', () => {
	const director = createPlayerCombatCameraIntentDirector({ shoulderSign: 1 });
	director.consumeMotion(motion('guard'));
	const right = director.getSnapshot().shoulderPoint;
	director.setShoulderSwap(true);
	const left = director.getSnapshot().shoulderPoint;
	assert.notEqual(right.x, left.x);
	director.dispose();
});

record('device metadata accepts the four gameplay input families and rejects unknowns', () => {
	const director = createPlayerCombatCameraIntentDirector();
	for (const device of ['keyboard', 'mouse', 'gamepad', 'touch', 'pwa']) {
		director.setDevice(device);
		assert.equal(director.getSnapshot().input.device, device);
	}
	director.setDevice('arcane-orb');
	assert.equal(director.getSnapshot().input.device, 'unknown');
	director.dispose();
});

record('runtime adapter creates an owner-facing plan without mutating camera state', () => {
	const director = createPlayerCombatCameraIntentDirector({ device: 'mouse' });
	director.consumeMotion(motion('attack-heavy'));
	director.consumeAttackWindow(attack('heavy', 'active'));
	const intent = director.getSnapshot();
	const plan = buildOrbitApplicationPlan(intent);
	assert.equal(plan.cameraOwner, 'existing-camera-owner');
	assert.equal(plan.mutatesCamera, false);
	assert.equal(Number.isFinite(plan.resolvedPosition.x), true);
	assert.ok(plan.lens.distanceMeters > 0);
	director.dispose();
});

record('adapter can use a caller collision resolver and reports the resolved point', () => {
	class FakeVector3 {
		constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
		distanceTo(other) { return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z); }
	}
	const intent = createPlayerCombatCameraIntentDirector().getSnapshot();
	const result = resolveCameraPlacement({
		intent,
		target: { x: 0, y: 1, z: 0 },
		desiredPosition: new FakeVector3(0, 2, 4),
		raycaster: {},
		collidables: [{}],
		collisionResolver: (_raycaster, target, desired) => new FakeVector3(target.x, target.y, 1),
	});
	assert.equal(result.occluded, true);
	assert.equal(result.position.z, 1);
});

record('lens/target/feedback helpers are bounded and frozen', () => {
	const director = createPlayerCombatCameraIntentDirector({});
	const intent = director.getSnapshot();
	assert.equal(Object.isFrozen(buildCameraLensState(intent)), true);
	assert.equal(Object.isFrozen(buildCameraTargetTransform(intent)), true);
	assert.equal(Object.isFrozen(buildCameraFeedbackOffset(intent)), true);
	director.dispose();
});

record('acceptance evidence passes clean idle intent', () => {
	const director = createPlayerCombatCameraIntentDirector({ device: 'keyboard' });
	const evidence = assertPlayerCombatCameraEvidence(director.getSnapshot(), { expectedState: 'idle' });
	assert.equal(evidence.accepted, true);
	assert.deepEqual(evidence.riskCodes, []);
	director.dispose();
});

record('acceptance exposes stale-lock-on risk when requested but target is unavailable', () => {
	const director = createPlayerCombatCameraIntentDirector({ lockOnEnabled: true, device: 'gamepad' });
	const evidence = evaluatePlayerCombatCameraIntent(director.getSnapshot());
	assert.equal(evidence.accepted, false);
	assert.ok(evidence.riskCodes.includes('P4_STALE_LOCK_ON'));
	director.dispose();
});

record('sequence evidence counts states and invalid frames deterministically', () => {
	const first = createPlayerCombatCameraIntentDirector({ device: 'keyboard' });
	const frames = [
		first.update(1 / 60, { motion: motion('idle') }),
		first.update(1 / 60, { motion: motion('walk') }),
		first.update(1 / 60, { motion: motion('attack-heavy'), attackWindow: attack('heavy', 'active') }),
	];
	const sequence = evaluateCameraSequence(frames);
	assert.equal(sequence.frameCount, 3);
	assert.equal(sequence.acceptedFrames, 3);
	assert.deepEqual(sequence.states, ['attack-heavy', 'idle', 'walk']);
	first.dispose();
});

record('replay recorder is bounded and deterministic', () => {
	const recorder = createCameraIntentRecorder({ maxFrames: 2 });
	recorder.record({ deltaSeconds: 0.016, motion: motion('idle') });
	recorder.record({ deltaSeconds: 0.016, motion: motion('walk') });
	recorder.record({ deltaSeconds: 0.016, motion: motion('sprint') });
	const replay = recorder.snapshot();
	assert.equal(replay.frameCount, 2);
	assert.equal(replay.frames[0].motion.state, 'walk');
	assert.match(replay.digest, /^[0-9a-f]{8}$/);
	recorder.dispose();
});

record('replay results match when the same deterministic frame sequence is replayed twice', () => {
	const recorder = createCameraIntentRecorder();
	recorder.record({ deltaSeconds: 0.016, motion: motion('idle') });
	recorder.record({ deltaSeconds: 0.016, motion: motion('walk') });
	recorder.record({ deltaSeconds: 0.032, motion: motion('attack-light'), attackWindow: attack('light', 'active', 2) });
	recorder.record({ deltaSeconds: 0.016, combatFeedback: feedback('critical', 40, 3) });
	const replay = createCameraIntentReplay(recorder.snapshot().frames);
	const first = createPlayerCombatCameraIntentDirector({ seed: 77 });
	const second = createPlayerCombatCameraIntentDirector({ seed: 77 });
	const a = replayWithDirector(replay, first);
	const b = replayWithDirector(replay, second);
	assert.equal(compareCameraReplayResults(a, b).equal, true);
	assert.equal(summarizeReplay(replay).frameCount, 4);
	recorder.dispose(); first.dispose(); second.dispose();
});

record('different deterministic seeds change feedback shake but not the owning state', () => {
	const replayFrame = { deltaSeconds: 1 / 60, motion: motion('hit-stagger'), combatFeedback: feedback('critical', 80) };
	const replay = createCameraIntentReplay([replayFrame]);
	const aDirector = createPlayerCombatCameraIntentDirector({ seed: 3 });
	const bDirector = createPlayerCombatCameraIntentDirector({ seed: 4 });
	const a = replayWithDirector(replay, aDirector).snapshots[0];
	const b = replayWithDirector(replay, bDirector).snapshots[0];
	assert.equal(a.state, b.state);
	assert.notEqual(a.feedback.shakeMeters.x, b.feedback.shakeMeters.x);
	aDirector.dispose(); bDirector.dispose();
});

record('reset returns the director to its configured baseline', () => {
	const director = createPlayerCombatCameraIntentDirector({ defaultDistance: 6.5, defaultHeight: 2.1, defaultFov: 61 });
	director.consumeMotion(motion('attack-heavy'));
	director.consumeCombatFeedback(feedback('hit'));
	director.setTarget({ id: 'enemy', position: { x: 3, y: 2, z: 7 } });
	director.setLookInput(0.8, -0.5);
	director.update(0.1);
	const baseline = director.reset();
	assert.equal(baseline.state, 'idle');
	assert.equal(baseline.target, null);
	assert.equal(baseline.lens.fovDegrees, 61);
	assert.equal(baseline.input.lookX, 0);
	director.dispose();
});

record('disposed director fails closed instead of silently mutating state', () => {
	const director = createPlayerCombatCameraIntentDirector();
	director.dispose();
	assert.throws(() => director.getSnapshot(), /disposed/);
	assert.throws(() => director.setLookInput(0, 0), /disposed/);
	assert.throws(() => director.update(0.1), /disposed/);
});

record('adapter lifecycle supports plan/reset/dispose', () => {
	const adapter = createPlayerCombatCameraRuntimeAdapter({ marginMeters: 0.25, minDistanceMeters: 1.6 });
	const director = createPlayerCombatCameraIntentDirector();
	const plan = adapter.plan(director.getSnapshot());
	assert.equal(plan.collision.paddingMeters, 0.25);
	assert.ok(adapter.getPlan());
	adapter.reset();
	assert.equal(adapter.getPlan(), null);
	adapter.dispose();
	assert.throws(() => adapter.getPlan(), /disposed/);
	director.dispose();
});

record('acceptance rejects intentionally non-finite lens and orientation data', () => {
	const base = createPlayerCombatCameraIntentDirector().getSnapshot();
	const invalid = {
		...base,
		lens: { ...base.lens, distanceMeters: Infinity },
		orientation: { ...base.orientation, pitchRadians: NaN },
	};
	const evidence = evaluatePlayerCombatCameraIntent(invalid);
	assert.equal(evidence.accepted, false);
	assert.ok(evidence.riskCodes.includes('P1_INVALID_LENS'));
	assert.ok(evidence.riskCodes.includes('P1_INVALID_ORIENTATION'));
});

record('camera target point falls back to player facing when target is absent', () => {
	const targetPoint = directorTesting.deriveTargetPoint(
		{ x: 1, y: 2, z: 3 },
		{ x: 0, z: -1 },
		null,
		directorTesting.DEFAULT_CONFIG,
		1,
		false,
	);
	assert.equal(targetPoint.x, 1);
	assert.equal(targetPoint.z < 3, true);
});

record('camera shoulder target mirrors around facing vector', () => {
	const point = { x: 0, y: 2, z: 0 };
	const right = directorTesting.deriveShoulderTarget(point, { x: 0, z: 1 }, point, 1, 1);
	const left = directorTesting.deriveShoulderTarget(point, { x: 0, z: 1 }, point, -1, 1);
	assert.equal(right.x, 1);
	assert.equal(left.x, -1);
});

record('feedback decay returns to zero after configured memory', () => {
	const director = createPlayerCombatCameraIntentDirector({ feedbackMemorySeconds: 0.2 });
	director.consumeCombatFeedback(feedback('critical', 60));
	assert.ok(director.getSnapshot().feedback.intensity > 0);
	director.update(0.25);
	assert.equal(director.getSnapshot().feedback.intensity, 0);
	director.dispose();
});

record('target visibility zero immediately disables active target', () => {
	const director = createPlayerCombatCameraIntentDirector({ lockOnEnabled: true });
	director.consumeMotion(motion('guard'));
	director.setTarget({ id: 'visible', position: { x: 5, y: 1, z: 5 }, visibility: 1, lockOn: true });
	assert.equal(director.getSnapshot().lockOn.active, true);
	director.setTarget({ id: 'invisible', position: { x: 5, y: 1, z: 5 }, visibility: 0, lockOn: true });
	assert.equal(director.getSnapshot().lockOn.active, false);
	director.dispose();
});

record('heavy attack profile closes distance and increases FOV relative to idle', () => {
	const idle = createPlayerCombatCameraIntentDirector();
	const heavy = createPlayerCombatCameraIntentDirector();
	idle.consumeMotion(motion('idle'));
	heavy.consumeMotion(motion('attack-heavy'));
	heavy.consumeAttackWindow(attack('heavy', 'active'));
	const a = idle.getSnapshot();
	const b = heavy.getSnapshot();
	assert.ok(b.lens.distanceMeters < a.lens.distanceMeters);
	assert.ok(b.lens.fovDegrees > a.lens.fovDegrees);
	idle.dispose(); heavy.dispose();
});

record('sprint profile widens distance and FOV', () => {
	const director = createPlayerCombatCameraIntentDirector();
	director.consumeMotion(motion('sprint'));
	const snapshot = director.getSnapshot();
	assert.ok(snapshot.lens.distanceMeters > 5);
	assert.ok(snapshot.lens.fovDegrees >= 60);
	director.dispose();
});

record('camera intent digest changes when meaningful intent state changes', () => {
	const director = createPlayerCombatCameraIntentDirector();
	const idle = director.getSnapshot().digest;
	director.consumeMotion(motion('guard'));
	const guard = director.getSnapshot().digest;
	assert.notEqual(idle, guard);
	director.dispose();
});

record('stable stringify sorts object keys recursively', () => {
	const a = directorTesting.stableStringify({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] });
	const b = directorTesting.stableStringify({ list: [{ c: 5, d: 4 }], a: { b: 3, y: 2 }, z: 1 });
	assert.equal(a, b);
});

record('collision input normalizes only finite bounded values', () => {
	const valid = directorTesting.normalizeCollisionProbe({ valid: true, occluded: true, distanceMeters: 3.5, normal: { x: 2, y: -2, z: 0 } });
	assert.equal(valid.distanceMeters, 3.5);
	assert.deepEqual(valid.normal, { x: 1, y: -1, z: 0 });
	assert.equal(directorTesting.normalizeCollisionProbe({ valid: true }), null);
});

record('malformed target returns null rather than poisoning camera focus', () => {
	assert.equal(directorTesting.normalizeTarget({ id: 'bad', position: { x: NaN, y: 1, z: 2 } }), null);
	assert.equal(directorTesting.normalizeTarget({ id: 'ok', point: { x: 1, y: 2, z: 3 }, visibility: 1 }), directorTesting.normalizeTarget({ id: 'ok', point: { x: 1, y: 2, z: 3 }, visibility: 1 }));
});

record('replay summary reports target, collision, attack and feedback coverage', () => {
	const replay = createCameraIntentReplay([
		{ deltaSeconds: 0.016, motion: motion('idle') },
		{ deltaSeconds: 0.016, motion: motion('attack-light'), attackWindow: attack('light', 'active') },
		{ deltaSeconds: 0.016, combatFeedback: feedback('hit'), target: { id: 'wolf', position: { x: 2, y: 1, z: 4 } } },
		{ deltaSeconds: 0.016, collisionProbe: { valid: true, occluded: true, distanceMeters: 2 } },
	]);
	const summary = summarizeReplay(replay);
	assert.equal(summary.frameCount, 4);
	assert.equal(summary.attackFrames, 1);
	assert.equal(summary.feedbackFrames, 1);
	assert.equal(summary.targetFrames, 1);
	assert.equal(summary.collisionFrames, 1);
});

await run();
