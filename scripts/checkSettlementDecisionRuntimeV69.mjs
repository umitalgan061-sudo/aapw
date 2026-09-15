import assert from 'node:assert/strict';
import {
  explainSettlementDecisionV69,
  rankSettlementDecisionsV69,
  resolveSettlementDecisionV69,
  summarizeSettlementDecisionV69,
  validateSettlementDecisionV69,
} from '../src/3d/world/SettlementDecisionRuntimeV69.js';

const validation = validateSettlementDecisionV69();
assert.equal(validation.ok, true, validation.errors.join('\n'));
assert.equal(validation.count, 4200);

const summary = summarizeSettlementDecisionV69();
assert.equal(summary.domains.length, 20);
for (const [domain, count] of Object.entries(summary.counts)) {
  assert.equal(count, 210, `${domain} has ${count} entries`);
}

const quiet = resolveSettlementDecisionV69('safety', 1, { signal: 0, pressure: 0, risk: 0 });
assert.equal(quiet.ok, true);
assert.equal(quiet.active, false);

const urgent = resolveSettlementDecisionV69('safety', 210, { signal: 1, pressure: 1, risk: 1 });
assert.equal(urgent.ok, true);
assert.equal(urgent.active, true);
assert.ok(urgent.score > 0);

const explanation = explainSettlementDecisionV69('safety', 210, { signal: 1, pressure: 0.8, risk: 0.9 });
assert.equal(explanation.ok, true);
assert.equal(explanation.explanation.status, 'eligible');
assert.equal(explanation.explanation.trigger, 1);
assert.ok(explanation.explanation.margin >= 0);
assert.ok(explanation.explanation.responseContribution >= 1);
assert.ok(Number.isFinite(explanation.explanation.priorityContribution));

const ranked = rankSettlementDecisionsV69('traffic', { signal: 0.9, pressure: 0.7, risk: 0.8 });
assert.equal(ranked.length, 210);
for (let index = 1; index < ranked.length; index += 1) {
  assert.ok(ranked[index - 1].score >= ranked[index].score, 'ranking is not descending');
}

const invalid = explainSettlementDecisionV69('missing-domain', 1, {});
assert.equal(invalid.ok, false);
assert.equal(invalid.error, 'decision-not-found');

console.log(`V69 settlement decision runtime validated: ${validation.count} entries`);
