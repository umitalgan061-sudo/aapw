#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createAudioMixEngine } from '../src/3d/audio/audioMixEngine.js';
import { createAudioFocusManager } from '../src/3d/audio/audioFocusManager.js';
import { createRoomReverbPolicy, roomReverbTransition } from '../src/3d/audio/audioRoomReverbPolicy.js';
import { createSpatialPannerAdapter } from '../src/3d/audio/spatialPannerAdapter.js';
import { resolveAudioCue, buildAudioCueRequest } from '../src/3d/audio/audioEventCueMap.js';
import { createAudioSnapshot, restoreAudioSnapshot, audioSnapshotDigest } from '../src/3d/audio/audioSnapshot.js';

const mix = createAudioMixEngine({ masterVolume: 0.8 });
assert.ok(mix.compute({ channel: 'dialogue', sourceGain: 1, duckGains: 1 }).output > 0);
mix.setDuck('ambience', 0.2);
assert.ok(mix.compute({ channel: 'ambience', sourceGain: 1 }).output < 0.2);
assert.equal(mix.compute({ channel: 'invalid' }).channel, 'ambience');
assert.ok(mix.mix([{ channel: 'dialogue', sourceGain: 1 }, { channel: 'combat', sourceGain: 1 }]).decisions.length === 2);

const focus = createAudioFocusManager({ transitionSeconds: 0.1 });
focus.setFocus('menu');
focus.update(0.1);
assert.ok(focus.output('ambience') < 0.5);
focus.setFocus('playing');
focus.update(0.2);
assert.ok(focus.output('ambience') > 0.8);

const castle = createRoomReverbPolicy({ room: 'castle', sizeMeters: 100, absorption: 0.1 });
const cave = createRoomReverbPolicy({ room: 'cave', sizeMeters: 60, absorption: 0 });
assert.ok(cave.wet > castle.wet);
const transition = roomReverbTransition(castle, cave, 0.08);
assert.ok(transition.wet > castle.wet && transition.wet < cave.wet);

const cue = resolveAudioCue('PLAYER_DIED');
assert.equal(cue.cue, 'combat');
assert.equal(buildAudioCueRequest('WORLD_EVENT_TRIGGERED', { distance: 20 }).kind, 'storm');

const snapshot = createAudioSnapshot({ director: { snapshot: () => ({ quality: 'high', enabled: true, sequence: 4, listener: { position: { x: 1, y: 2, z: 3 }, forward: { x: 0, y: 0, z: -1 } }, policy: { listener: { maxDistance: 120, masterVolume: 0.8 }, limits: { maxSources: 16, maxPositionalSources: 8 } }, soundscape: { environment: 'castle', layers: { fire: 0.2 } }, duck: { gains: { music: 0.3 } }, accessibility: { profile: 'full' }, registry: { sources: [] } }) } });
assert.equal(snapshot.quality, 'high');
assert.equal(audioSnapshotDigest(snapshot), audioSnapshotDigest(snapshot));

const fakeParam = () => ({ value: 0, setValueAtTime(value) { this.value = value; } });
const fakeNode = () => ({ gain: fakeParam(), frequency: fakeParam(), Q: fakeParam(), connect(target) { this.target = target; return target; }, disconnect() {}, start() {}, stop() {}, setPosition() {} });
const fakeContext = {
	currentTime: 1,
	createGain: fakeNode,
	createPanner: () => ({ positionX: fakeParam(), positionY: fakeParam(), positionZ: fakeParam(), connect(target) { this.target = target; return target; }, disconnect() {} }),
	createBiquadFilter: fakeNode,
};
const adapter = createSpatialPannerAdapter({ context: fakeContext, destination: fakeNode(), maxSources: 2, policy: { maxDistance: 120, referenceDistance: 8, rolloffFactor: 1.5, panningModel: 'HRTF', distanceModel: 'inverse' } });
const handle = adapter.create({ id: 'dragon', position: { x: 4, y: 2, z: -3 } });
assert.ok(handle);
assert.equal(handle.setPosition({ x: 5, y: 2, z: -4 }), true);
assert.equal(handle.setOcclusion({ gain: 0.4, cutoffHz: 700 }), true);
assert.equal(adapter.snapshot().active, 1);
adapter.dispose();
assert.equal(adapter.snapshot().active, 0);

const fakeDirector = { disposed: false, setListenerPose() {}, setEnvironment() {}, setMasterVolume() {} };
assert.equal(restoreAudioSnapshot(snapshot, fakeDirector).restored, true);

console.log('IMMERSIVE_AUDIO_ADVANCED_PASS');
