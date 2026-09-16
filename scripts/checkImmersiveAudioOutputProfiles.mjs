import assert from 'node:assert/strict';
import {
	AUDIO_OUTPUT_PROFILES,
	resolveAudioOutputProfile,
	validateAudioOutputProfile,
} from '../src/3d/audio/audioOutputProfile.js';

const profiles = Object.values(AUDIO_OUTPUT_PROFILES);
assert.deepEqual(profiles, ['speaker', 'headphones', 'mobile']);

const evaluated = profiles.map((profile, index) => resolveAudioOutputProfile({
	output: profile,
	channels: index === 2 ? 1 : 2,
}));

for (const profile of evaluated) {
	assert.equal(profile.version, 1);
	assert.equal(validateAudioOutputProfile(profile), true);
	assert.ok(profile.bass >= 0.4 && profile.bass <= 1);
	assert.ok(profile.treble >= 0.4 && profile.treble <= 1);
	assert.ok(profile.spatialWidth >= 0 && profile.spatialWidth <= 1);
	assert.ok(profile.centerBoost >= 0 && profile.centerBoost <= 0.2);
}

const speaker = evaluated[0];
const headphones = evaluated[1];
const mobileMono = evaluated[2];
assert.equal(speaker.channels, 2);
assert.equal(speaker.monoCompatible, false);
assert.equal(headphones.channels, 2);
assert.equal(headphones.spatialWidth, 1);
assert.equal(mobileMono.channels, 1);
assert.equal(mobileMono.monoCompatible, true);
assert.ok(headphones.bass >= speaker.bass);
assert.ok(headphones.treble >= speaker.treble);
assert.ok(mobileMono.centerBoost > speaker.centerBoost);

const invalidOutput = resolveAudioOutputProfile({ output: 'bluetooth-spatial-beta', channels: 64 });
assert.equal(invalidOutput.profile, AUDIO_OUTPUT_PROFILES.SPEAKER);
assert.equal(invalidOutput.channels, 2);
assert.equal(validateAudioOutputProfile(invalidOutput), true);

const invalidChannels = resolveAudioOutputProfile({ output: AUDIO_OUTPUT_PROFILES.MOBILE, channels: Number.NaN });
assert.equal(invalidChannels.channels, 2);
assert.equal(invalidChannels.monoCompatible, true);

const repeated = profiles.map((profile, index) => resolveAudioOutputProfile({
	output: profile,
	channels: index === 2 ? 1 : 2,
}));
assert.deepEqual(evaluated, repeated);
assert.ok(Object.isFrozen(evaluated[0]));
assert.ok(Object.isFrozen(evaluated[1]));
assert.ok(Object.isFrozen(evaluated[2]));

console.log(JSON.stringify({
	contract: 'immersive-audio-output-profiles',
	version: 1,
	profiles: evaluated,
	deterministic: true,
	invalidOutputFailsClosed: invalidOutput.profile === AUDIO_OUTPUT_PROFILES.SPEAKER,
	mobileMonoCompatible: mobileMono.monoCompatible,
}, null, 2));
