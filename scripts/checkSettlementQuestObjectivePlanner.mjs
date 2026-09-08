import assert from 'node:assert/strict';
import { createSettlementVerticalSlice } from '../src/3d/gameplay/settlementVerticalSlice.js';
import { planSettlementQuestObjectives, summarizeSettlementQuestObjectives } from '../src/3d/gameplay/settlementQuestObjectivePlanner.js';

const definition = {
  id: 'winterfell-slice',
  settlementId: 'winterfell',
  entryNodeId: 'gate',
  nodes: [
    { id: 'gate', kind: 'door', label: 'Ana Kapı', gates: [{ type: 'flag', key: 'gateOpen', reason: 'Kapı kapalı' }] },
    { id: 'market', kind: 'vendor', label: 'Pazar', gates: [{ type: 'item', itemId: 'copper', quantity: 3, reason: 'Bakır gerekli' }] },
    { id: 'smith', kind: 'crafting', label: 'Demirci', gates: [{ type: 'capability', capability: 'crafting', reason: 'Üretim kullanılamıyor' }] },
  ],
};

const first = planSettlementQuestObjectives({ definition, context: { flags: { gateOpen: true }, items: { copper: 3 }, capabilities: { crafting: true } }, currentNodeId: 'gate' });
const second = planSettlementQuestObjectives({ definition, context: { flags: { gateOpen: true }, items: { copper: 3 }, capabilities: { crafting: true } }, currentNodeId: 'gate' });
assert.deepEqual(first, second);
assert.equal(first.counts.actionable, 3);
assert.equal(first.objectives[0].status, 'ready');
assert.equal(first.objectives[1].status, 'available');
assert.equal(first.objectives[2].status, 'available');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.objectives[0]), true);

const blocked = planSettlementQuestObjectives({ definition, context: { flags: { gateOpen: false }, items: { copper: 1 }, capabilities: { crafting: false } }, currentNodeId: 'gate' });
assert.equal(blocked.counts.actionable, 0);
assert.equal(blocked.objectives[0].status, 'blocked');
assert.equal(blocked.objectives[1].reasons[0], 'Bakır gerekli');
assert.equal(blocked.objectives[2].status, 'locked');

const summary = summarizeSettlementQuestObjectives(blocked);
assert.deepEqual(summary.current, { nodeId: 'gate', label: 'Ana Kapı', status: 'blocked' });
assert.deepEqual(summary.actionable, []);
assert.deepEqual(summary.blocked, ['gate', 'market', 'smith']);

const slice = createSettlementVerticalSlice({ definition, handlers: { enterSettlement: () => ({ ok: true }) } });
assert.equal(slice.availableActions({ flags: { gateOpen: true } }).length, 0);
console.log(JSON.stringify({ ok: true, planner: 'settlementQuestObjectivePlanner', deterministic: true, actionable: first.counts.actionable, blocked: blocked.counts.blocked }));
