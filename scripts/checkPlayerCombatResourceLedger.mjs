import assert from 'node:assert/strict';
import { createPlayerCombatResourceLedger, previewPlayerCombatResourceLedger } from '../src/3d/gameplay/playerCombatResourceLedger.js';

const events = [
  { type: 'light', source: 'keyboard' },
  { type: 'dodge', source: 'touch' },
  { type: 'guardBreak', poiseDamage: 40, source: 'enemy' },
];
const first = previewPlayerCombatResourceLedger({ events });
const second = previewPlayerCombatResourceLedger({ events });
assert.deepEqual(first, second);
assert.equal(first.stamina, 60);
assert.equal(first.poise, 60);

const ledger = createPlayerCombatResourceLedger({ stamina: 20, poise: 10, maxEvents: 2 });
const after = ledger.apply({ type: 'heavy' });
assert.equal(after.exhausted, true);
assert.equal(ledger.readHistory().length, 1);
ledger.apply({ type: 'staggered' });
ledger.apply({ type: 'unknown' });
assert.equal(ledger.readHistory().length, 2);
assert.equal(ledger.read().staggered, true);
assert.equal(Object.isFrozen(ledger.read()), true);
const serialized = ledger.serialize();
assert.equal(serialized, ledger.serialize());
ledger.recover({ stamina: 50, poise: 100 });
assert.equal(ledger.read().stamina, 50);
assert.equal(ledger.read().poise, 100);
ledger.reset();
assert.equal(ledger.read().stamina, 20);
assert.equal(ledger.read().poise, 10);
console.log('PLAYER_COMBAT_RESOURCE_LEDGER_OK');
