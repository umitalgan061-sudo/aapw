import assert from 'node:assert/strict';
import { evaluateContinuousEmitter, CONTINUOUS_AUDIO_EMITTERS } from '../src/3d/audio/audioContinuousEmitterPolicy.js';
import { evaluateDynamicRange, AUDIO_RANGE_MODES } from '../src/3d/audio/audioDynamicRangePolicy.js';
import { evaluateDialogueClarity } from '../src/3d/audio/audioDialogueClarityPolicy.js';
import { createSpatialAudioRegistry } from '../src/3d/audio/spatialAudioRegistry.js';
import { evaluateAudioSpatialMotion } from '../src/3d/audio/audioSpatialMotionPolicy.js';
import { resolveAudioEnvironment } from '../src/3d/audio/audioEnvironmentResolver.js';
import { evaluateAudioOcclusion } from '../src/3d/audio/audioOcclusionPolicy.js';
import { evaluateAudioZone } from '../src/3d/audio/audioZonePolicy.js';
import { evaluateAudioPerformanceBudget } from '../src/3d/audio/audioPerformanceBudget.js';

const state = JSON.parse(JSON.stringify({
	listener: { x: 0, y: 2, z: 0 },
	position: { x: 8, y: 2, z: -12 },
	velocity: { x: 7, y: 0, z: -3 },
	world: { humidity: 0.7, wind: 0.8, rain: 0.25, night: 0.65, temperature: 0.35 },
}));

const registry = createSpatialAudioRegistry({ maxSources: 12, maxPositionalSources: 6, maxDistance: 120 });
for (let i = 0; i < 14; i += 1) {
	registry.register({
		id: `ambient-${i}`,
		class: i % 2 ? 'world' : 'combat',
		position: { x: i * 6, y: 1, z: -i * 3 },
		priority: 20 + (i % 5) * 15,
		voiceCost: i % 3 === 0 ? 1.5 : 1,
		gain: 0.35 + (i % 4) * 0.1,
	});
}
const admission = registry.selectAdmissions({ listenerPosition: state.listener });
assert.ok(admission.admitted <= 12);
assert.ok(admission.remainingVoices >= 0);
assert.ok(admission.sources.every((source) => source.distance >= 0 && source.distance <= 120));
assert.ok(admission.sources.length <= 6);

const emitterReceipts = Object.values(CONTINUOUS_AUDIO_EMITTERS).map((kind, index) => evaluateContinuousEmitter({
	id: `continuous-${kind}`,
	kind,
	position: { x: state.position.x + index * 9, y: state.position.y, z: state.position.z - index * 4 },
	energy: 0.7,
	baseGain: 0.5,
	occlusion: index / 12,
}, state.listener, state.world));
assert.equal(emitterReceipts.length, 8);
assert.ok(emitterReceipts.every((receipt) => receipt.gain >= 0 && receipt.gain <= 1));

const range = Object.values(AUDIO_RANGE_MODES).map((mode, index) => evaluateDynamicRange({
	mode,
	gain: 0.5 + index * 0.1,
	transient: index / 3,
	speechPriority: index === 1,
	userGain: 0.9,
}));
assert.ok(range.every((receipt) => receipt.outputGain >= 0 && receipt.outputGain <= 1));

const dialogue = evaluateDialogueClarity({
	baseGain: 0.72,
	ambience: 0.8,
	weather: 0.6,
	combat: 0.4,
	distance: 24,
	occlusion: 0.45,
	reducedHearing: true,
});
assert.ok(dialogue.gain >= 0.08 && dialogue.gain <= 1);
assert.ok(dialogue.lowpassHz >= 1500);

const motion = evaluateAudioSpatialMotion({
	velocity: state.velocity,
	relativeVelocity: { x: 5, y: 0, z: -2 },
	maxDopplerShift: 0.18,
});
assert.ok(motion.playbackRate >= 0.82 && motion.playbackRate <= 1.18);

const environment = resolveAudioEnvironment({
	biome: 'forest',
	weather: 'storm',
	nightFactor: 0.65,
	waterFactor: 0.2,
	interior: false,
});
assert.equal(environment.version, 1);
assert.ok(environment.ambienceGain >= 0 && environment.ambienceGain <= 1);

const occlusion = evaluateAudioOcclusion({
	material: 'stone',
	distance: 16,
	blocked: true,
	thickness: 2,
});
assert.ok(occlusion.gain >= 0 && occlusion.gain <= 1);
assert.ok(occlusion.lowpassHz >= 180);

const zone = evaluateAudioZone({
	zoneType: 'castle',
	distance: 11,
	roomSize: 0.6,
	wallAbsorption: 0.35,
});
assert.equal(zone.version, 1);
assert.ok(zone.reverbMix >= 0 && zone.reverbMix <= 1);

const perf = evaluateAudioPerformanceBudget({
	activeVoices: admission.admitted,
	maxVoices: 48,
	positionalVoices: admission.sources.length,
	maxPositionalVoices: 28,
	queuedCues: 7,
});
assert.equal(perf.version, 1);
assert.equal(perf.withinBudget, true);

const repeat = {
	admission: registry.selectAdmissions({ listenerPosition: state.listener }),
	emitterReceipts: Object.values(CONTINUOUS_AUDIO_EMITTERS).map((kind, index) => evaluateContinuousEmitter({
		id: `continuous-${kind}`,
		kind,
		position: { x: state.position.x + index * 9, y: state.position.y, z: state.position.z - index * 4 },
		energy: 0.7,
		baseGain: 0.5,
		occlusion: index / 12,
	}, state.listener, state.world)),
};
assert.deepEqual({ admission, emitterReceipts }, repeat);

console.log(JSON.stringify({
	contract: 'immersive-audio-regression-matrix',
	version: 1,
	registry: { admitted: admission.admitted, virtualized: admission.virtualized },
	emitters: emitterReceipts.length,
	dynamicRangeModes: range.length,
	dialogue,
	motion,
	environment,
	occlusion,
	zone,
	performance: perf,
	deterministic: true,
}, null, 2));
