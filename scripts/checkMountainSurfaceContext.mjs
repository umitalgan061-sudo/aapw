#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
	REFERENCE_RELIEF_CHAINS,
	WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import { sampleMountainGeomorphologyContext } from '../src/3d/world/worldReferenceMountainGeomorphology.js';
import {
	offsetMountainFramePoint,
	sampleMountainRidgeFrame,
} from '../src/3d/world/worldReferenceMountainRidgeFrame.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const rounded = (value, digits = 6) => Number(value.toFixed(digits));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const evidence = {};
let globalTalusCandidates = 0;
let globalBedrockCandidates = 0;
for (const chain of REFERENCE_RELIEF_CHAINS) {
	const compiled = chain.points.map(([x, y]) => [x * MAP_ASPECT, y]);
	const crestBedrock = [];
	const midTalus = [];
	const outerTalus = [];
	const sidePairs = [];

	for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
		const a = chain.points[segmentIndex];
		const b = chain.points[segmentIndex + 1];
		for (const t of [0.12, 0.24, 0.36, 0.50, 0.64, 0.78, 0.90]) {
			const x = a[0] + (b[0] - a[0]) * t;
			const y = a[1] + (b[1] - a[1]) * t;
			const frame = sampleMountainRidgeFrame(x, y, compiled, MAP_ASPECT);
			const seed = 71 + segmentIndex * 53;

			for (const [label, fraction] of [['crest', 0.12], ['mid', 0.68], ['outer', 0.90]]) {
				const physical = fraction * 0.08;
				const leftPoint = offsetMountainFramePoint(frame, -physical, 0, MAP_ASPECT);
				const rightPoint = offsetMountainFramePoint(frame, physical, 0, MAP_ASPECT);
				const left = sampleMountainGeomorphologyContext(leftPoint.x, leftPoint.y, compiled, MAP_ASPECT, fraction, seed);
				const right = sampleMountainGeomorphologyContext(rightPoint.x, rightPoint.y, compiled, MAP_ASPECT, fraction, seed);
				if (label === 'crest') crestBedrock.push(left.bedrockExposure, right.bedrockExposure);
				if (label === 'mid') midTalus.push(left.talusExposure, right.talusExposure);
				if (label === 'outer') outerTalus.push(left.talusExposure, right.talusExposure);
				sidePairs.push({
					fraction,
					leftTalus: left.talusExposure,
					rightTalus: right.talusExposure,
					leftBedrock: left.bedrockExposure,
					rightBedrock: right.bedrockExposure,
				});
			}
		}
	}

	assert(crestBedrock.length > 10, `${chain.id}: insufficient crest context samples`);
	assert(midTalus.length > 10, `${chain.id}: insufficient talus context samples`);
	assert(average(crestBedrock) > 0.25, `${chain.id}: crest bedrock context is too weak for geology placement`);
	assert(Math.max(...midTalus) > 0.08, `${chain.id}: talus context never activates on middle shoulders`);
	assert(average(outerTalus) < average(midTalus) + 0.08, `${chain.id}: talus exposure grows unnaturally at support edge`);

	const talusCandidates = midTalus.filter((value) => value >= 0.08).length;
	const bedrockCandidates = crestBedrock.filter((value) => value >= 0.25).length;
	globalTalusCandidates += talusCandidates;
	globalBedrockCandidates += bedrockCandidates;
	assert(talusCandidates >= 2, `${chain.id}: no useful talus candidate density`);
	assert(bedrockCandidates >= 4, `${chain.id}: no useful bedrock candidate density`);

	const first = sidePairs[0];
	const a = chain.points[0];
	const b = chain.points[1];
	const x = a[0] + (b[0] - a[0]) * 0.12;
	const y = a[1] + (b[1] - a[1]) * 0.12;
	const frame = sampleMountainRidgeFrame(x, y, compiled, MAP_ASPECT);
	const probePoint = offsetMountainFramePoint(frame, -0.12 * 0.08, 0, MAP_ASPECT);
	const repeatA = sampleMountainGeomorphologyContext(probePoint.x, probePoint.y, compiled, MAP_ASPECT, 0.12, 71);
	const repeatB = sampleMountainGeomorphologyContext(probePoint.x, probePoint.y, compiled, MAP_ASPECT, 0.12, 71);
	assert.deepEqual(repeatA, repeatB, `${chain.id}: placement context is not deterministic`);
	assert(Number.isFinite(first.leftTalus) && Number.isFinite(first.rightTalus), `${chain.id}: context contains invalid talus values`);

	evidence[chain.id] = {
		crestBedrockMean: rounded(average(crestBedrock)),
		crestBedrockMax: rounded(Math.max(...crestBedrock)),
		midTalusMean: rounded(average(midTalus)),
		midTalusMax: rounded(Math.max(...midTalus)),
		outerTalusMean: rounded(average(outerTalus)),
		talusCandidates,
		bedrockCandidates,
	};
}

assert(globalTalusCandidates >= 8, 'full-world mountain context yields too few talus placement candidates');
assert(globalBedrockCandidates >= 16, 'full-world mountain context yields too few bedrock placement candidates');

console.log('MOUNTAIN_SURFACE_CONTEXT_OK', JSON.stringify({
	chainCount: REFERENCE_RELIEF_CHAINS.length,
	globalTalusCandidates,
	globalBedrockCandidates,
	usage: 'context-only; shared material/placement pipeline remains authoritative for scene assets',
	evidence,
}));
