import assert from 'node:assert/strict';
import { createPlayerCombatOutcomeTelemetry } from '../src/3d/gameplay/playerCombatOutcomeTelemetry.js';

const telemetry = createPlayerCombatOutcomeTelemetry({ maxEvents: 3 });
telemetry.record({ outcome: 'hit', amount: 12.5, poiseDamage: 4, targetId: 'wolf', attackSerial: 2, comboStep: 1 });
telemetry.record({ outcome: 'blocked', amount: -4, staminaCost: 3, timestampMs: 42 });
telemetry.record({ outcome: 'parried', amount: 8 });
telemetry.record({ outcome: 'unknown', amount: Infinity });

const snapshot = telemetry.snapshot();
assert.equal(snapshot.count, 3);
assert.equal(snapshot.events[0].outcome, 'blocked');
assert.equal(snapshot.events[2].outcome, 'miss');
assert.equal(snapshot.totals.miss, 1);
assert.equal(snapshot.totals.blocked, 1);
assert.equal(snapshot.damage, 8);
assert.equal(snapshot.events[0].amount, 0);

const first = JSON.stringify(snapshot);
const second = JSON.stringify(telemetry.snapshot());
assert.equal(first, second, 'snapshot must be deterministic');

telemetry.reset();
assert.equal(telemetry.snapshot().count, 0);
console.log('PLAYER_COMBAT_OUTCOME_TELEMETRY_OK');