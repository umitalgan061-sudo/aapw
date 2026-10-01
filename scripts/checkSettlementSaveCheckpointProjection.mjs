import assert from 'node:assert/strict';
import { createSettlementSaveCheckpointProjection, validateSettlementSaveCheckpointProjection } from '../src/3d/gameplay/settlementSaveCheckpointProjection.js';

const base = {
  settlement: { id: 'northwatch', inside: true, defeated: false },
  persistence: { saveSupported: true, loadSupported: true, dirty: true, lastSaveAgeSeconds: 12, autosaveIntervalSeconds: 300, reason: 'quest-progress' },
  quest: { completedSteps: 3 },
  services: { completed: 2 },
};

const first = createSettlementSaveCheckpointProjection(base);
const second = createSettlementSaveCheckpointProjection({ ...base, services: { completed: 2 }, quest: { completedSteps: 3 } });
assert.equal(validateSettlementSaveCheckpointProjection(first), true);
assert.equal(first.nextAction, 'save');
assert.equal(first.save.due, true);
assert.equal(first.progress.totalSignals, 5);
assert.equal(first.fingerprint, second.fingerprint);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.save), true);

const outside = createSettlementSaveCheckpointProjection({
  settlement: { id: 'northwatch', inside: false },
  persistence: { saveSupported: true, dirty: true },
});
assert.equal(outside.nextAction, 'return-to-settlement');
assert.deepEqual(outside.blockers, ['outside-settlement']);

const defeated = createSettlementSaveCheckpointProjection({
  settlement: { id: 'northwatch', inside: true, defeated: true },
  persistence: { saveSupported: true, dirty: true },
});
assert.equal(defeated.inside, false);
assert.deepEqual(defeated.blockers, ['outside-settlement', 'settlement-defeated']);

const malformed = createSettlementSaveCheckpointProjection({
  settlement: { id: 17, inside: true },
  persistence: { saveSupported: false, dirty: 'yes', lastSaveAgeSeconds: Infinity, autosaveIntervalSeconds: 1 },
  quest: { completedSteps: -2 },
});
assert.equal(malformed.save.supported, false);
assert.equal(malformed.save.due, false);
assert.equal(malformed.progress.completedQuestSteps, 0);
assert.equal(validateSettlementSaveCheckpointProjection(malformed), true);

console.log(JSON.stringify({ ok: true, fingerprint: first.fingerprint, cases: 4 }));
