import assert from 'node:assert/strict';
import {
	normalizePlayerCameraLookInput,
	normalizeShoulderInput,
	normalizeLockOnIntent,
	buildCameraInputParityFrame,
	compareEquivalentCameraInputs,
	sanitizeCameraGestureVelocity,
	cameraInputParitySummary,
} from '../src/3d/gameplay/playerCombatCameraInputParity.js';

const devices = ['keyboard', 'mouse', 'gamepad', 'touch', 'pwa'];
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('keyboard look clamps to signed unit range', () => {
	const result = normalizePlayerCameraLookInput('keyboard', { x: 9, y: -9 });
	assert.equal(result.family, 'keyboard');
	assert.equal(result.x <= 1 && result.x >= -1, true);
	assert.equal(result.y <= 1 && result.y >= -1, true);
});

check('mouse viewport normalization is stable', () => {
	const center = normalizePlayerCameraLookInput('mouse', { x: 0, y: 0 }, { viewportWidth: 1920, viewportHeight: 1080 });
	assert.deepEqual({ x: center.x, y: center.y }, { x: 0, y: 0 });
});

check('touch sensitivity stays bounded on large gesture', () => {
	const result = normalizePlayerCameraLookInput('touch', { x: 9999, y: -9999 }, { touchSensitivity: 0.02 });
	assert.equal(result.x, 1);
	assert.equal(result.y, -1);
});

check('gamepad deadzone removes small axis movement', () => {
	const result = normalizePlayerCameraLookInput('gamepad', { x: 0.03, y: -0.04 });
	assert.equal(result.x, 0);
	assert.equal(result.y, 0);
});

check('gamepad significant axis movement survives', () => {
	const result = normalizePlayerCameraLookInput('gamepad', { x: 0.8, y: -0.8 });
	assert.ok(result.x > 0);
	assert.ok(result.y < 0);
});

check('unknown device fails closed to unknown family', () => {
	const result = normalizePlayerCameraLookInput('motion-sensor', { x: 0.5, y: 0.5 });
	assert.equal(result.family, 'unknown');
});

check('shoulder vocabulary is symmetric', () => {
	assert.equal(normalizeShoulderInput(true), -1);
	assert.equal(normalizeShoulderInput('left'), -1);
	assert.equal(normalizeShoulderInput(-1), -1);
	assert.equal(normalizeShoulderInput(false), 1);
	assert.equal(normalizeShoulderInput('right'), 1);
});

check('lock-on intent preserves request and re-acquire separately', () => {
	const result = normalizeLockOnIntent({ enabled: true, reacquire: true, preserveTarget: false });
	assert.equal(result.requested, true);
	assert.equal(result.reacquire, true);
	assert.equal(result.preserveTarget, false);
});

check('parity frame carries timestamp and shoulder sign', () => {
	const frame = buildCameraInputParityFrame({ source: 'pwa', payload: { x: 0.7, y: -0.2 }, shoulder: 'left', lockOn: { enabled: true }, timestampMs: 12345 });
	assert.equal(frame.family, 'pwa');
	assert.equal(frame.shoulderSign, -1);
	assert.equal(frame.lockOn.requested, true);
	assert.equal(frame.timestampMs, 12345);
});

check('equivalent frames report small maximum delta', () => {
	const frames = devices.map((family, index) => buildCameraInputParityFrame({ source: family, payload: { x: 0.45 + index * 0.01, y: -0.2 + index * 0.005 }, shoulder: 'right', lockOn: { enabled: true } }));
	const comparison = compareEquivalentCameraInputs(frames);
	assert.equal(comparison.equivalent, true);
	assert.ok(comparison.maxDelta <= 0.12);
});

check('clearly different frames are not considered equivalent', () => {
	const frames = [
		buildCameraInputParityFrame({ source: 'gamepad', payload: { x: 1, y: 0 }, shoulder: 'right' }),
		buildCameraInputParityFrame({ source: 'touch', payload: { x: -1, y: 0 }, shoulder: 'left' }),
	];
	assert.equal(compareEquivalentCameraInputs(frames).equivalent, false);
});

check('gesture velocity is finite and bounded', () => {
	const result = sanitizeCameraGestureVelocity({ x: 999, y: -999, z: Infinity }, 4);
	assert.deepEqual(result, { x: 4, y: -4, z: 0 });
});

check('summary reports all configured input families', () => {
	const frames = devices.map((family, index) => buildCameraInputParityFrame({ source: family, payload: { x: 0.3, y: 0.1 }, shoulder: index % 2 ? 'left' : 'right', lockOn: { enabled: index % 2 === 0 } }));
	const summary = cameraInputParitySummary(frames);
	assert.equal(summary.frameCount, devices.length);
	assert.deepEqual(summary.families, devices.slice().sort());
	assert.equal(summary.finiteFrames, devices.length);
	assert.equal(summary.parityReady, true);
});

for (let index = 0; index < 50; index += 1) {
	check(`bounded-random-like-case-${index}`, () => {
		const source = devices[index % devices.length];
		const x = ((index * 37) % 201 - 100) / 100;
		const y = ((index * 53) % 201 - 100) / 100;
		const frame = buildCameraInputParityFrame({
			source,
			payload: { x, y },
			shoulder: index % 3 === 0 ? 'left' : 'right',
			lockOn: { enabled: index % 4 === 0, reacquire: index % 7 === 0 },
			timestampMs: index * 16,
		});
		assert.equal(frame.version, 1);
		assert.equal(Math.abs(frame.look.x) <= 1, true);
		assert.equal(Math.abs(frame.look.y) <= 1, true);
		assert.ok(Number.isInteger(frame.timestampMs));
	});
}

for (const device of devices) {
	check(`zero-input-${device}`, () => {
		const frame = buildCameraInputParityFrame({ source: device, payload: { x: 0, y: 0 }, shoulder: 'right' });
		assert.equal(frame.look.x, 0);
		assert.equal(frame.look.y, 0);
	});
}

for (const source of devices) {
	for (const shoulder of [-1, 1]) {
		check(`shoulder-source-${source}-${shoulder}`, () => {
			const frame = buildCameraInputParityFrame({ source, payload: { x: 0.2, y: -0.1 }, shoulder });
			assert.equal(frame.shoulderSign, shoulder);
		});
	}
}

for (const [name, fn] of checks) fn();
console.log(`PLAYER_COMBAT_CAMERA_INPUT_PARITY_OK checks=${checks.length}`);
