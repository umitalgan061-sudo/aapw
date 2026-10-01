import assert from 'node:assert/strict';
import { createSettlementServiceRestPlan, applySettlementServiceRestPlan, isSettlementServiceRestPlan } from '../src/3d/modern/settlementServiceRestPlan.ts';

const allowed = createSettlementServiceRestPlan({
  service: 'tavern', action: 'rest', minutes: 90,
  player: { status: 'healthy', health: 55, stamina: 20, copper: 10 },
});
assert.equal(allowed.ok, true);
assert.equal(allowed.reason, 'allowed');
assert.equal(allowed.recovery.health, 45);
assert.equal(allowed.recovery.stamina, 80);
assert.equal(allowed.timeAdvanceMinutes, 90);
assert.equal(isSettlementServiceRestPlan(allowed), true);
assert.throws(() => { allowed.recovery.health = 0; }, TypeError);

const applied = applySettlementServiceRestPlan(
  { status: 'healthy', health: 55, stamina: 20, copper: 10 },
  allowed,
);
assert.equal(applied.ok, true);
assert.equal(applied.player.health, 100);
assert.equal(applied.player.stamina, 100);
assert.equal(applied.player.lastRestService, 'tavern');
assert.equal(applied.elapsedMinutes, 90);

const unsupported = createSettlementServiceRestPlan({ service: 'market', action: 'rest' });
assert.equal(unsupported.ok, false);
assert.equal(unsupported.reason, 'unsupported-service');
assert.equal(unsupported.timeAdvanceMinutes, 0);

const unavailable = createSettlementServiceRestPlan({ service: 'barracks', action: 'rest', player: { status: 'dead' } });
assert.equal(unavailable.reason, 'player-unavailable');

const alreadyRecovered = createSettlementServiceRestPlan({ service: 'stable', action: 'rest', player: { health: 100, stamina: 100 } });
assert.equal(alreadyRecovered.reason, 'already-recovered');
assert.equal(applySettlementServiceRestPlan({}, alreadyRecovered).reason, 'plan-not-executable');

const original = { health: 12, stamina: 34 };
const plan = createSettlementServiceRestPlan({ service: 'farm', action: 'rest', minutes: -4, player: original });
assert.deepEqual(original, { health: 12, stamina: 34 });
assert.equal(plan.minutes, 1);

console.log('[checkSettlementServiceRestPlan] PASS');
