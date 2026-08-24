#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNPC } from '../src/3d/gameplay/npc.js';

function createFakeLoader() {
	return {
		async loadFBXModel() {
			const group = new THREE.Group();
			group.animations = [];
			return group;
		},
	};
}

async function runHearingTrace({ stepSeconds, steps }) {
	const guard = await createNPC({
		assetLoader: createFakeLoader(),
		modelUrl: 'guard-test.fbx',
		idleAnimationUrl: 'idle-test.fbx',
		worldX: 0,
		worldZ: 0,
		groundY: 0,
		rotationYRadians: 0,
		name: `hearing-${steps}`,
		speedMps: 0,
		turnRateRadiansPerSecond: 0,
		combatStanceTriggerRadiusMeters: 20,
		perceptionEnabled: true,
		simulationLodEnabled: false,
		simulationLodMaxStepSeconds: 0.25,
	});

	guard.update(stepSeconds, { x: 0, z: -10 });
	for (let i = 0; i < steps; i += 1) {
		const elapsed = (i + 1) * stepSeconds;
		guard.update(stepSeconds, { x: 7 * elapsed, z: -10 });
	}

	const perception = guard.object3D.userData.npcPerception;
	assert.equal(perception.reason, 'hearing', 'the proof target must remain behind the guard and be acquired by hearing');
	assert.equal(perception.heard, true, 'the moving target must remain inside the deterministic hearing envelope');
	return perception.suspicion;
}

const sixtyHzSuspicion = await runHearingTrace({ stepSeconds: 1 / 60, steps: 60 });
const fourHzSuspicion = await runHearingTrace({ stepSeconds: 0.25, steps: 4 });

assert.equal(sixtyHzSuspicion, 0.72, 'one second of full-strength hearing must accumulate the configured time-based suspicion');
assert.equal(fourHzSuspicion, 0.72, 'coarse simulation must accumulate the same one-second hearing suspicion');
assert.equal(sixtyHzSuspicion, fourHzSuspicion, 'hearing suspicion must be frame-rate invariant for equal simulated time');

console.log('NPC_HEARING_FRAMERATE_DETERMINISM_PASS', JSON.stringify({
	sixtyHzSuspicion,
	fourHzSuspicion,
	simulatedSeconds: 1,
}));
