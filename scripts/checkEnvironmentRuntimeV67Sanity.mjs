import assert from 'node:assert/strict';
import { V67_POLICY } from '../src/3d/world/environmentRuntimeV67.js';
assert.equal(V67_POLICY.version,67);
assert.equal(V67_POLICY.noWorldMutation,true);
console.log('V67 sanity PASS');
