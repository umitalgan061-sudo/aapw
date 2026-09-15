import assert from 'node:assert/strict';
import { createPlayerTraversalPresentationRuntime, comparePlayerTraversalRuntimeSnapshots, validatePlayerTraversalRuntime } from '../src/3d/gameplay/playerTraversalPresentationRuntime.js';
import { replayAndVerifyTraversal } from '../src/3d/gameplay/playerTraversalPresentationReplay.js';

const cues = [
  { traversalWeight:0.2, traversalForwardDistance:5, clockSeconds:0.1 },
  { traversalWeight:0.7, traversalForwardDistance:2.4, clockSeconds:0.2 },
  { traversalWeight:0.9, traversalForwardDistance:1.3, clockSeconds:0.3 },
  { traversalWeight:0.3, landingImpactMps:2, elapsedSeconds:0.1, clockSeconds:0.5 },
  { traversalWeight:0, clockSeconds:0.7 },
];
const one = createPlayerTraversalPresentationRuntime();
const two = createPlayerTraversalPresentationRuntime();
for (const cue of cues) { one.tick(cue); two.tick(cue); }
assert.equal(comparePlayerTraversalRuntimeSnapshots(one.snapshot(), two.snapshot()), true);
assert.equal(validatePlayerTraversalRuntime(one).valid, true);
assert.equal(replayAndVerifyTraversal(cues).deterministic, true);
assert.equal(one.snapshot().tickIndex, cues.length);
console.log('player traversal presentation runtime: deterministic replay passed');
