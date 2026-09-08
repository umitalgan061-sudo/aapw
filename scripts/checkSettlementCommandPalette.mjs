import assert from 'node:assert/strict';
import { createSettlementCommandPalette, serializeSettlementCommandPalette } from '../src/3d/gameplay/settlementCommandPalette.js';

const base = {
  inSettlement: true,
  activeService: 'market',
  availableServices: ['gate', 'market', 'blacksmith', 'tavern', 'barracks', 'house'],
  fatigue: 35,
  health: 80,
  copper: 12,
  canSave: true,
};

const first = createSettlementCommandPalette(base);
const second = createSettlementCommandPalette({ ...base });
assert.deepEqual(first, second, 'palette must be deterministic');
assert.equal(first.version, 1);
assert.equal(first.commands.length, 9);
assert.equal(first.commands.find((item) => item.action === 'exit').enabled, true);
assert.equal(first.commands.find((item) => item.action === 'train').enabled, true);
assert.equal(first.commands.find((item) => item.action === 'rest').enabled, true);
assert.equal(first.enabledCount + first.blockedCount, first.commands.length);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.commands[0]), true);
assert.equal(serializeSettlementCommandPalette(first), serializeSettlementCommandPalette(second));

const outside = createSettlementCommandPalette({ inSettlement: false, availableServices: ['gate'], copper: 0 });
assert.equal(outside.commands.find((item) => item.action === 'enter').enabled, true);
assert.equal(outside.commands.find((item) => item.action === 'trade').reason, 'settlement-required');
assert.equal(outside.commands.find((item) => item.action === 'train').reason, 'settlement-required');

const locked = createSettlementCommandPalette({ inSettlement: true, availableServices: ['gate'], health: 100, fatigue: 0, copper: 0, canSave: false });
assert.equal(locked.commands.find((item) => item.action === 'rest').reason, 'already-ready');
assert.equal(locked.commands.find((item) => item.action === 'train').reason, 'insufficient-copper');
assert.equal(locked.commands.find((item) => item.action === 'save').reason, 'save-unavailable');
assert.equal(locked.commands.find((item) => item.action === 'trade').reason, 'service-locked');

const malformed = createSettlementCommandPalette(null);
assert.equal(Number.isFinite(malformed.context.fatigue), true);
assert.equal(Number.isFinite(malformed.context.health), true);
assert.equal(typeof malformed.digest, 'string');

console.log('settlement command palette contract: ok');
