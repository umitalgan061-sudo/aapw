import assert from 'node:assert/strict';
import {
  buildSettlementDecisionContextV69,
  resolveSettlementEnvironmentDecisionV69,
  rankSettlementEnvironmentDecisionsV69,
  summarizeSettlementEnvironmentV69,
  validateSettlementEnvironmentBridgeV69,
} from '../src/3d/world/SettlementEnvironmentDecisionBridgeV69.js';

const validation = validateSettlementEnvironmentBridgeV69();
assert.equal(validation.ok, true, validation.errors.join('\n'));

const context = buildSettlementDecisionContextV69('signals', {
  signal: 0.82,
  pressure: 0.4,
  risk: 0.23,
  stability: 0.7,
});
assert.equal(context.ok, true);
assert.equal(context.domain, 'signals');
assert.ok(context.evidence.count > 0);
assert.ok(context.context.signal <= 1);
assert.ok(context.context.pressure <= 1);
assert.ok(context.context.risk <= 1);
assert.ok(context.context.stability <= 1);
assert.ok(context.context.urgency <= 1);

const decision = resolveSettlementEnvironmentDecisionV69('signals', 1, context.context);
assert.equal(decision.ok, true);
assert.ok(Number.isFinite(decision.combinedScore));
assert.ok(decision.combinedScore >= 0 && decision.combinedScore <= 1);
assert.ok(decision.evidenceScore >= 0 && decision.evidenceScore <= 1);
assert.ok(decision.contextScore >= 0 && decision.contextScore <= 1);

const ranked = rankSettlementEnvironmentDecisionsV69('signals', context.context, { limit: 8 });
assert.equal(ranked.ok, true);
assert.equal(ranked.recommendations.length, 8);
for (let index = 1; index < ranked.recommendations.length; index += 1) {
  assert.ok(ranked.recommendations[index - 1].combinedScore >= ranked.recommendations[index].combinedScore);
}

const allDomains = summarizeSettlementEnvironmentV69({
  safety: { signal: 0.9, pressure: 0.8, risk: 0.7 },
  traffic: { signal: 0.5, pressure: 0.4, risk: 0.3 },
});
assert.equal(allDomains.ok, true);
assert.equal(Object.keys(allDomains.domains).length, 20);
assert.ok(allDomains.domains.safety.recommendations.length === 3);
assert.ok(allDomains.domains.traffic.recommendations.length === 3);

const invalid = buildSettlementDecisionContextV69('not-a-domain', {});
assert.equal(invalid.ok, false);
assert.equal(invalid.error, 'unknown-settlement-domain');

console.log('Settlement Environment Decision Bridge V69: OK');
