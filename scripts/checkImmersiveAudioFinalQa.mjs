#!/usr/bin/env node
/**
 * Final deterministic QA matrix for the immersive audio platform.
 *
 * The goal is to validate contracts that are independent of browser speaker drivers: all supported
 * semantic cues resolve, all outputs remain bounded, critical channels retain a floor, quality budgets
 * stay monotonic, and lifecycle/snapshot helpers remain repeatable. Device-specific playback still belongs
 * to browser-level acceptance and is intentionally not faked by this suite.
 */

import assert from 'node:assert/strict';
import { listAudioCueKeys, resolveAudioCue, buildAudioCueRequest } from '../src/3d/audio/audioEventCueMap.js';
import { listAudioDesignKeys, getAudioDesign, validateAudioDesign, audioDesignMaxInstances } from '../src/3d/audio/audioDesignCatalog.js';
import { routeAudioCue, buildSpatialRegistration } from '../src/3d/audio/audioCueRouter.js';
import { createAudioMixEngine } from '../src/3d/audio/audioMixEngine.js';
import { createAudioPerformanceBudget } from '../src/3d/audio/audioPerformanceBudget.js';
import { createAudioTransientLimiter } from '../src/3d/audio/audioTransientLimiter.js';
import { createWeatherAudioState, transitionWeatherAudio, weatherThunderGain } from '../src/3d/audio/audioWeatherMixer.js';
import { createRoomReverbPolicy } from '../src/3d/audio/audioRoomReverbPolicy.js';
import { createAudioZone, resolveAudioZones } from '../src/3d/audio/audioZonePolicy.js';
import { createResonancePolicy } from '../src/3d/audio/audioResonancePolicy.js';
import { createImmersiveAudioPolicy, evaluateAudioSource } from '../src/3d/audio/immersiveAudioPolicy.js';
import { createAudioFocusManager } from '../src/3d/audio/audioFocusManager.js';
import { createAudioMusicStatePolicy } from '../src/3d/audio/audioMusicStatePolicy.js';
import { createAudioStemDirector } from '../src/3d/audio/audioStemDirector.js';
import { createRuntimeCompatibilityMatrix } from '../src/3d/audio/../platform/runtimeCompatibilityMatrix.js';

let count = 0;
const check = (name, fn) => { fn(); count += 1; console.log(`PASS ${name}`); };

check('every canonical cue resolves to a complete request', () => {
	for (const key of listAudioCueKeys()) {
		const cue = resolveAudioCue(key);
		const request = buildAudioCueRequest(key, { position: { x: 1, y: 2, z: 3 } });
		assert.ok(cue);
		assert.ok(request);
		assert.ok(request.kind);
		assert.ok(request.group);
		assert.ok(Number.isFinite(request.priority));
	}
});

check('every design record passes self-validation', () => {
	for (const key of listAudioDesignKeys()) {
		const design = getAudioDesign(key);
		const result = validateAudioDesign(key);
		assert.ok(design);
		assert.equal(result.valid, true);
		assert.ok(audioDesignMaxInstances(key) >= 1);
	}
});

check('unknown cues fail closed', () => {
	assert.equal(resolveAudioCue('not-real'), null);
	assert.equal(buildAudioCueRequest('not-real'), null);
	assert.equal(routeAudioCue('not-real'), null);
	assert.equal(buildSpatialRegistration('not-real'), null);
});

check('route decisions preserve critical cues under instance pressure', () => {
	const critical = routeAudioCue('PLAYER_DIED', {}, { activeInstances: 999 });
	const optional = routeAudioCue('WORLD_EVENT_TRIGGERED', {}, { activeInstances: 999 });
	assert.equal(critical.admitted, true);
	assert.ok(optional.admitted === false || optional.critical === true);
});

check('spatial registration contains bounded world position', () => {
	const registration = buildSpatialRegistration('PLAYER_DAMAGED', { position: { x: 5, y: 3, z: -8 }, maxDistance: 900 });
	assert.ok(registration);
	assert.equal(registration.spatial, true);
	assert.ok(registration.request.maxDistance <= 500);
});

for (const quality of ['minimal', 'balanced', 'high', 'ultra']) {
	check(`performance budget ${quality}`, () => {
		const budget = createAudioPerformanceBudget({ quality, measuredCpuMs: 1, measuredSources: 2, measuredTransientRate: 2 });
		assert.ok(budget.budget.maxSources >= 1);
		assert.ok(budget.budget.maxPanners >= 0);
		assert.ok(budget.budget.maxProceduralLayers >= 1);
		assert.ok(budget.budget.maxTransientPerSecond >= 1);
	});
}

check('quality budgets are monotonic', () => {
	const budgets = ['minimal', 'balanced', 'high', 'ultra'].map((quality) => createAudioPerformanceBudget({ quality }).budget.maxSources);
	for (let i = 1; i < budgets.length; i += 1) assert.ok(budgets[i] >= budgets[i - 1]);
});

