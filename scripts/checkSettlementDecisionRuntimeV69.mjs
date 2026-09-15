import {
  rankSettlementDecisionsV69,
  resolveSettlementDecisionV69,
  summarizeSettlementDecisionV69,
  validateSettlementDecisionV69,
} from '../src/3d/world/SettlementDecisionRuntimeV69.js';

const validation = validateSettlementDecisionV69();
if (!validation.ok) throw new Error(validation.errors.join('\n'));
if (validation.count !== 4200) throw new Error(`expected 4200 entries, got ${validation.count}`);

const summary = summarizeSettlementDecisionV69();
if (summary.domains.length !== 20) throw new Error('expected 20 domains');
for (const [domain, count] of Object.entries(summary.counts)) {
  if (count !== 210) throw new Error(`${domain} has ${count} entries`);
}

const quiet = resolveSettlementDecisionV69('safety', 1, { signal: 0, pressure: 0, risk: 0 });
if (!quiet.ok || quiet.active) throw new Error('low-risk decision unexpectedly active');

const urgent = resolveSettlementDecisionV69('safety', 210, { signal: 1, pressure: 1, risk: 1 });
if (!urgent.ok || !urgent.active || urgent.score <= 0) throw new Error('urgent decision did not activate');

const ranked = rankSettlementDecisionsV69('traffic', { signal: 0.9, pressure: 0.7, risk: 0.8 });
if (ranked.length !== 210) throw new Error(`expected 210 ranked decisions, got ${ranked.length}`);
for (let index = 1; index < ranked.length; index += 1) {
  if (ranked[index - 1].score < ranked[index].score) throw new Error('ranking is not descending');
}

console.log(`V69 settlement decision runtime validated: ${validation.count} entries`);
