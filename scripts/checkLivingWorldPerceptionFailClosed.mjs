import assert from 'node:assert/strict';
import { evaluatePerception, summarizePerception } from '../src/3d/gameplay/livingWorldPerceptionPolicy.js';

const observer = { position: { x: 0, z: 0 }, forward: { x: 0, z: 1 } };
const visible = { id: 'guard-2', position: { x: 0, z: 8 }, stealth: 0, noise: 0, lineOfSight: true };
const audible = { id: 'wolf-1', position: { x: 10, z: 0 }, stealth: 0, noise: 1, lineOfSight: false };
const hidden = { id: 'guard-hidden', position: { x: 0, z: 8 }, stealth: 0, noise: 0, lineOfSight: false };

assert.equal(evaluatePerception(observer, visible).channel, 'visual');
assert.equal(evaluatePerception(observer, audible).channel, 'hearing');
assert.equal(evaluatePerception(observer, { position: { x: Number.NaN, z: 2 } }).invalidInput, true);
assert.equal(evaluatePerception({ position: { x: 0, z: 0 }, forward: { x: Number.NaN, z: 1 } }, visible).detected, false);
assert.equal(evaluatePerception(observer, visible, { viewDistanceMeters: 0 }).invalidInput, true);

const reversed = summarizePerception(observer, [audible, visible], { maxDetections: 2 });
const ordered = summarizePerception(observer, [visible, audible], { maxDetections: 2 });
assert.deepEqual(reversed, ordered);
assert.equal(summarizePerception(observer, [visible, audible], { maxDetections: 1 }).truncated, true);
assert.equal(summarizePerception(observer, [visible, hidden, { id: 'bad', position: { x: Infinity, z: 2 } }]).invalidTargets, 1);
console.log('living-world perception fail-closed: PASS');
