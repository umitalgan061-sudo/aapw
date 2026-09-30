#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createImmersiveAudioPolicy, evaluateAudioSource, allocateAudioSources } from '../src/3d/audio/immersiveAudioPolicy.js';
import { createSpatialAudioRegistry } from '../src/3d/audio/spatialAudioRegistry.js';
import { createAudioDuckBus } from '../src/3d/audio/audioDuckBus.js';
import { createImmersiveAudioDirector } from '../src/3d/audio/immersiveAudioDirector.js';
import { createAudioAccessibilityPolicy, applyAudioAccessibilityGain } from '../src/3d/audio/audioAccessibilityPolicy.js';
import { evaluateAudioOcclusion, smoothOcclusion } from '../src/3d/audio/audioOcclusionPolicy.js';
import { createAudioSnapshot, audioSnapshotDigest } from '../src/3d/audio/audioSnapshot.js';
import { createAudioCueScheduler } from '../src/3d/audio/audioCueScheduler.js';
import { createEnvironmentSoundscape } from '../src/3d/audio/environmentSoundscape.js';

const checks = [];
function check(name, fn) { fn(); checks.push(name); console.log(`PASS ${name}`); }

const desktop = createImmersiveAudioPolicy({ quality: 'ultra', environment: 'castle', masterVolume: 0.8 });
const mobile = createImmersiveAudioPolicy({ quality: 'ultra', environment: 'storm', coarsePointer: true });

check('audio policy is immutable', () => {
	assert.equal(Object.isFrozen(desktop), true);
	assert.equal(Object.isFrozen(desktop.limits), true);
});

check('mobile voice limits remain bounded', () => {
	assert.ok(mobile.limits.maxSources <= 12);
	assert.ok(mobile.limits.maxPositionalSources <= 6);
});

check('distance attenuation reaches silence at max distance', () => {
	const near = evaluateAudioSource({ id: 'near', class: 'dragon', distance: 2, gain: 1 }, desktop);
	const far = evaluateAudioSource({ id: 'far', class: 'dragon', distance: 999, gain: 1 }, desktop);
	assert.equal(near.audible, true);
	assert.equal(far.audible, false);
	assert.ok(near.gains.final > 0);
});

check('occlusion reduces gain and high frequency', () => {
	const clear = evaluateAudioOcclusion({ blocked: false });
	const blocked = evaluateAudioOcclusion({ blocked: true, material: 'stone', surfaceCount: 2, thicknessMeters: 4 });
	assert.equal(clear.gain, 1);
	assert.ok(blocked.gain < 1);
	assert.ok(blocked.cutoffHz < clear.cutoffHz);
});

check('occlusion smoothing follows target deterministically', () => {
	const next = smoothOcclusion({ gain: 1, cutoffHz: 18000, reverbSend: 0, severity: 0 }, { gain: 0.2, cutoffHz: 500, reverbSend: 0.7, severity: 1 }, 0.05);
	assert.ok(next.gain < 1 && next.gain > 0.2);
	assert.ok(next.cutoffHz < 18000 && next.cutoffHz > 500);
});

const registry = createSpatialAudioRegistry({ maxSources: 3, maxPositionalSources: 2, maxDistance: 50 });
check('spatial registry admits highest priority sources', () => {
	registry.register({ id: 'low', class: 'ambience', priority: 10, position: { x: 1, y: 0, z: 0 } });
	registry.register({ id: 'dragon', class: 'dragon', priority: 95, position: { x: 2, y: 0, z: 0 }, voiceCost: 2 });
	registry.register({ id: 'player', class: 'player', priority: 100, position: { x: 3, y: 0, z: 0 } });
	const selected = registry.selectAdmissions({ listenerPosition: { x: 0, y: 0, z: 0 } });
	assert.equal(selected.sources[0].id, 'player');
	assert.ok(selected.sources.some((item) => item.id === 'dragon'));
});

check('spatial registry virtualizes the loser', () => {
	const states = registry.snapshot().sources.map((item) => [item.id, item.state]);
	assert.ok(states.some(([id, state]) => id === 'low' && state === 'virtual'));
});

