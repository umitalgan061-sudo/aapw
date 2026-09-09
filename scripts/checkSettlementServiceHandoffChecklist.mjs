import { strict as assert } from 'node:assert';
import {
  createSettlementServiceHandoffChecklist,
  serializeSettlementServiceHandoffChecklist,
} from '../src/3d/gameplay/settlementServiceHandoffChecklist.js';

const input = {
  inSettlement: true,
  currentService: 'blacksmith',
  fatigue: 84,
  health: 100,
  services: [
    { id: 'blacksmith', label: 'Demirci', domain: 'smithing', enabled: true, unlocked: true, actions: ['talk', 'craft'], primaryAction: 'craft', objective: 'Demir kılıcı tamamla' },
    { id: 'market', label: 'Pazar', domain: 'trade', enabled: true, unlocked: false, blockedReason: 'Görev kilidi', actions: ['talk', 'trade'], primaryAction: 'trade' },
    { id: 'tavern', label: 'Han', domain: 'rest-dialogue', enabled: true, unlocked: true, actions: ['talk', 'rest'], primaryAction: 'rest' },
  ],
};

const first = createSettlementServiceHandoffChecklist(input);
const second = createSettlementServiceHandoffChecklist(input);
assert.deepEqual(first, second);
assert.equal(first.recommendedService, 'blacksmith');
assert.equal(first.canInteract, true);
assert.equal(first.services[0].recommended, true);
assert.equal(first.services[1].enabled, false);
assert.match(first.notes.join(' | '), /Yüksek yorgunluk/);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.services[0]), true);
assert.equal(serializeSettlementServiceHandoffChecklist(input), JSON.stringify(first));

const outside = createSettlementServiceHandoffChecklist({ inSettlement: false, health: 0, services: [] });
assert.equal(outside.canInteract, false);
assert.deepEqual(outside.notes, ['Yerleşim dışında', 'Oyuncu etkisiz']);

const malformed = createSettlementServiceHandoffChecklist({ services: [{ id: 7, enabled: 'yes', actions: ['craft', 'wat'] }], fatigue: 'bad' });
assert.equal(malformed.fatigue, 0);
assert.equal(malformed.services[0].enabled, false);
assert.equal(malformed.services[0].blockedReason, 'hazır değil');

console.log('settlement service handoff checklist: PASS');
