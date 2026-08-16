#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createNpcSimulationLod, deterministicNpcPhaseSeconds } from '../src/3d/gameplay/npcSimulationLod.js';

const frameDelta = 1 / 60;
const farDistance = 500;
const nearDistance = 20;
const farIntervalSeconds = 0.25;
const maxStepSeconds = 0.25;

const phases = new Set([
	'a-guard', 'b-guard', 'c-guard', 'd-guard', 'e-guard', 'f-guard',
].map((id) => deterministicNpcPhaseSeconds(id, farIntervalSeconds).toFixed(6)));
assert.ok(phases.size >= 4, 'deterministic NPC ids should stagger far-simulation phases');

const farSchedulers = Array.from({ length: 100 }, (_, index) => createNpcSimulationLod({
	id: `far-${index}`,
	nearRadiusMeters: 90,
	farIntervalSeconds,
	maxStepSeconds,
}));
let farSimulationSteps = 0;
let maxFarStepsInFrame = 0;
for (let frame = 0; frame < 60; frame += 1) {
	let frameSteps = 0;
	for (const scheduler of farSchedulers) {
		const step = scheduler.step(frameDelta, farDistance, false);
		assert.ok(step >= 0 && step <= maxStepSeconds, 'far step must remain bounded');
		if (step > 0) frameSteps += 1;
	}
	farSimulationSteps += frameSteps;
	maxFarStepsInFrame = Math.max(maxFarStepsInFrame, frameSteps);
}
assert.ok(farSimulationSteps < 100 * 60 * 0.12,
	'100 far NPCs must not execute full behavior/animation work every render frame');
assert.ok(maxFarStepsInFrame < 20,
	'deterministic staggering must prevent all far NPCs from waking on the same frame');

const near = createNpcSimulationLod({
	id: 'near-guard', nearRadiusMeters: 90, farIntervalSeconds, maxStepSeconds,
});
for (let frame = 0; frame < 120; frame += 1) {
	assert.equal(near.step(frameDelta, nearDistance, false), frameDelta,
		'near NPC behavior must remain render-frame responsive');
}

const urgent = createNpcSimulationLod({
	id: 'urgent-guard', nearRadiusMeters: 90, farIntervalSeconds, maxStepSeconds,
});
for (let frame = 0; frame < 20; frame += 1) urgent.step(frameDelta, farDistance, false);
assert.equal(urgent.step(frameDelta, farDistance, true), frameDelta,
	'urgent/alert NPC must bypass far throttling immediately');
assert.equal(urgent.tier, 'urgent');
assert.equal(urgent.step(5, nearDistance, false), maxStepSeconds,
	'multi-second frame hitch must clamp simulation delta');

console.log('NPC_SIMULATION_LOD_PASS', JSON.stringify({
	farNpcCount: farSchedulers.length,
	farSimulationSteps,
	fullRateEquivalentSteps: farSchedulers.length * 60,
	maxFarStepsInFrame,
	nearTicksVerified: 120,
	maxStepSeconds,
}));
