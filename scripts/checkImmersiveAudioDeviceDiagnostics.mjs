import assert from 'node:assert/strict';
import {
	AUDIO_DEVICE_CLASSES,
	resolveAudioDeviceDiagnostics,
	validateAudioDeviceDiagnostics,
	summarizeAudioDeviceDiagnostics,
} from '../src/3d/audio/audioDeviceDiagnostics.js';

const running = resolveAudioDeviceDiagnostics({
	webAudio: true,
	audioWorklet: true,
	mediaSession: true,
	outputChannels: 2,
	baseLatency: 0.012,
	outputLatency: 0.021,
	maxChannelCount: 2,
	contextState: 'running',
	userGestureRequired: false,
});
const suspended = resolveAudioDeviceDiagnostics({
	webAudio: true,
	audioWorklet: false,
	mediaSession: false,
	outputChannels: 2,
	baseLatency: 0.018,
	outputLatency: 0.029,
	maxChannelCount: 2,
	contextState: 'suspended',
	userGestureRequired: true,
});
const unavailable = resolveAudioDeviceDiagnostics({ webAudio: false });

assert.equal(running.deviceClass, AUDIO_DEVICE_CLASSES.WEB_AUDIO);
assert.equal(running.canRunSpatial, true);
assert.equal(running.canRunAdvancedGraph, true);
assert.equal(running.readiness, 1);
assert.equal(suspended.deviceClass, AUDIO_DEVICE_CLASSES.WEB_AUDIO_LIMITED);
assert.equal(suspended.canRunSpatial, true);
assert.equal(suspended.canRunAdvancedGraph, false);
assert.ok(suspended.readiness > 0 && suspended.readiness < 1);
assert.equal(unavailable.deviceClass, AUDIO_DEVICE_CLASSES.UNAVAILABLE);
assert.equal(unavailable.canRunSpatial, false);
assert.equal(unavailable.canRunAdvancedGraph, false);
assert.equal(unavailable.readiness, 0);

for (const report of [running, suspended, unavailable]) {
	assert.equal(validateAudioDeviceDiagnostics(report), true);
	assert.ok(report.baseLatency >= 0);
	assert.ok(report.outputLatency >= 0);
	assert.ok(report.readiness >= 0 && report.readiness <= 1);
}

const summary = summarizeAudioDeviceDiagnostics([running, suspended, unavailable]);
assert.equal(summary.total, 3);
assert.equal(summary.valid, 3);
assert.equal(summary.spatialReady, 2);
assert.equal(summary.advancedReady, 1);
assert.ok(summary.averageReadiness > 0);

const repeat = resolveAudioDeviceDiagnostics({
	webAudio: true,
	audioWorklet: true,
	mediaSession: true,
	outputChannels: 2,
	baseLatency: 0.012,
	outputLatency: 0.021,
	maxChannelCount: 2,
	contextState: 'running',
	userGestureRequired: false,
});
assert.deepEqual(running, repeat);

console.log(JSON.stringify({
	contract: 'immersive-audio-device-diagnostics',
	version: 1,
	summary,
	running,
	suspended,
	unavailable,
	deterministic: true,
}, null, 2));
