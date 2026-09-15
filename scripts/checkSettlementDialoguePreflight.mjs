import assert from 'node:assert/strict';
import { buildSettlementDialoguePreflight, buildSettlementDialogueBatch, serializeSettlementDialoguePreflight } from '../src/3d/gameplay/settlementDialoguePreflight.js';

const snapshot = { flags: { gate_open: true }, reputation: { tavern: 4 }, quests: { intro_done: true }, items: { iron_ore: 3 }, skills: { smithing: 12 } };
const line = { id: 'tavern-intro', speakerId: 'innkeeper', text: 'Kapıdaki nöbetçiyi gördün mü?', conditions: [
  { id: 'r', type: 'reputation', target: 'tavern', operator: '>=', value: 3 },
  { id: 'f', type: 'flag', target: 'gate_open', value: 1 },
] };
const a = buildSettlementDialoguePreflight(line, snapshot);
const b = buildSettlementDialoguePreflight(line, snapshot);
assert.equal(a.available, true);
assert.equal(a.failedCount, 0);
assert.equal(a.nextAction, 'presentDialogue');
assert.equal(JSON.stringify(a), JSON.stringify(b));
assert.equal(Object.isFrozen(a), true);
assert.throws(() => { a.available = false; }, TypeError);

const blocked = buildSettlementDialoguePreflight({ ...line, conditions: [{ type: 'item', target: 'coal', operator: '>=', value: 2 }] }, snapshot);
assert.equal(blocked.available, false);
assert.equal(blocked.blockedReason, 'below-threshold');
assert.equal(blocked.nextAction, 'showBlockedDialogue');

const batch = buildSettlementDialogueBatch([line, { id: 'blocked', conditions: [{ type: 'skill', target: 'smithing', operator: '>=', value: 20 }] }], snapshot);
assert.equal(batch.availableCount, 1);
assert.equal(batch.blockedCount, 1);
assert.equal(batch.firstAvailable, 'tavern-intro');
assert.equal(serializeSettlementDialoguePreflight(batch), serializeSettlementDialoguePreflight(buildSettlementDialogueBatch([line, { id: 'blocked', conditions: [{ type: 'skill', target: 'smithing', operator: '>=', value: 20 }] }], snapshot)));

const malformed = buildSettlementDialoguePreflight({ id: 'bad', conditions: [{ type: 'reputation', target: 'tavern', value: 'oops' }] }, {});
assert.equal(malformed.available, true);
assert.equal(Number.isFinite(malformed.conditions[0].actual), true);

console.log('settlement dialogue preflight: PASS');
