#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRuntimeNetworkPolicy, networkActionFor } from '../src/3d/platform/runtimeNetworkPolicy.js';

const cases = [
	{ name: 'fast', input: { online: true, effectiveType: '4g', saveData: false }, expectedClass: 'fast', prefetch: 'standard', concurrent: 4 },
	{ name: 'normal', input: { online: true, effectiveType: '3g', saveData: false }, expectedClass: 'normal', prefetch: 'reduced', concurrent: 2 },
	{ name: 'constrained', input: { online: true, effectiveType: '2g', saveData: true }, expectedClass: 'constrained', prefetch: 'defer', concurrent: 1 },
	{ name: 'offline', input: { online: false }, expectedClass: 'offline', prefetch: 'cache-only', concurrent: 0 },
];

for (const item of cases) {
	const policy = createRuntimeNetworkPolicy(item.input);
	assert.equal(policy.class, item.expectedClass, item.name);
	assert.equal(networkActionFor(policy, { prefetch: true }), item.prefetch, item.name);
	assert.equal(policy.budget.maxConcurrentDownloads, item.concurrent, item.name);
	assert.equal(Object.isFrozen(policy), true);
}

const unknown = createRuntimeNetworkPolicy({ online: true, effectiveType: 'satellite', saveData: false });
assert.equal(unknown.class, 'unknown');
assert.equal(networkActionFor(unknown, { critical: true }), 'critical');
assert.equal(networkActionFor(unknown, { prefetch: true }), 'reduced');

console.log(`RUNTIME_NETWORK_POLICY_PASS ${cases.length + 1} cases`);
