#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRuntimeDebugContract, runtimeDebugContractJson } from '../src/3d/platform/runtimeDebugContract.js';

const telemetry = {
	summarize: () => ({ retained: 4, sequence: 9 }),
	recent: () => [
		{ sequence: 1, level: 'info', name: 'boot' },
		{ sequence: 2, level: 'warn', name: 'asset' },
	],
};
const health = {
	snapshot: () => ({
		status: 'degraded',
		capabilities: { tier: 'high', score: 8.5, cpu: { logicalCores: 16 }, memory: { deviceGb: 16 }, display: { dpr: 2 }, pointer: { coarse: false }, accessibility: { reducedMotion: false }, network: { class: 'fast' }, webgl: { version: 2 }, secrets: { token: 'drop-me' } },
		featureMatrix: { quality: { tier: 'high' }, budget: { pixelRatioCap: 1.5, shadowMapSize: 1024, maxChunkRadius: 2, maxAnimatedActors: 56, maxAssetConcurrency: 3 }, features: { shadows: true } },
		performance: { pressure: 'elevated', p95: 31.11111, frameBudgetMs: 18, pressureScore: 2.2 },
		issues: ['frame-pressure-elevated', 'x'.repeat(500)],
	}),
};
const contract = createRuntimeDebugContract({ health, governor: { snapshot: () => ({ tier: 'high', action: 'hold', sequence: 2, cooldownSamples: 3 }) }, telemetry, offline: { network: { state: 'online' }, storage: { state: 'available' }, update: { state: 'idle' }, resilience: { canPlayOffline: true } }, lifecycle: { state: 'running', sequence: 4 }, compatibility: { level: 'full', webgl: { version: 2 } } });

assert.equal(contract.version, 1);
assert.equal(contract.status, 'degraded');
assert.equal(contract.capabilities.tier, 'high');
assert.equal(contract.capabilities.webglVersion, 2);
assert.equal('secrets' in contract.capabilities, false);
assert.equal(contract.issues[1].length, 96);
assert.equal(contract.telemetry.events.length, 2);
assert.ok(runtimeDebugContractJson({ health }).length < 10000);
assert.equal(Object.isFrozen(contract), true);

console.log('RUNTIME_DEBUG_CONTRACT_PASS');
