import { strict as assert } from 'node:assert';
import { buildSettlementRecoveryPlan, validateSettlementRecoveryPlan } from '../src/3d/gameplay/settlementRecoveryPlan.js';

const complete = buildSettlementRecoveryPlan({
  settlementId: 'winterhold',
  locationId: 'market',
  activeService: 'market',
  panel: 'trade',
  route: ['gate', 'market'],
  revision: 7,
  feedback: { status: 'success', action: 'trade', message: 'ok' },
  canSave: true,
});
assert.equal(complete.primary.id, 'checkpoint');
assert.equal(complete.evidence.resumeEligible, true);
assert.equal(validateSettlementRecoveryPlan(complete).ok, true);
assert.equal(Object.isFrozen(complete), true);
assert.equal(Object.isFrozen(complete.primary), true);

const blocked = buildSettlementRecoveryPlan({
  settlementId: 'winterhold', activeService: 'blacksmith', panel: 'craft',
  feedback: { status: 'blocked', code: 'missing-material' }, canSave: true,
});
assert.equal(blocked.primary.reason, 'missing-material');
assert.equal(blocked.primary.action, 'inspect');

const outside = buildSettlementRecoveryPlan({ locationId: '', activeService: '' });
assert.equal(outside.primary.reason, 'outside-settlement');
assert.equal(outside.evidence.failClosed, true);

const defeated = buildSettlementRecoveryPlan({ settlementId: 'winterhold', defeated: true });
assert.equal(defeated.primary.action, 'rest');
assert.equal(defeated.evidence.resumeEligible, false);

const reordered = buildSettlementRecoveryPlan({
  activeService: 'market', settlementId: 'winterhold', panel: 'trade', locationId: 'market',
  revision: 7, route: ['gate', 'market'], canSave: true,
  feedback: { message: 'ok', action: 'trade', status: 'success' },
});
assert.equal(reordered.fingerprint, complete.fingerprint);

const tampered = { ...complete, fingerprint: 'bad' };
assert.equal(validateSettlementRecoveryPlan(tampered).reason, 'fingerprint-mismatch');
console.log('Settlement recovery plan regression: PASS');
