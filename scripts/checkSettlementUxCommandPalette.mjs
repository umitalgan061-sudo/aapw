import assert from 'node:assert/strict';
import { createSettlementUxCommandPalette } from '../src/3d/gameplay/settlementUxCommandPalette.js';

const model = {
  build: () => ({
    version: 7,
    revision: 12,
    header: { title: 'Blacksmith', location: 'North Hamlet' },
    service: { id: 'blacksmith' },
    feedback: { action: 'craft', status: 'blocked', code: 'missing-materials' },
    actions: [
      { id: 'craft', action: 'craft', label: 'Forge blade', enabled: false, reason: 'missing-materials', shortcut: 'C' },
      { id: 'talk', action: 'talk', label: 'Speak to smith', enabled: true, priority: 2, shortcut: 'E' },
      { id: 'trade', action: 'trade', label: 'Trade', enabled: true, priority: 3 },
      { id: 'talk', action: 'talk', label: 'Duplicate', enabled: true, priority: 99 },
      { id: 'save', action: 'save', enabled: false, reason: 'save-disabled' },
    ],
  }),
};

const palette = createSettlementUxCommandPalette(model);
const first = palette.build();
const second = palette.build();
assert.deepEqual(first, second, 'palette output must be deterministic');
assert.equal(first.total, 4);
assert.equal(first.enabledCount, 2);
assert.equal(first.blockedCount, 2);
assert.equal(first.primaryCommandId, 'talk');
assert.equal(first.commands[0].action, 'talk');
assert.equal(first.commands.some((row) => row.id === 'craft' && row.reason === 'missing-materials'), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.commands), true);
assert.equal(Object.isFrozen(first.commands[0]), true);
assert.equal(palette.serialize(), JSON.stringify(first));
assert.equal(palette.build('smith').total, 2);
assert.equal(palette.build('nomatch').total, 0);

const malformed = createSettlementUxCommandPalette({ build: () => ({ version: 'bad', revision: 'bad', actions: [{ action: null, priority: 'nope' }] }) }).build();
assert.equal(malformed.sourceVersion, 0);
assert.equal(malformed.revision, 0);
assert.equal(malformed.commands[0].action, 'interact');
assert.equal(malformed.commands[0].priority, 999);

console.log('Settlement UX command palette checks passed.');
