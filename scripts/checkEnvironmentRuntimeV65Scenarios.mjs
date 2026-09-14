import assert from 'node:assert/strict';
import { buildScenario, runScenario, runScenarioMatrix, summarizeScenarioMatrix, validateScenarioResult, scenarioEvidence } from '../src/3d/world/environmentRuntimeScenarioV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); } catch (e) { failures.push(`${id}:${e?.stack || e}`); } };

check('scenario-names', () => {
  for (const name of ['summer-forest', 'wetland-edge', 'alpine-winter', 'coastal-storm', 'taiga-autumn', 'open-steppe']) assert.equal(buildScenario(name).name, name);
});

check('scenario-matrix-desktop', () => {
  const results = runScenarioMatrix('desktop');
  assert.equal(results.length, 6);
  assert.ok(results.every((result) => validateScenarioResult(result).ok));
  assert.ok(results.every((result) => result.runtime));
});

check('scenario-matrix-mobile', () => {
  const results = runScenarioMatrix('mobile');
  const summary = summarizeScenarioMatrix(results);
  assert.equal(summary.count, 6);
  assert.ok(summary.p0PassRate >= 0.5);
  assert.ok(summary.meanVisibility > 0.25);
});

check('summer-forest-profile', () => {
  const result = runScenario('summer-forest');
  assert.equal(result.scenario.kind, 'forest');
  assert.ok(result.metrics.adaptiveAcceptance >= 0.55);
});

check('wetland-profile', () => {
  const result = runScenario('wetland-edge');
  assert.equal(result.scenario.kind, 'wetland');
  assert.ok(result.runtime.surface.meanVisibility > 0.3);
});

check('alpine-profile', () => {
  const result = runScenario('alpine-winter');
  assert.equal(result.scenario.kind, 'alpine');
  assert.ok(result.metrics.adaptiveAcceptance >= 0.55);
});

check('storm-profile', () => {
  const result = runScenario('coastal-storm');
  assert.equal(result.scenario.weather.mode, 'storm');
  assert.ok(result.metrics.visibility >= 0.06);
});

check('autumn-profile', () => {
  const result = runScenario('taiga-autumn');
  assert.equal(result.scenario.kind, 'taiga');
  assert.ok(result.runtime.phenology.digest);
});

check('steppe-profile', () => {
  const result = runScenario('open-steppe');
  assert.equal(result.scenario.kind, 'steppe');
  assert.ok(result.runtime.adaptive.summary.sampleCount > 0);
});

check('scenario-evidence', () => {
  const result = runScenario('summer-forest');
  const evidence = scenarioEvidence(result);
  assert.equal(evidence.length, 3);
  assert.ok(evidence.every((item) => item.width === 1536 && item.height === 1024));
});

check('scenario-determinism', () => {
  const a = runScenario('taiga-autumn');
  const b = runScenario('taiga-autumn');
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.visual, b.visual);
});

check('scenario-summary', () => {
  const results = runScenarioMatrix('desktop');
  const summary = summarizeScenarioMatrix(results);
  assert.ok(summary.qualificationRate >= 0);
  assert.ok(summary.qualificationRate <= 1);
  assert.ok(summary.p0PassRate >= 0);
  assert.ok(summary.p0PassRate <= 1);
});

if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-scenarios', checks: 12 }));