const duck = createAudioDuckBus({ attackSeconds: 0.05, releaseSeconds: 0.2 });
check('dialogue ducks ambience and weather', () => {
	duck.request('dialogue', { id: 'dialogue-1', active: true });
	duck.update(0.05);
	assert.ok(duck.gain('ambience') < 1);
	assert.ok(duck.gain('weather') < 1);
});

check('duck clears smoothly', () => {
	duck.clear('dialogue-1');
	duck.update(0.2);
	assert.ok(duck.gain('ambience') > 0.5);
});

const accessibility = createAudioAccessibilityPolicy({ reducedDynamicRange: true, softTransients: true, hearingBoost: 0.5 });
check('hearing accessibility lowers transients', () => {
	assert.equal(accessibility.dynamicRange.compressorRatio, 6);
	assert.ok(applyAudioAccessibilityGain(1, accessibility, { transient: true }) < 1);
});

check('audio source allocation is deterministic', () => {
	const requests = Array.from({ length: 60 }, (_, index) => ({ id: `source-${index}`, class: index % 3 === 0 ? 'dragon' : 'ambience', distance: index, priority: index % 3 === 0 ? 95 : 10 }));
	const a = allocateAudioSources(requests, desktop);
	const b = allocateAudioSources(requests, desktop);
	assert.deepEqual(a, b);
	assert.ok(a.admitted <= desktop.limits.maxSources);
});

const scheduler = createAudioCueScheduler({ maxQueue: 4, cooldowns: { footstep: 0.5 } });
check('cue scheduler suppresses duplicates inside cooldown', () => {
	assert.equal(scheduler.enqueue({ id: 'step-1', kind: 'footstep', priority: 60 }), true);
	const first = scheduler.dequeue(1);
	assert.equal(first.length, 1);
	assert.equal(scheduler.enqueue({ id: 'step-1', kind: 'footstep', priority: 60 }), false);
	scheduler.advance(0.5);
	assert.equal(scheduler.enqueue({ id: 'step-1', kind: 'footstep', priority: 60 }), true);
});

check('cue scheduler priority ordering is stable', () => {
	scheduler.enqueue({ id: 'a', kind: 'ambience', priority: 10 });
	scheduler.enqueue({ id: 'b', kind: 'combat', priority: 90 });
	assert.equal(scheduler.dequeue(1)[0].id, 'b');
});

const fakeBank = { gains: new Map(), setLayerGain(kind, value) { this.gains.set(kind, value); return true; }, triggerPulse() { return true; }, playDragonPulse() { return true; }, playCombatPulse() { return true; }, playFootstep() { return true; } };
const soundscape = createEnvironmentSoundscape({ bank: fakeBank });
check('soundscape transitions towards environment targets', () => {
	soundscape.setEnvironment('river', { waterProximity: 1, nightFactor: 0.8 });
	soundscape.update(0.1);
	assert.ok(soundscape.snapshot().layers.water > 0);
	assert.ok(soundscape.snapshot().targets.water >= soundscape.snapshot().layers.water);
});

const director = createImmersiveAudioDirector({ context: null, quality: 'high', environment: 'plains' });
check('director fails closed without Web Audio', () => {
	const snap = director.snapshot();
	assert.equal(snap.bank.supported, false);
	assert.equal(director.triggerCue('dragon'), false);
});

check('director updates registry and duck state headlessly', () => {
	director.registerSource({ id: 'dragon-1', class: 'dragon', priority: 95, position: { x: 3, y: 2, z: 4 } });
	director.setDuck('dialogue', true, { id: 'speech' });
	const snap = director.update(0.016, { listenerPosition: { x: 0, y: 0, z: 0 } });
	assert.equal(snap.registry.sourceCount, 1);
	assert.equal(snap.duck.requests.length, 1);
});

check('snapshot digest is stable', () => {
	const a = createAudioSnapshot({ director });
	const b = createAudioSnapshot({ director });
	assert.equal(audioSnapshotDigest(a), audioSnapshotDigest(b));
});

director.dispose();
check('director disposal is terminal', () => { assert.equal(director.snapshot().disposed, true); assert.equal(director.triggerCue('combat'), false); });

console.log(`IMMERSIVE_AUDIO_PLATFORM_PASS ${checks.length} checks`);
