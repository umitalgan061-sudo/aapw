import assert from 'node:assert/strict';
import { ACTION_ORDER, buildSettlementJourneyContract, stableSerialize } from '../src/3d/gameplay/settlementJourneyContract.js';

const input = {
  insideSettlement: true,
  saveEnabled: true,
  settlementId: 'winterfell',
  playerLevel: 4,
  capabilities: ['blacksmith', 'market', 'tavern'],
  currentNodeId: 'forge-1',
  nodes: [
    { id: 'forge-1', role: 'blacksmith', action: 'craft', label: 'Forge a sword', completed: false, capability: 'blacksmith' },
    { id: 'market-1', role: 'market', action: 'trade', completed: false, capability: 'market' },
    { id: 'quest-1', role: 'questgiver', action: 'acceptQuest', completed: true },
  ],
};

const first = buildSettlementJourneyContract(input);
const second = buildSettlementJourneyContract(input);
assert.equal(first.fingerprint, second.fingerprint);
assert.equal(stableSerialize(first), stableSerialize(second));
assert.deepEqual(first.capabilities, ['blacksmith', 'market', 'tavern']);
assert.equal(first.summary.completedNodes, 1);
assert.equal(first.summary.remainingNodes, 2);
assert.equal(first.rows[0].action, ACTION_ORDER[0]);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.rows), true);
assert.equal(Object.isFrozen(first.state), true);
assert.throws(() => { first.state.insideSettlement = false; }, TypeError);

const outside = buildSettlementJourneyContract({ nodes: input.nodes, actions: ['craft', 'exit'], insideSettlement: false });
assert.equal(outside.rows.find((row) => row.action === 'craft').reason, 'outside-settlement');
assert.equal(outside.rows.find((row) => row.action === 'exit').available, false);

const defeated = buildSettlementJourneyContract({ nodes: input.nodes, insideSettlement: true, defeated: true });
assert.equal(defeated.rows.find((row) => row.action === 'craft').reason, 'defeated');

const noSave = buildSettlementJourneyContract({ nodes: input.nodes, insideSettlement: true, saveEnabled: false, actions: ['save'] });
assert.equal(noSave.rows[0].reason, 'save-disabled');

const malformed = buildSettlementJourneyContract({ playerLevel: Infinity, nodes: [null, { id: 7, available: 'yes' }] });
assert.equal(malformed.state.playerLevel, 1);
assert.equal(malformed.nodes[0].id, 'node-1');
assert.equal(malformed.nodes[1].id, 'node-2');
assert.equal(malformed.nodes[1].available, true);

console.log('checkSettlementJourneyContract: PASS');
