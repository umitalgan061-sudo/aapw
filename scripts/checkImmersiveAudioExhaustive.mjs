#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createImmersiveAudioPolicy, evaluateAudioSource } from '../src/3d/audio/immersiveAudioPolicy.js';
import { createSpatialAudioRegistry } from '../src/3d/audio/spatialAudioRegistry.js';
import { createAudioDuckBus } from '../src/3d/audio/audioDuckBus.js';
import { createAudioCueScheduler } from '../src/3d/audio/audioCueScheduler.js';
import { createAudioFocusManager } from '../src/3d/audio/audioFocusManager.js';
import { createAudioStemDirector } from '../src/3d/audio/audioStemDirector.js';
import { createRuntimeAudio } from '../src/3d/audio/immersiveAudioDirector.js';
import { createAudioAccessibilityPolicy } from '../src/3d/audio/audioAccessibilityPolicy.js';
import { createAudioPerformanceBudget } from '../src/3d/audio/audioPerformanceBudget.js';
import { createResonancePolicy, blendResonance } from '../src/3d/audio/audioResonancePolicy.js';

function test(name, fn) { fn(); console.log(`PASS ${name}`); }

const qualities = ['minimal', 'balanced', 'high', 'ultra'];
const classes = ['player', 'npc', 'animal', 'creature', 'dragon', 'water', 'wind', 'rain', 'fire', 'ui', 'ambience', 'music', 'debug'];
const environments = ['plains', 'forest', 'coast', 'river', 'mountain', 'settlement', 'castle', 'ice', 'night', 'storm'];

for (const quality of qualities) {
	for (const environment of environments) {
		const policy = createImmersiveAudioPolicy({ quality, environment });
		for (const sourceClass of classes) {
			for (const distance of [0, 1, 5, 20, 60, 119, 120, 121, 500]) {
				test(`source/${quality}/${environment}/${sourceClass}/${distance}`, () => {
					const decision = evaluateAudioSource({ id: `${sourceClass}-${distance}`, class: sourceClass, distance, gain: 1 }, policy);
					assert.ok(decision.gains.final >= 0 && decision.gains.final <= 1);
					assert.ok(decision.gains.distance >= 0 && decision.gains.distance <= 1);
					if (distance >= policy.listener.maxDistance) assert.equal(decision.audible, false);
				});
			}
		}
	}
}

test('registry source cap', () => {
	const registry = createSpatialAudioRegistry({ maxSources: 4 });
	for (let index = 0; index < 100; index += 1) registry.register({ id: `source-${index}`, priority: index, position: { x: index, y: 0, z: 0 } });
	assert.equal(registry.snapshot().sourceCount, 4);
});

test('registry update normalizes malformed position', () => {
	const registry = createSpatialAudioRegistry({ maxSources: 4 });
	registry.register({ id: 'x', position: { x: NaN, y: Infinity, z: -4 } });
	const updated = registry.update('x', { position: { x: 'bad', y: 2, z: 3 } });
	assert.deepEqual(updated.position, { x: 0, y: 2, z: 3 });
});

test('registry virtualizes sources outside max distance', () => {
	const registry = createSpatialAudioRegistry({ maxSources: 4, maxDistance: 50 });
	registry.register({ id: 'near', priority: 10, position: { x: 4, y: 0, z: 0 } });
	registry.register({ id: 'far', priority: 100, position: { x: 500, y: 0, z: 0 } });
	const result = registry.selectAdmissions({ listenerPosition: { x: 0, y: 0, z: 0 } });
	assert.equal(result.sources.length, 1);
	assert.equal(result.sources[0].id, 'near');
});

test('ducking can recover after high-priority cue', () => {
	const bus = createAudioDuckBus({ attackSeconds: 0.05, releaseSeconds: 0.1 });
	bus.request('combat', { id: 'c', active: true, amount: 0.2, priority: 100 });
	for (let index = 0; index < 10; index += 1) bus.update(0.016);
	const ducked = bus.gain('music');
	bus.clear('c');
	for (let index = 0; index < 30; index += 1) bus.update(0.016);
	assert.ok(bus.gain('music') > ducked);
});

test('focus policy is bounded', () => {
	const focus = createAudioFocusManager();
	for (const mode of ['playing', 'menu', 'background', 'debug', 'recovery', 'unknown', 'garbage']) {
		focus.setFocus(mode);
		for (let index = 0; index < 20; index += 1) focus.update(0.016);
		for (const gain of Object.values(focus.snapshot().current)) assert.ok(gain >= 0 && gain <= 1);
	}
});

test('music stems never exceed configured active stem count', () => {
	const stems = createAudioStemDirector({ maxStems: 2 });
	for (const stem of ['exploration', 'settlement', 'night', 'storm', 'danger', 'combat']) stems.request(stem, { priority: stem === 'combat' ? 100 : 10 });
	assert.ok(stems.snapshot().active.length <= 2);
});

test('accessibility profiles remain deterministic', () => {
	for (const profile of ['full', 'reduced-dynamic-range', 'soft-transients', 'mono-center']) {
		const policy = createAudioAccessibilityPolicy({ profile });
		assert.equal(Object.isFrozen(policy), true);
		assert.ok(policy.dynamicRange.compressorRatio >= 3);
	}
});

test('performance budgets degrade under pressure', () => {
	const calm = createAudioPerformanceBudget({ quality: 'ultra', measuredCpuMs: 0.5, measuredSources: 2, measuredTransientRate: 2 });
	const pressure = createAudioPerformanceBudget({ quality: 'ultra', measuredCpuMs: 12, measuredSources: 48, measuredTransientRate: 60 });
	assert.ok(pressure.pressure > calm.pressure);
	assert.ok(pressure.budget.maxProceduralLayers <= calm.budget.maxProceduralLayers);
});

test('resonance responds to enclosure and surface', () => {
	const open = createResonancePolicy({ surface: 'open', enclosure: 0, distance: 20, roomSize: 100 });
	const cave = createResonancePolicy({ surface: 'stone', enclosure: 1, distance: 2, roomSize: 30 });
	assert.ok(cave.resonance > open.resonance);
	const blend = blendResonance(open, cave, 0.1);
	assert.ok(blend.resonance > open.resonance);
});

test('cue scheduler history remains bounded', () => {
	const scheduler = createAudioCueScheduler({ maxHistory: 16 });
	for (let index = 0; index < 100; index += 1) { scheduler.enqueue({ id: `cue-${index}`, kind: 'combat', priority: index % 2 ? 90 : 30 }); scheduler.dequeue(1); scheduler.advance(0.2); }
	assert.ok(scheduler.snapshot().history <= 16);
});

test('quality policies can be re-evaluated repeatedly without mutation leaks', () => {
	for (const quality of qualities) {
		const first = createImmersiveAudioPolicy({ quality, environment: 'forest' });
		const second = createImmersiveAudioPolicy({ quality, environment: 'forest' });
		assert.deepEqual(first, second);
		assert.equal(Object.isFrozen(first), true);
	}
});

console.log('IMMERSIVE_AUDIO_EXHAUSTIVE_PASS');
