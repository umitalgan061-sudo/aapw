#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPlayerVerticalSliceReceipt, STAGES, validatePlayerVerticalSliceReceipt } from '../src/3d/gameplay/playerVerticalSliceReceipt.js';

const entries = STAGES.map((stage, index) => ({
  stage,
  accepted: true,
  sequence: index,
  source: `${stage}-owner`,
  surface: index === 0 ? 'ground' : null,
}));

const make = () => {
  const receipt = createPlayerVerticalSliceReceipt({ maxHistory: 2 });
  const first = receipt.record(entries, { actorId: 'player-1', grounded: true, targetId: 'wolf-7' });
  const second = receipt.record(entries, { actorId: 'player-1', grounded: true, targetId: 'wolf-7' });
  return { receipt, first, second };
};

const left = make();
const right = make();
assert.deepEqual(left.first, right.first, 'same stage chain must replay identically');
assert.equal(validatePlayerVerticalSliceReceipt(left.first).ok, true, 'complete chain must validate');
assert.equal(left.first.acceptedStages, STAGES.length);
assert.equal(left.first.sequenceMonotonic, true);
assert.equal(left.receipt.snapshot().history.length, 2, 'history must stay bounded');
assert.throws(() => { left.first.stages[0].accepted = false; }, TypeError, 'nested receipt must be immutable');

const incomplete = createPlayerVerticalSliceReceipt().record(
  entries.map((entry) => entry.stage === 'combat' ? { ...entry, accepted: false, error: 'blocked' } : entry),
  { actorId: 'player-1', grounded: true },
);
assert.equal(incomplete.ok, false, 'rejected stage must fail the contract');
assert.deepEqual(incomplete.missingStages, ['combat']);

left.receipt.dispose();
assert.deepEqual(left.receipt.record(entries), { disposed: true, serial: 2, ok: false, stages: [], digest: null });
assert.deepEqual(left.receipt.snapshot(), { disposed: true, serial: 2, history: [] });

console.log(JSON.stringify({
  ok: true,
  contract: 'player-vertical-slice-receipt',
  stages: STAGES,
  digest: left.second.digest,
  deterministic: left.first.digest === right.first.digest,
  boundedHistory: true,
  disposalFailClosed: true,
}, null, 2));