check('mix engine keeps every channel bounded', () => {
	const mix = createAudioMixEngine({ masterVolume: 1 });
	const result = mix.mix(Array.from({ length: 100 }, (_, index) => ({ channel: index % 2 ? 'ambience' : 'dialogue', sourceGain: 1 }))); 
	for (const value of Object.values(result.channels)) assert.ok(value >= 0 && value <= 1);
});

check('transient limiter never amplifies above unity', () => {
	const limiter = createAudioTransientLimiter({ ceiling: 0.9 });
	for (const peak of [0, 0.2, 0.8, 1, 1.5, 2]) {
		const result = limiter.process(peak, 0.016);
		assert.ok(result.gain >= 0 && result.gain <= 1);
	}
});

check('weather mixer transitions remain bounded', () => {
	const clear = createWeatherAudioState({ type: 'clear', intensity: 0 });
	const storm = createWeatherAudioState({ type: 'storm', intensity: 1, gust: 1 });
	const mid = transitionWeatherAudio(clear, storm, 0.1);
	for (const value of Object.values(mid.layers)) assert.ok(value >= 0 && value <= 1);
	assert.ok(weatherThunderGain(storm, 2.5) >= 0 && weatherThunderGain(storm, 2.5) <= 1);
});

for (const room of ['open', 'small-room', 'large-hall', 'castle', 'cave', 'forest', 'coast', 'river', 'ice']) {
	check(`reverb ${room}`, () => {
		const policy = createRoomReverbPolicy({ room, sizeMeters: 80, absorption: 0.2 });
		assert.ok(policy.wet >= 0 && policy.wet <= 0.8);
		assert.ok(policy.decaySeconds >= 0.25 && policy.decaySeconds <= 5);
	});
}

check('zone resolver caps active zones', () => {
	const zones = Array.from({ length: 20 }, (_, index) => createAudioZone({ id: `z-${index}`, type: index % 2 ? 'cave' : 'forest', priority: index, radius: 100, center: { x: 0, y: 0, z: 0 } }));
	const result = resolveAudioZones(zones, { x: 0, y: 0, z: 0 });
	assert.ok(result.activeCount <= 4);
});

check('resonance stays bounded', () => {
	for (const surface of ['open', 'stone', 'wood', 'earth', 'metal', 'ice', 'water', 'foliage']) {
		const policy = createResonancePolicy({ surface, enclosure: 1, distance: 0, roomSize: 10, lowFrequencyBias: 0.4 });
		assert.ok(policy.resonance >= 0 && policy.resonance <= 1);
		assert.ok(policy.lowFrequencyBias >= -0.2 && policy.lowFrequencyBias <= 0.5);
	}
});

check('distance source gain is monotonic enough for near/far bounds', () => {
	const policy = createImmersiveAudioPolicy({ quality: 'high', environment: 'plains' });
	const near = evaluateAudioSource({ id: 'near', class: 'dragon', distance: 4, gain: 1 }, policy);
	const mid = evaluateAudioSource({ id: 'mid', class: 'dragon', distance: 40, gain: 1 }, policy);
	const far = evaluateAudioSource({ id: 'far', class: 'dragon', distance: 100, gain: 1 }, policy);
	assert.ok(near.gains.distance >= mid.gains.distance);
	assert.ok(mid.gains.distance >= far.gains.distance);
});

check('focus state converges', () => {
	const focus = createAudioFocusManager({ transitionSeconds: 0.1 });
	focus.setFocus('menu');
	for (let i = 0; i < 30; i += 1) focus.update(0.016);
	assert.ok(focus.output('ambience') < 0.4);
});

check('music semantic states resolve under signal precedence', () => {
	const music = createAudioMusicStatePolicy();
	music.updateSignals({ nightFactor: 1, combatIntensity: 0 }, 0.1);
	assert.equal(music.snapshot().target, 'night');
	music.updateSignals({ combatIntensity: 1, nightFactor: 1 }, 0.02);
	assert.equal(music.snapshot().target, 'combat');
});

check('stem director caps active stems', () => {
	const stems = createAudioStemDirector({ maxStems: 3 });
	for (const stem of ['exploration', 'settlement', 'combat', 'danger', 'storm', 'victory']) stems.request(stem, { priority: stem === 'combat' ? 90 : 10 });
	assert.ok(stems.snapshot().active.length <= 3);
});

check('compatibility full profile exposes optional features', () => {
	const compatibility = createRuntimeCompatibilityMatrix({ canvasSupported: true, esModules: true, webglSupported: true, webgl2: true, offscreenCanvas: true, serviceWorker: true, cacheStorage: true, indexedDb: true, gamepad: true, webCodecs: true, worker: true, resizeObserver: true, performanceObserver: true });
	assert.equal(compatibility.level, 'full');
	assert.equal(compatibility.features.offlineCache, true);
	assert.equal(compatibility.features.workerOffload, true);
});

console.log(`IMMERSIVE_AUDIO_FINAL_QA_PASS ${count} checks`);
