import assert from 'node:assert/strict';
import { evaluatePerception, summarizePerception } from '../src/3d/gameplay/livingWorldPerceptionPolicy.js';

const observer = { position: { x: 0, z: 0 }, forward: { x: 0, z: 1 } };
const visual = { id: 'guard-2', position: { x: 0, z: 8 }, stealth: 0, noise: 0, lineOfSight: true };
const hidden = { id: 'guard-1', position: { x: 0, z: 8 }, stealth: 1, noise: 0, lineOfSight: false };
const audible = { id: 'wolf-1', position: { x: 10, z: 0 }, stealth: 0, noise: 1, lineOfSight: false };

assert.equal(evaluatePerception(observer, visual).channel, 'visual');
assert.equal(evaluatePerception(observer, hidden).detected, false);
assert.equal(evaluatePerception(observer, audible).channel, 'hearing');

const snapshotA = summarizePerception(observer, [audible, visual], { maxDetections: 2 });
const snapshotB = summarizePerception(observer, [visual, audible], { maxDetections: 2 });
assert.deepEqual(snapshotA, snapshotB);
assert.equal(snapshotA.detections.length, 2);
assert.equal(summarizePerception(observer, [visual, audible], { maxDetections: 1 }).truncated, true);
assert.equal(evaluatePerception(observer, { position: { x: 0, z: 100 }, noise: 0 }).detected, false);
console.log('living-world perception policy: PASS');
