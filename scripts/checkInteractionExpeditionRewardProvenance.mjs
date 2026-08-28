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

console.log('Interaction expedition reward provenance acceptance PASS');
