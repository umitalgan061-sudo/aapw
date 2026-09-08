import assert from 'node:assert/strict';
import { createSettlementInteractionFocus } from '../src/3d/gameplay/settlementInteractionFocus.js';

const runtime = {
  getViewModel() {
    return {
      version: 1, contentVersion: 2, revision: 4,
      activeService: { id: 'blacksmith' },
      availableActions: ['talk', 'trade', 'craft', 'equip'],
      feedback: { action: 'craft', status: 'blocked', code: 'missing-material' },
      player: { locationId: 'forge', copper: 12, fatigue: 7, health: 80 },
      panels: { trade: [{ id: 'iron_ore' }], craft: [{ id: 'iron_sword', ready: false }], travel: [], quests: [], perks: [] },
      route: [], history: [],
    };
  },
  getItem(id) { return { id }; },
};

const focus = createSettlementInteractionFocus(runtime, { preferredActions: ['craft', 'talk'], maxActions: 3 });
const first = focus.build();
const second = focus.build();
assert.deepEqual(first, second);
assert.equal(first.primaryIntent, 'smithing');
assert.equal(first.focus.action, 'craft');
assert.deepEqual(first.blockedActions, ['craft']);
assert.equal(first.panelCounts.craft, 1);
assert.equal(focus.describeQuest('missing').ok, false);
console.log('[checkSettlementInteractionFocus] PASS');
