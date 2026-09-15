import assert from 'node:assert/strict';
import { V67_COVERAGE_MATRIX, coverageSummaryV67, validateCoverageMatrixV67 } from '../src/3d/world/environmentRuntimeCoverageMatrixV67.js';
import { V67_SCENARIOS, scenarioLedgerV67, validateScenarioLedgerV67, scenarioSummaryV67 } from '../src/3d/world/environmentRuntimeScenarioLedgerV67.js';
import { scenarioSeedV67 } from '../src/3d/world/environmentRuntimeV67.js';

assert.equal(validateCoverageMatrixV67(V67_COVERAGE_MATRIX),true);
assert.ok(V67_COVERAGE_MATRIX.length>=100);
assert.ok(coverageSummaryV67().biomes.length>=6);
const samples=V67_COVERAGE_MATRIX.slice(0,24);
const ledger=scenarioLedgerV67(samples);
assert.equal(validateScenarioLedgerV67(ledger).ok,true);
assert.equal(ledger.evaluations.length,V67_SCENARIOS.length);
assert.equal(scenarioSummaryV67(ledger).scenarios,V67_SCENARIOS.length);
assert.ok(scenarioSummaryV67(ledger).passed>0);
for(const evaluation of ledger.evaluations){
  assert.equal(typeof evaluation.id,'string');
  assert.equal(typeof evaluation.hash,'string');
  assert.equal(evaluation.hash.length,8);
  assert.ok(evaluation.runtime.digest);
  assert.equal(evaluation.runtime.contract.noWorldMutation,true);
}
assert.equal(scenarioSeedV67({id:'repeat',clock:8}),scenarioSeedV67({id:'repeat',clock:8}));
assert.notEqual(scenarioSeedV67({id:'repeat',clock:8}),scenarioSeedV67({id:'repeat',clock:9}));
const ledgerAgain=scenarioLedgerV67(samples);
assert.deepEqual(ledgerAgain.evaluations.map(x=>x.hash),ledger.evaluations.map(x=>x.hash));
assert.deepEqual(ledgerAgain.ranked.map(x=>x.id),ledger.ranked.map(x=>x.id));
for(const sample of samples){
  assert.equal(typeof sample.id,'string');
  assert.ok(sample.elevation>=0);
  assert.ok(sample.slope>=0);
  assert.ok(sample.moisture>=0&&sample.moisture<=1);
}
console.log('V67 scenario regression PASS');
