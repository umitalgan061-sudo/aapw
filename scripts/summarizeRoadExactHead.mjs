#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_ROOT = resolve(ROOT, 'artifacts/road-route-exact-head');
const HEAD = process.env.EXPECTED_HEAD_SHA ?? null;

function readJson(name) {
  const path = resolve(ARTIFACT_ROOT, name);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function write(path, content) {
  const absolute = resolve(ROOT, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

const subedge = readJson('subedge-safety.json');
const stress = readJson('stress-matrix.json');
const determinism = readJson('determinism-performance.json');
const canonical = readJson('canonical-network.json');
const settlement = readJson('settlement-geometry.json');

assert.equal(subedge.policy.id, canonical.policies.routing.id, 'subedge/canonical routing policy mismatch');
assert.equal(stress.policy.id, canonical.policies.routing.id, 'stress/canonical routing policy mismatch');
assert.equal(determinism.policy.id, canonical.policies.routing.id, 'determinism/canonical routing policy mismatch');
assert.equal(subedge.profilePolicy.id, canonical.policies.surfaceProfile.id, 'surface-profile policy mismatch');
assert.equal(canonical.runtime.seatCount, 14);
assert.equal(canonical.runtime.edgeCount, 13);
assert.equal(canonical.runtime.connectedSeatCount, 14);
assert.equal(settlement.seatCount, 14);
assert(stress.scenarioCount >= 40);
assert(determinism.routeCount >= 20);
assert.equal(determinism.fallbackCount <= 5, true);
assert(canonical.runtime.worstLegacyRiverRun <= 3);
assert(canonical.distributions.maxGradeDegrees.max < 19.5);
assert(stress.distributions.gradeDegrees.max < 19.4);
assert(settlement.distributions.coreErrorMeters.max <= settlement.policy.coreHeightToleranceMeters + 1e-9);
assert(settlement.distributions.outerRecoveryErrorMeters.max <= settlement.policy.outerRecoveryToleranceMeters + 1e-9);
assert(settlement.distributions.flattenFormulaErrorMeters.max <= settlement.policy.flattenFormulaToleranceMeters + 1e-12);

const fixtureByName = new Map(subedge.fixtures.map((fixture) => [fixture.name, fixture]));
assert(fixtureByName.has('hidden-knife-ridge'));
assert(fixtureByName.has('broad-mountain-detour'));
assert(fixtureByName.has('endpoint-ramp'));
assert(fixtureByName.has('impossible-cliff-fail-soft'));
assert(fixtureByName.has('deterministic-repeat'));
assert.equal(fixtureByName.get('impossible-cliff-fail-soft').fallback, true);
assert(fixtureByName.get('hidden-knife-ridge').routedMaxGrade < 19.5);

const summary = Object.freeze({
  exactHead: HEAD,
  policies: canonical.policies,
  canonical: {
    seatCount: canonical.runtime.seatCount,
    connectedSeatCount: canonical.runtime.connectedSeatCount,
    edgeCount: canonical.runtime.edgeCount,
    totalLengthMeters: canonical.runtime.totalLengthMeters,
    networkBuildMs: canonical.runtime.networkBuildMs,
    maxGradeDegrees: canonical.distributions.maxGradeDegrees.max,
    p99GradeDegrees: canonical.distributions.maxGradeDegrees.p99,
    worstLegacyRiverRun: canonical.runtime.worstLegacyRiverRun,
  },
  synthetic: {
    stressScenarioCount: stress.scenarioCount,
    stressMaxGradeDegrees: stress.distributions.gradeDegrees.max,
    stressP99GradeDegrees: stress.distributions.gradeDegrees.p99,
    stressElapsedMs: stress.elapsedMs,
    determinismRouteCount: determinism.routeCount,
    uniqueChecksums: determinism.checksumUniqueCount,
    fallbackCount: determinism.fallbackCount,
    deterministicPassMs: determinism.firstElapsedMs,
  },
  settlement: {
    seatCount: settlement.seatCount,
    maxCoreErrorMeters: settlement.distributions.coreErrorMeters.max,
    maxOuterRecoveryErrorMeters: settlement.distributions.outerRecoveryErrorMeters.max,
    maxFlattenFormulaErrorMeters: settlement.distributions.flattenFormulaErrorMeters.max,
    recordedNaturalTransitionGradeDegrees: settlement.distributions.recordedNaturalTransitionGradeDegrees.max,
    overlappingPadSampleCount: settlement.overlap.overlappingPadSampleCount,
  },
  subedgeFixtures: subedge.fixtures,
});

write('artifacts/road-route-exact-head/summary.json', `${JSON.stringify(summary, null, 2)}\n`);
const markdown = [
  '# Road exact-head safety summary',
  '',
  `- exact head: ${HEAD ?? 'local'}`,
  `- routing policy: ${summary.policies.routing.id}`,
  `- surface profile: ${summary.policies.surfaceProfile.id}`,
  `- canonical seats connected: ${summary.canonical.connectedSeatCount}/${summary.canonical.seatCount}`,
  `- canonical cart-road edges: ${summary.canonical.edgeCount}`,
  `- canonical network length: ${(summary.canonical.totalLengthMeters / 1000).toFixed(2)} km`,
  `- canonical dense max grade: ${summary.canonical.maxGradeDegrees.toFixed(2)}°`,
  `- canonical p99 edge max grade: ${summary.canonical.p99GradeDegrees.toFixed(2)}°`,
  `- longest canonical river-adjacent point run: ${summary.canonical.worstLegacyRiverRun}`,
  `- synthetic stress scenarios: ${summary.synthetic.stressScenarioCount}`,
  `- synthetic stress max grade: ${summary.synthetic.stressMaxGradeDegrees.toFixed(2)}°`,
  `- deterministic routes: ${summary.synthetic.determinismRouteCount}`,
  `- unique route checksums: ${summary.synthetic.uniqueChecksums}`,
  `- synthetic physically-unroutable fallbacks: ${summary.synthetic.fallbackCount}`,
  `- settlement core max error: ${summary.settlement.maxCoreErrorMeters.toFixed(9)} m`,
  `- settlement outer recovery max error: ${summary.settlement.maxOuterRecoveryErrorMeters.toFixed(9)} m`,
  `- settlement strongest-pad formula max error: ${summary.settlement.maxFlattenFormulaErrorMeters.toExponential(2)} m`,
  `- overlapping settlement-pad samples audited: ${summary.settlement.overlappingPadSampleCount}`,
  `- recorded natural radial terrain max grade (diagnostic only): ${summary.settlement.recordedNaturalTransitionGradeDegrees.toFixed(2)}°`,
  '',
  '## Sub-edge fixtures',
  '',
  '| fixture | routed max grade | fallback |',
  '| --- | ---: | ---: |',
  ...summary.subedgeFixtures.map((fixture) => `| ${fixture.name} | ${Number(fixture.routedMaxGrade ?? fixture.maxGradeDegrees ?? 0).toFixed(2)}° | ${fixture.fallback === true ? 'yes' : 'no'} |`),
  '',
].join('\n');
write('artifacts/road-route-exact-head/summary.md', markdown);
console.log('[summarizeRoadExactHead] PASS');
console.log(JSON.stringify(summary, null, 2));
