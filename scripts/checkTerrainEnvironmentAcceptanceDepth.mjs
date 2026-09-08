import assert from 'node:assert/strict';
import { runEnvironmentAcceptanceSuite, acceptanceSummary, acceptanceMatrixForCategory } from '../src/3d/world/terrainEnvironmentAcceptanceSuite.js';

const report = runEnvironmentAcceptanceSuite();
assert.equal(report.policyId.includes('terrain-environment-acceptance-suite'), true);
assert.equal(report.deterministic, true);
assert.equal(report.mutationFree, true);
assert.equal(report.sections.length >= 8, true);

const contractSection = report.sections.find((section) => section.observedContractId);
assert.equal(contractSection?.exactId, true);
const geologySection = report.sections.find((section) => section.coverage?.assetCount >= 2);
assert.equal(Boolean(geologySection), true);

for (const category of ['tree', 'rock', 'cliff', 'scree']) {
  const matrix = acceptanceMatrixForCategory(category);
  assert.equal(matrix.rows.length >= 1, true);
  assert.equal(matrix.rows.every((row) => row.season), true);
}

const summary = acceptanceSummary();
assert.equal(summary.policyId, report.policyId);
assert.equal(summary.errorCount, report.errorCount);
console.log('[terrain-environment-acceptance-depth] RESULT', JSON.stringify({ ok: report.ok, errorCount: report.errorCount, sectionCount: report.sectionCount, errors: report.errors }));
