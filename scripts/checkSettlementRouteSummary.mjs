import { createSettlementRouteSummary, validateSettlementRouteSummary } from '../src/3d/gameplay/settlementRouteSummary.ts';

const assert = (value, message) => { if (!value) throw new Error(message); };
const rail = {
  ok: true,
  sliceId: 'slice-1',
  settlementId: 'settlement-a',
  node: { id: 'smith', kind: 'crafting', label: 'Demirci', role: 'blacksmith' },
  actions: [
    { action: 'trade', targetId: 'vendor-1', enabled: true },
    { action: 'craft', targetId: 'forge-1', enabled: false, reason: 'missing-item' },
    { action: 'trade', targetId: 'vendor-1', enabled: true },
    { action: 'bogus', targetId: 'x', enabled: true },
  ],
  visited: ['settlement-a', 'smith', 'settlement-a'],
};

const first = createSettlementRouteSummary(rail);
const second = createSettlementRouteSummary({ ...rail, actions: [...rail.actions].reverse() });
assert(validateSettlementRouteSummary(first), 'summary validates');
assert(first.node.kind === 'crafting', 'node kind preserved');
assert(first.actions.length === 2, 'invalid and duplicate actions removed');
assert(first.nextAction.action === 'trade', 'first enabled action selected');
assert(first.visited.join('|') === 'settlement-a|smith', 'visited ids normalized');
assert(first.key === second.key, 'summary key is deterministic across input ordering');
assert(Object.isFrozen(first) && Object.isFrozen(first.actions), 'summary is frozen');
assert(createSettlementRouteSummary(null).reason === 'rail-unavailable', 'missing rail fails closed');
console.log(JSON.stringify({ ok: true, actions: first.actions.length, nextAction: first.nextAction.action, key: first.key }));
