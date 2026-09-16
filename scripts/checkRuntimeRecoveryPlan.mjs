#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRuntimeRecoveryPlan } from '../src/3d/platform/runtimeRecoveryPlan.js';

const plan = createRuntimeRecoveryPlan({
	health: { status: 'critical' },
	performance: { pressure: 'critical' },
	offline: { network: { state: 'offline' }, update: { state: 'error' } },
	storage: { state: 'critical' },
	compatibility: { features: { workerOffload: false } },
	governor: { action: 'degrade' },
});
const actions = plan.actions.map((item) => item.action);
assert.equal(actions[0], 'reduce-render-scale');
assert.ok(actions.includes('reduce-stream-radius'));
assert.ok(actions.includes('enter-memory-only'));
assert.ok(actions.includes('defer-prefetch'));
assert.ok(actions.includes('restart-optional-worker'));
assert.ok(actions.includes('reconnect-pwa'));
assert.equal(new Set(actions).size, actions.length);
assert.ok(plan.actions.every((item) => Number.isFinite(item.priority)));
console.log('RUNTIME_RECOVERY_PLAN_EDGE_PASS');
