import assert from 'node:assert/strict';
import {
	evaluateContinuousEmitter,
	validateContinuousEmitterReceipt,
	summarizeContinuousEmitterReceipts,
	CONTINUOUS_AUDIO_EMITTERS,
} from '../src/3d/audio/audioContinuousEmitterPolicy.js';
import {
	evaluateDynamicRange,
	summarizeDynamicRange,
	AUDIO_RANGE_MODES,
} from '../src/3d/audio/audioDynamicRangePolicy.js';
import {
	evaluateDialogueClarity,
	validateDialogueClarityReceipt,
} from '../src/3d/audio/audioDialogueClarityPolicy.js';

const emitterKinds = Object.values(CONTINUOUS_AUDIO_EMITTERS);
assert.equal(emitterKinds.length, 8);

const receipts = emitterKinds.map((kind, index) => evaluateContinuousEmitter({
	id: `emitter-${kind}`,
	kind,
	position: { x: index * 14, y: index % 2, z: -index * 9 },
	baseGain: 0.55,
	energy: 0.7,
	occlusion: index === 4 ? 0.8 : 0.1,
}, { x: 4, y: 1, z: -6 }, {
	humidity: 0.64,
	wind: 0.71,
	rain: index === 2 ? 0.9 : 0.08,
	night: 0.75,
	temperature: 0.35,
}));

for (const receipt of receipts) {
	assert.equal(validateContinuousEmitterReceipt(receipt), true);
	assert.ok(receipt.gain >= 0 && receipt.gain <= 1);
	assert.ok(receipt.lowpassHz >= 180 && receipt.lowpassHz <= 4500);
}

const summary = summarizeContinuousEmitterReceipts(receipts);
assert.equal(summary.total, 8);
assert.equal(summary.valid, 8);
assert.ok(summary.active <= 8);

const repeat = emitterKinds.map((kind, index) => evaluateContinuousEmitter({
	id: `emitter-${kind}`,
	kind,
	position: { x: index * 14, y: index % 2, z: -index * 9 },
	baseGain: 0.55,
	energy: 0.7,
	occlusion: index === 4 ? 0.8 : 0.1,
}, { x: 4, y: 1, z: -6 }, {
	humidity: 0.64,
	wind: 0.71,
	rain: index === 2 ? 0.9 : 0.08,
	night: 0.75,
	temperature: 0.35,
}));
assert.deepEqual(receipts, repeat);

const rangeSamples = Object.values(AUDIO_RANGE_MODES).map((mode, index) => evaluateDynamicRange({
	mode,
	gain: 0.92 - index * 0.08,
	transient: index / 4,
	speechPriority: index % 2 === 0,
	userGain: 0.84,
}));
assert.equal(rangeSamples.length, 4);
for (const sample of rangeSamples) {
	assert.equal(sample.version, 1);
	assert.ok(sample.outputGain >= 0 && sample.outputGain <= 1);
	assert.ok(sample.transientScale > 0 && sample.transientScale <= 1);
}
const rangeSummary = summarizeDynamicRange(rangeSamples);
assert.equal(rangeSummary.valid, 4);
assert.ok(rangeSummary.average > 0);

const fullRange = evaluateDynamicRange({ mode: AUDIO_RANGE_MODES.FULL, gain: 1, transient: 0 });
const reducedRange = evaluateDynamicRange({ mode: AUDIO_RANGE_MODES.REDUCED, gain: 1, transient: 1 });
assert.ok(reducedRange.outputGain <= fullRange.outputGain);
assert.ok(reducedRange.transientScale < fullRange.transientScale);

const dialogueCases = [
	evaluateDialogueClarity({ distance: 2, ambience: 0.1, weather: 0, combat: 0, occlusion: 0 }),
	evaluateDialogueClarity({ distance: 62, ambience: 0.8, weather: 0.9, combat: 0.6, occlusion: 0.7 }),
	evaluateDialogueClarity({ distance: 28, ambience: 0.4, weather: 0.25, combat: 0.1, occlusion: 0.2, reducedHearing: true }),
];
for (const receipt of dialogueCases) {
	assert.equal(validateDialogueClarityReceipt(receipt), true);
	assert.ok(receipt.gain >= 0.08 && receipt.gain <= 1);
	assert.ok(receipt.lowpassHz >= 1500 && receipt.lowpassHz <= 5600);
}
assert.ok(dialogueCases[0].lowpassHz > dialogueCases[1].lowpassHz);
assert.equal(dialogueCases[2].reducedHearing, true);

console.log(JSON.stringify({
	contract: 'immersive-audio-experience-policies',
	version: 1,
	emitter: summary,
	dynamicRange: rangeSummary,
	dialogue: dialogueCases.map(({ gain, lowpassHz, competingAmbienceSuppression }) => ({ gain, lowpassHz, competingAmbienceSuppression })),
	deterministic: JSON.stringify(receipts) === JSON.stringify(repeat),
}, null, 2));
