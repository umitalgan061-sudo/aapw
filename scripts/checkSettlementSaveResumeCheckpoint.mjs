import assert from 'node:assert/strict';
import {
  buildSettlementSaveResumeCheckpoint,
  validateSettlementSaveResumeCheckpoint,
  serializeSettlementSaveResumeCheckpoint,
} from '../src/3d/gameplay/settlementSaveResumeCheckpoint.js';

const base = {
  settlementId: 'dragonstone',
  sliceId: 'settlement-slice-1',
  saveEnabled: true,
  runtime: { health: 10, defeated: false, currentNodeId: 'market', visited: ['gate', 'market'] },
  snapshot: { currentNodeId: 'market', visited: ['gate', 'market'], history: [
    { sequence: 1, action: 'enter', nodeId: 'gate', result: 'ok', message: 'arrived' },
    { sequence: 2, action: 'trade', nodeId: 'market', result: 'ok', message: 'traded' },
  ] },
};

const a = buildSettlementSaveResumeCheckpoint(base);
const b = buildSettlementSaveResumeCheckpoint(structuredClone(base));
assert.deepEqual(a, b, 'deterministic');
assert.equal(a.checkpoint, 'available');
assert.equal(a.resume, 'resume-node');
assert.equal(a.lastAction, 'trade');
assert.equal(validateSettlementSaveResumeCheckpoint(a).ok, true);
assert.equal(serializeSettlementSaveResumeCheckpoint(a), serializeSettlementSaveResumeCheckpoint(b));
assert.throws(() => { a.visited.push('x'); }, TypeError);

const defeated = buildSettlementSaveResumeCheckpoint({ ...base, runtime: { ...base.runtime, health: 0, defeated: true } });
assert.equal(defeated.checkpoint, 'blocked');
assert.equal(validateSettlementSaveResumeCheckpoint(defeated).ok, true);

const malformed = buildSettlementSaveResumeCheckpoint({ settlementId: 'x', runtime: { health: 'nope' } });
assert.equal(malformed.canSave, true, 'finite fallback keeps healthy default');
assert.equal(validateSettlementSaveResumeCheckpoint(malformed).ok, true);

console.log('settlement-save-resume-checkpoint: ok');
