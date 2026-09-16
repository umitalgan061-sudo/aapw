#!/usr/bin/env node
/**
 * Golden scenarios for runtime recovery ordering.
 *
 * These scenarios assert the policy's most important user-facing promises: severe frame pressure is
 * met with rendering/streaming relief, offline sessions suppress prefetch, storage exhaustion enters
 * memory-only mode, and a healthy state does not invent recovery work. Ordering is deterministic.
 */

import assert from 'node:assert/strict';
import { createRuntimeRecoveryPlan, recoveryActionConstants } from '../src/3d/platform/runtimeRecoveryPlan.js';

const scenarios = [
	{
		name: 'critical-performance',
		input: { health: { status: 'critical' }, performance: { pressure: 'critical' }, offline: {}, storage: {}, compatibility: { features: { workerOffload: true } }, governor: { action: 'degrade' } },
		expected: ['reduce-render-scale', 'reduce-stream-radius', 'defer-optional-assets', 'pause-ambient-animation', 'show-recovery-hint'],
	},
	{
		name: 'offline-session',
		input: { health: { status: 'degraded' }, performance: { pressure: 'normal' }, offline: { network: { state: 'offline' } }, storage: { state: 'healthy' }, compatibility: { features: { workerOffload: true } }, governor: { action: 'hold' } },
		expected: ['defer-prefetch'],
	},
	{
		name: 'storage-critical',
		input: { health: { status: 'degraded' }, performance: { pressure: 'normal' }, offline: { network: { state: 'online' } }, storage: { state: 'critical' }, compatibility: { features: { workerOffload: true } }, governor: { action: 'hold' } },
		expected: ['enter-memory-only'],
	},
	{
		name: 'healthy',
		input: { health: { status: 'healthy' }, performance: { pressure: 'relaxed' }, offline: { network: { state: 'online' } }, storage: { state: 'healthy' }, compatibility: { features: { workerOffload: true } }, governor: { action: 'hold' } },
		expected: [],
	},
];

for (const scenario of scenarios) {
	const plan = createRuntimeRecoveryPlan(scenario.input);
	const actions = plan.actions.map((item) => item.action);
	assert.deepEqual(actions, scenario.expected, scenario.name);
	assert.equal(new Set(actions).size, actions.length, `${scenario.name}: unique actions`);
}

const constants = recoveryActionConstants();
assert.equal(Object.isFrozen(constants), true);
assert.equal(constants.actions.ENTER_MEMORY_ONLY, 'enter-memory-only');
console.log(`RUNTIME_RECOVERY_GOLDEN_PASS ${scenarios.length} scenarios`);
