#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import { sampleNormalizedReferenceMountainReliefMeters } from '../src/3d/world/worldReferenceMountainRelief.js';
import { sampleMountainRidgeFrame } from '../src/3d/world/worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const EPSILON = 1e-8;
const PROFILE_STEP = 2.5e-5;
const rounded = (value, digits = 8) => Number(value.toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const percentile = (values, fraction) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
};

function normalize(x, y) {
	const length = Math.hypot(x, y);
	return length > 1e-12 ? [x / length, y / length] : [1, 0];
}

function sampleSafe(x, y) {
	if (x < 0 || x > 1 || y < 0 || y > 1) return null;
	const height = sampleNormalizedReferenceMountainReliefMeters(x, y);
	assert(Number.isFinite(height), `non-finite mountain relief at ${x}/${y}`);
	return height;
}

const evidence = {};
const epsilonDeltas = [];
const crossingDeltas = [];
const frameDistanceJumps = [];
let jointCount = 0;
let deterministicSamples = 0;

for (const chain of REFERENCE_RELIEF_CHAINS) {
	const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
	const chainEvidence = [];
	for (let jointIndex = 1; jointIndex < chain.points.length - 1; jointIndex += 1) {
		jointCount += 1;
		const previous = chain.points[jointIndex - 1];
		const joint = chain.points[jointIndex];
		const next = chain.points[jointIndex + 1];
		const incoming = normalize(joint[0] - previous[0], joint[1] - previous[1]);
		const outgoing = normalize(next[0] - joint[0], next[1] - joint[1]);
		const bisector = normalize(incoming[0] + outgoing[0], incoming[1] + outgoing[1]);
		const normal = [-bisector[1], bisector[0]];
		const center = sampleSafe(joint[0], joint[1]);
		const centerAgain = sampleSafe(joint[0], joint[1]);
		assert.equal(center, centerAgain, `${chain.id} joint ${jointIndex}: relief is not deterministic`);
		deterministicSamples += 1;

		const neighborHeights = [];
		for (const [dx, dy] of [
			[EPSILON, 0], [-EPSILON, 0], [0, EPSILON], [0, -EPSILON],
			[EPSILON, EPSILON], [-EPSILON, EPSILON], [EPSILON, -EPSILON], [-EPSILON, -EPSILON],
		]) {
			const value = sampleSafe(joint[0] + dx, joint[1] + dy);
			if (value == null) continue;
			const delta = Math.abs(value - center);
			epsilonDeltas.push(delta);
			neighborHeights.push(value);
			assert(delta < 0.25,
				`${chain.id} joint ${jointIndex}: epsilon height discontinuity ${delta.toFixed(6)}m`);
		}

		const before = sampleSafe(
			joint[0] - incoming[0] * PROFILE_STEP,
			joint[1] - incoming[1] * PROFILE_STEP,
		);
		const after = sampleSafe(
			joint[0] + outgoing[0] * PROFILE_STEP,
			joint[1] + outgoing[1] * PROFILE_STEP,
		);
		if (before != null && after != null) {
			const crossingDelta = Math.abs(after - before);
			crossingDeltas.push(crossingDelta);
			assert(crossingDelta < 25,
				`${chain.id} joint ${jointIndex}: ridge crossing produces a vertical-strip jump ${crossingDelta.toFixed(3)}m`);
		}

		const leftPoint = [joint[0] + normal[0] * PROFILE_STEP, joint[1] + normal[1] * PROFILE_STEP];
		const rightPoint = [joint[0] - normal[0] * PROFILE_STEP, joint[1] - normal[1] * PROFILE_STEP];
		const leftFrame = sampleMountainRidgeFrame(leftPoint[0], leftPoint[1], compiled, MAP_ASPECT);
		const rightFrame = sampleMountainRidgeFrame(rightPoint[0], rightPoint[1], compiled, MAP_ASPECT);
		const centerFrame = sampleMountainRidgeFrame(joint[0], joint[1], compiled, MAP_ASPECT);
		for (const frame of [leftFrame, centerFrame, rightFrame]) {
			assert(Number.isFinite(frame.distance), `${chain.id}: ridge-frame distance became non-finite`);
			assert(frame.progress >= 0 && frame.progress <= 1, `${chain.id}: ridge-frame progress escaped [0,1]`);
		}
		const frameJump = Math.max(
			Math.abs(leftFrame.distance - centerFrame.distance),
			Math.abs(rightFrame.distance - centerFrame.distance),
		);
		frameDistanceJumps.push(frameJump);
		assert(frameJump < PROFILE_STEP * MAP_ASPECT * 1.5,
			`${chain.id} joint ${jointIndex}: local frame distance jumps at polyline join`);

		const lateralHeights = [];
		for (let index = -4; index <= 4; index += 1) {
			const value = sampleSafe(
				joint[0] + normal[0] * PROFILE_STEP * index,
				joint[1] + normal[1] * PROFILE_STEP * index,
			);
			if (value != null) lateralHeights.push(value);
		}
		const lateralSteps = lateralHeights.slice(1).map((value, index) => Math.abs(value - lateralHeights[index]));
		assert(lateralSteps.every((value) => Number.isFinite(value)), `${chain.id}: non-finite lateral ridge step`);
		assert(Math.max(...lateralSteps, 0) < 22,
			`${chain.id} joint ${jointIndex}: near-joint lateral profile contains a vertical strip`);

		chainEvidence.push({
			jointIndex,
			centerHeight: rounded(center, 4),
			maxEpsilonDelta: rounded(Math.max(...neighborHeights.map((value) => Math.abs(value - center)), 0)),
			crossingDelta: rounded(before != null && after != null ? Math.abs(after - before) : 0, 4),
			frameJump: rounded(frameJump),
		});
	}
	evidence[chain.id] = chainEvidence;
}

assert(jointCount >= 4, 'canonical relief has too few interior joints for continuity qualification');
assert(epsilonDeltas.length >= jointCount * 4, 'ridge-joint epsilon coverage is too small');
assert(Math.max(...epsilonDeltas) < 0.25, 'mountain relief has an epsilon discontinuity at a ridge joint');
assert(percentile(crossingDeltas, 0.95) < 20, 'ridge joints contain excessive profile crossing jumps');
assert(mean(frameDistanceJumps) < PROFILE_STEP * MAP_ASPECT,
	'ridge-frame join distance is not locally continuous');

console.log('MOUNTAIN_RIDGE_JOINT_CONTINUITY_OK', JSON.stringify({
	chainCount: REFERENCE_RELIEF_CHAINS.length,
	jointCount,
	deterministicSamples,
	maxEpsilonDeltaMeters: rounded(Math.max(...epsilonDeltas), 6),
	crossingDeltaP95Meters: rounded(percentile(crossingDeltas, 0.95), 4),
	meanFrameDistanceJump: rounded(mean(frameDistanceJumps), 10),
	evidence,
}));
