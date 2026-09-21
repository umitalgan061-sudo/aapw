#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createAudioZone, evaluateZoneInfluence, resolveAudioZones } from '../src/3d/audio/audioZonePolicy.js';
import { evaluateAudioGraphHealth, smoothGraphPressure } from '../src/3d/audio/audioGraphSafetyMonitor.js';
import { createRuntimeNetworkPolicy, networkActionFor } from '../src/3d/audio/../platform/runtimeNetworkPolicy.js';
import { createAudioMixEngine } from '../src/3d/audio/audioMixEngine.js';

const zoneCases = [
	{ id: 'hall', type: 'hall', center: { x: 0, y: 0, z: 0 }, radius: 20, priority: 30 },
	{ id: 'cave', type: 'cave', center: { x: 10, y: 0, z: 0 }, radius: 12, priority: 80 },
	{ id: 'shore', type: 'shore', center: { x: 80, y: 0, z: 0 }, radius: 30, priority: 20 },
];
const zones = zoneCases.map(createAudioZone);
assert.equal(evaluateZoneInfluence(zones[0], { x: 0, y: 0, z: 0 }).influence, 1);
assert.equal(evaluateZoneInfluence(zones[0], { x: 100, y: 0, z: 0 }).influence, 0);
const resolved = resolveAudioZones(zones, { x: 12, y: 0, z: 0 });
assert.ok(resolved.activeCount >= 2);
assert.ok(resolved.modifiers.reverb >= 0 && resolved.modifiers.reverb <= 1);
assert.ok(resolved.zones[0].priority >= resolved.zones.at(-1).priority);

for (const sources of [0, 4, 8, 16, 32, 48, 64]) {
	for (const panners of [0, 4, 8, 16, 32]) {
		const health = evaluateAudioGraphHealth({ sourceCount: sources, sourceLimit: 48, positionalCount: panners, positionalLimit: 28, generatedBufferCount: Math.min(10, sources / 4), bufferLimit: 10, transientRate: sources / 2, transientLimit: 30 });
		assert.ok(['healthy', 'pressured', 'critical'].includes(health.state));
		assert.ok(health.ratio >= 0);
		assert.ok(['none', 'virtualize', 'stop-optional'].includes(health.action));
	}
}
const low = smoothGraphPressure(0.2, 1.4, 0.05);
const high = smoothGraphPressure(1.4, 0.2, 0.05);
assert.ok(low > 0.2 && low < 1.4);
assert.ok(high < 1.4 && high > 0.2);

for (const network of [
	{ online: true, effectiveType: '4g', saveData: false },
	{ online: true, effectiveType: '2g', saveData: true },
	{ online: false },
]) {
	const policy = createRuntimeNetworkPolicy(network);
	assert.equal(networkActionFor(policy, { critical: true }), network.online ? 'critical' : 'cache-only');
}

const mix = createAudioMixEngine({ masterVolume: 0.9 });
mix.setBase('dialogue', 0.6);
mix.setDuck('ambience', 0.1);
const output = mix.mix([
	{ channel: 'dialogue', sourceGain: 1, priority: 100 },
	{ channel: 'ambience', sourceGain: 1, priority: 20 },
	{ channel: 'weather', sourceGain: 1, priority: 20 },
]);
assert.equal(output.decisions.length, 3);
assert.ok(output.channels.dialogue > output.channels.ambience);
assert.ok(output.channels.weather <= 1);

console.log('IMMERSIVE_AUDIO_ZONES_SAFETY_PASS');
