#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createImmersiveAudioPolicy, evaluateAudioSource, allocateAudioSources } from '../src/3d/audio/immersiveAudioPolicy.js';
import { createSpatialAudioRegistry } from '../src/3d/audio/spatialAudioRegistry.js';
import { evaluateAudioOcclusion } from '../src/3d/audio/audioOcclusionPolicy.js';
import { createAudioAccessibilityPolicy, applyAudioAccessibilityGain } from '../src/3d/audio/audioAccessibilityPolicy.js';
import { createAudioDuckBus } from '../src/3d/audio/audioDuckBus.js';
import { createAudioCueScheduler } from '../src/3d/audio/audioCueScheduler.js';
import { buildVisibilityBudget, classifyDistance, visibilityTargetCount } from '../src/3d/platform/runtimeVisibilityBudget.js';

const qualities = ['minimal', 'balanced', 'high', 'ultra'];
const environments = ['plains', 'forest', 'coast', 'river', 'mountain', 'settlement', 'castle', 'ice', 'night', 'storm', 'unknown'];
const distances = [0, 2, 6, 12, 30, 60, 120, 240, 500];
const classes = ['player', 'npc', 'animal', 'creature', 'dragon', 'water', 'wind', 'rain', 'fire', 'ambience', 'music'];
let cases = 0;
let failures = 0;
function property(name, fn) {
	cases += 1;
	try { fn(); } catch (error) { failures += 1; console.error(`FAIL ${name}: ${error?.message ?? error}`); }
}

for (const quality of qualities) {
	for (const environment of environments) {
		for (const distance of distances) {
			for (const sourceClass of classes) {
				property(`${quality}/${environment}/${distance}/${sourceClass}`, () => {
					const policy = createImmersiveAudioPolicy({ quality, environment, masterVolume: 0.8, maxDistance: 120 });
					const source = evaluateAudioSource({ id: `${sourceClass}-${distance}`, class: sourceClass, distance, gain: 1, positional: sourceClass !== 'music' });
					const decision = evaluateAudioSource({ id: `${sourceClass}-${distance}`, class: sourceClass, distance, gain: 1, positional: sourceClass !== 'music' }, policy);
					assert.ok(decision.gains.final >= 0 && decision.gains.final <= 1);
					assert.ok(sourceClass === decision.class);
					if (distance >= policy.listener.maxDistance) assert.equal(decision.audible, false);
				});
			}
		}
	}
}

for (const quality of qualities) {
	property(`allocation/${quality}`, () => {
		const policy = createImmersiveAudioPolicy({ quality, environment: 'castle' });
		const requests = Array.from({ length: 80 }, (_, index) => ({ id: `s-${index}`, class: index % 7 === 0 ? 'dragon' : 'ambience', distance: index * 2, priority: index % 7 === 0 ? 95 : 20, gain: 0.5 }));
		const result = allocateAudioSources(requests, policy);
		assert.ok(result.admitted <= policy.limits.maxSources);
		assert.ok(result.remainingVoices >= 0);
		assert.equal(result.sources.filter((source) => source.audible).length, result.admitted);
	});
}

for (const coarsePointer of [false, true]) {
	for (const reducedMotion of [false, true]) {
		property(`accessibility/${coarsePointer}/${reducedMotion}`, () => {
			const policy = createImmersiveAudioPolicy({ quality: 'ultra', coarsePointer, reducedMotion });
			if (coarsePointer) assert.ok(policy.limits.maxPositionalSources <= 6);
			const accessibility = createAudioAccessibilityPolicy({ softTransients: reducedMotion });
			const gain = applyAudioAccessibilityGain(1, accessibility, { transient: true });
			assert.ok(gain >= 0 && gain <= 1);
		});
	}
}

for (const material of ['stone', 'wood', 'earth', 'metal', 'ice', 'foliage', 'water', 'unknown']) {
	for (const surfaces of [0, 1, 2, 4, 8]) {
		property(`occlusion/${material}/${surfaces}`, () => {
			const decision = evaluateAudioOcclusion({ blocked: true, material, surfaceCount: surfaces, thicknessMeters: surfaces * 2 });
			assert.ok(decision.gain > 0 && decision.gain <= 0.9);
			assert.ok(decision.cutoffHz >= 180 && decision.cutoffHz <= 18000);
			assert.ok(decision.severity >= 0.1 && decision.severity <= 1);
		});
	}
}

property('registry deterministic admission', () => {
	const registry = createSpatialAudioRegistry({ maxSources: 12, maxPositionalSources: 8, maxDistance: 100 });
	for (let i = 0; i < 40; i += 1) registry.register({ id: `source-${i}`, class: i % 2 ? 'ambience' : 'npc', priority: i % 2 ? 20 : 60, position: { x: i, y: 0, z: i % 3 } });
	const a = registry.selectAdmissions({ listenerPosition: { x: 0, y: 0, z: 0 } });
	const b = registry.selectAdmissions({ listenerPosition: { x: 0, y: 0, z: 0 } });
	assert.deepEqual(a, b);
});

property('ducking remains bounded over long updates', () => {
	const bus = createAudioDuckBus({ attackSeconds: 0.03, releaseSeconds: 0.2 });
	bus.request('combat', { active: true, id: 'combat' });
	for (let i = 0; i < 300; i += 1) bus.update(0.016);
	for (const gain of Object.values(bus.snapshot().gains)) assert.ok(gain >= 0 && gain <= 1);
	bus.clear('combat');
	for (let i = 0; i < 300; i += 1) bus.update(0.016);
	assert.ok(bus.gain('music') > 0.8);
});

property('cue scheduler remains bounded', () => {
	const scheduler = createAudioCueScheduler({ maxQueue: 12 });
	for (let i = 0; i < 500; i += 1) scheduler.enqueue({ id: `cue-${i}`, kind: i % 2 ? 'ambience' : 'combat', priority: i % 2 ? 10 : 90 });
	assert.ok(scheduler.snapshot().queued <= 12);
});

for (const tier of qualities) {
	const budget = buildVisibilityBudget({ tier, drawDistance: 1200, maxObjects: 3000 });
	for (const distance of [0, 50, 100, 250, 600, 1000, 1500]) {
		property(`visibility/${tier}/${distance}`, () => {
			const band = classifyDistance(distance, budget);
			const count = visibilityTargetCount(band, budget);
			assert.ok(['near', 'mid', 'far', 'culled'].includes(band));
			assert.ok(count >= 0);
			if (band === 'culled') assert.equal(count, 0);
		});
	}
}

console.log(`IMMERSIVE_AUDIO_PROPERTY_CASES=${cases}`);
console.log(`IMMERSIVE_AUDIO_PROPERTY_FAILURES=${failures}`);
console.log(`IMMERSIVE_AUDIO_PROPERTY_MATRIX_${failures ? 'FAIL' : 'PASS'}`);
if (failures) process.exit(1);
