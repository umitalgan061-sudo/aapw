import assert from 'node:assert/strict';
import {
  createSettlementWorldCoverageContinuityEncounterBudget,
  validateSettlementWorldCoverageContinuityEncounterBudget,
  summarizeSettlementWorldCoverageContinuityEncounterBudget,
} from '../src/3d/gameplay/settlementWorldCoverageContinuityEncounterBudget.js';

const base = {
  settlement: {
    id: 'winterfell-edge',
    regionId: 'the-north',
    anchor: { x: 512, y: 0, z: 768 },
    entrance: { x: 518, y: 0, z: 768 },
    services: ['gate', 'market', 'tavern', 'stable'],
  },
  player: { position: { x: 548, y: 0, z: 768 }, inSettlement: false },
  surface: { biome: 'north-temperate', layer: 'road', slopeDegrees: 2 },
  seed: 77,
  hour: 15,
  weather: { type: 'clear' },
  roadClass: 'gateway',
};

const desktop = createSettlementWorldCoverageContinuityEncounterBudget(base);
const mobile = createSettlementWorldCoverageContinuityEncounterBudget({ ...base, mobile: true });
const validation = validateSettlementWorldCoverageContinuityEncounterBudget(base);
const summary = summarizeSettlementWorldCoverageContinuityEncounterBudget(base);
const replay = createSettlementWorldCoverageContinuityEncounterBudget(JSON.parse(JSON.stringify(base)));

assert.equal(validation.ok, true);
assert.ok(desktop.selectedCount <= desktop.maxSlots);
assert.ok(mobile.selectedCount <= mobile.maxSlots);
assert.ok(mobile.maxSlots < desktop.maxSlots);
assert.ok(desktop.prioritySlots.length <= 4);
assert.equal(desktop.fingerprint, replay.fingerprint);
assert.equal(summary.topSlot, desktop.slots[0]?.id ?? null);
assert.equal(desktop.ownership.readOnly, true);
assert.equal(desktop.ownership.noNpcSpawn, true);
assert.ok(desktop.slots.every((slot) => slot.cost > 0 && slot.score >= 0 && slot.score <= 1));

console.log(JSON.stringify({
  ok: true,
  settlementId: desktop.settlementId,
  desktopSlots: desktop.selectedCount,
  mobileSlots: mobile.selectedCount,
  budgetCost: desktop.budgetCost,
  fingerprint: desktop.fingerprint,
}));
