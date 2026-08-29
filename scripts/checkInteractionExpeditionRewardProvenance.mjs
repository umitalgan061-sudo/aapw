import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildQuartermasterText,
  createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';

const source = fs.readFileSync(new URL('../src/3d/gameplay/interaction.js', import.meta.url), 'utf8');
assert.match(
  source,
  /economy\.credit\(rewardCopper, \{ sourceId: `expedition-contract:\$\{entry\.id\}`, label: entry\.label \}\)/,
  'first-completion expedition rewards must carry route-specific receipt provenance',
);
assert.match(
  source,
  /economy\.credit\(masteryCopper, \{ sourceId: 'expedition-mastery', label: 'Sefer ustalığı' \}\)/,
  'mastery reward provenance must remain distinct from route contract receipts',
);

const economy = createInteractionEconomyState(40);
const watch = economy.credit(8, {
  sourceId: 'expedition-contract:dragonstone-watch-circuit',
  label: 'Nöbet Yolu Devriyesi',
});
assert.equal(watch.ok, true);
assert.equal(watch.balanceCopper, 48);
assert.deepEqual(watch.receipt, {
  sequence: 1,
  sourceId: 'expedition-contract:dragonstone-watch-circuit',
  label: 'Nöbet Yolu Devriyesi',
  creditedCopper: 8,
  balanceCopper: 48,
});

const tavern = economy.credit(12, {
  sourceId: 'expedition-contract:dragonstone-harbor-tavern-run',
  label: 'Liman Taverna Seferi',
});
assert.equal(tavern.ok, true);
assert.notEqual(tavern.receipt.sourceId, watch.receipt.sourceId);

const saved = economy.snapshot();
const restored = createInteractionEconomyState();
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved, 'route receipt provenance must survive save/load');

const text = buildQuartermasterText(restored.snapshot());
assert.match(text, /Son gelir: Liman Taverna Seferi · \+12 bakır · bakiye 60/);
assert.doesNotMatch(text, /Son gelir: Sefer kontratı · \+12/);

const bounded = createInteractionEconomyState(0);
const authoredCredits = [
  ['dragonstone-watch-circuit', 'Nöbet Yolu Devriyesi', 8],
  ['dragonstone-harbor-tavern-run', 'Liman Taverna Seferi', 12],
  ['dragonstone-ridge-camp', 'Sırt Kampı Seferi', 10],
  ['dragonstone-sea-wall-run', 'Deniz Duvarı Seferi', 9],
  ['dragonstone-yard-supply', 'Avlu Erzak Seferi', 7],
  ['dragonstone-gate-patrol', 'Kapı Devriyesi', 6],
];
for (const [routeId, label, copper] of authoredCredits) {
  assert.equal(bounded.credit(copper, { sourceId: `expedition-contract:${routeId}`, label }).ok, true);
}
const boundedSaved = bounded.snapshot();
assert.equal(boundedSaved.ledger.recentCredits.length, 5, 'credit ledger must keep the configured bounded history');
assert.deepEqual(
  boundedSaved.ledger.recentCredits.map(({ sequence, sourceId, label }) => ({ sequence, sourceId, label })),
  authoredCredits.slice(-5).map(([routeId, label], index) => ({
    sequence: index + 2,
    sourceId: `expedition-contract:${routeId}`,
    label,
  })),
  'bounded ledger eviction must preserve surviving route-specific provenance and original sequence order',
);
const boundedRestored = createInteractionEconomyState();
boundedRestored.restore(boundedSaved);
assert.deepEqual(
  boundedRestored.snapshot().ledger.recentCredits,
  boundedSaved.ledger.recentCredits,
  'bounded route provenance history must survive save/load without relabeling or resequencing',
);
const masteryAfterRestore = boundedRestored.credit(20, { sourceId: 'expedition-mastery', label: 'Sefer ustalığı' });
assert.equal(masteryAfterRestore.receipt.sequence, 7, 'new credits after restore must continue the surviving receipt sequence');
assert.equal(masteryAfterRestore.receipt.sourceId, 'expedition-mastery');
assert.equal(boundedRestored.snapshot().ledger.recentCredits.length, 5);
assert.deepEqual(
  boundedRestored.snapshot().ledger.recentCredits.at(-1),
  masteryAfterRestore.receipt,
  'mastery credit must remain distinct when the bounded route ledger rolls forward',
);
const masteryText = buildQuartermasterText(boundedRestored.snapshot());
assert.match(
  masteryText,
  /Son gelir: Sefer ustalığı · \+20 bakır · bakiye 72/,
  'quartermaster UX must surface mastery provenance after a bounded-ledger restore and rollover',
);
assert.doesNotMatch(
  masteryText,
  /Son gelir: Kapı Devriyesi/,
  'quartermaster UX must not keep presenting the previous route receipt after mastery becomes the latest credit',
);

console.log('Interaction expedition reward provenance acceptance PASS');
