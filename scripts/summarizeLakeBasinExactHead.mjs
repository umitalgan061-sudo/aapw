#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QA_ROOT, round, writeJsonArtifact } from './lib/lakeBasinQa.mjs';

const artifactRoot = resolve(QA_ROOT, 'artifacts/lake-basin-exact-head');
const inputs = Object.freeze({
  authority: 'authority.json',
  sourceRegression: 'source-regression.json',
  worldCoverage: 'world-coverage.json',
  determinismPerformance: 'determinism-performance.json',
  heightGeometry: 'height-geometry.json',
  chunkSeams: 'chunk-seams.json',
});

function readJson(name) {
  const path = resolve(artifactRoot, name);
  assert(existsSync(path), `required lake-basin QA artifact missing: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const reports = Object.fromEntries(Object.entries(inputs).map(([key, file]) => [key, readJson(file)]));
const mountainPolicyId = reports.authority.policy.mountainPolicyId;
assert.equal(reports.worldCoverage.policyId, mountainPolicyId);
assert.equal(reports.determinismPerformance.policyId, mountainPolicyId);
assert.equal(reports.heightGeometry.policyId, mountainPolicyId);
assert.equal(reports.sourceRegression.policyIds.mountain, mountainPolicyId);
assert.equal(reports.authority.policy.lakeCellCount, 6);
assert.equal(reports.heightGeometry.lakeCount, 6);
assert.equal(reports.chunkSeams.lakeCount, 6);

const summary = Object.freeze({
  policyIds: Object.freeze({
    mountain: mountainPolicyId,
    terrainConform: reports.authority.policy.terrainPolicyId,
  }),
  canonicalLakeCellCount: reports.authority.policy.lakeCellCount,
  support: Object.freeze({
    affectedFraction: reports.worldCoverage.support.affectedFraction,
    strongFraction: reports.worldCoverage.support.strongFraction,
    exactOneFraction: reports.worldCoverage.support.exactOneFraction,
    componentCount: reports.worldCoverage.support.componentCount,
    strongComponentCount: reports.worldCoverage.support.strongComponentCount,
  }),
  geometry: Object.freeze({
    openDirections: reports.heightGeometry.aggregate.openDirections,
    directionCount: reports.heightGeometry.aggregate.directionCount,
    openDirectionFraction: reports.heightGeometry.aggregate.openDirectionFraction,
    maxObservedGradeDegrees: reports.heightGeometry.aggregate.gradeDegrees.max,
    p95ObservedGradeDegrees: reports.heightGeometry.aggregate.gradeDegrees.p95,
    maxEpsilonHeightDeltaMeters: reports.heightGeometry.aggregate.epsilonHeightDeltaMeters.max,
  }),
  seams: Object.freeze({
    comparedVertexPairs: reports.chunkSeams.comparedVertexPairs,
    maxHeightDelta: reports.chunkSeams.aggregate.heightDelta.max,
    maxUvDelta: reports.chunkSeams.aggregate.uvDelta.max,
    maxColorDelta: reports.chunkSeams.aggregate.colorDelta.max,
  }),
  determinism: Object.freeze({
    scalarChecksum: reports.determinismPerformance.checksums.scalarA,
    heightChecksum: reports.determinismPerformance.checksums.heightA,
    scalarRepeatStable: reports.determinismPerformance.checksums.scalarA
      === reports.determinismPerformance.checksums.scalarB,
    heightRepeatStable: reports.determinismPerformance.checksums.heightA
      === reports.determinismPerformance.checksums.heightB,
  }),
  timingMs: reports.determinismPerformance.timingMs,
  sourceDigests: reports.sourceRegression.sourceDigests,
});

assert(summary.support.affectedFraction < 0.08);
assert(summary.support.exactOneFraction > 0.90);
assert(summary.geometry.openDirectionFraction > 0);
assert(summary.seams.maxHeightDelta <= reports.chunkSeams.tolerances.height);
assert(summary.determinism.scalarRepeatStable);
assert(summary.determinism.heightRepeatStable);

writeJsonArtifact('artifacts/lake-basin-exact-head/summary.json', summary);

const markdown = [
  '# Lake Basin Exact-Head QA',
  '',
  `- Mountain policy: \`${summary.policyIds.mountain}\``,
  `- Terrain conformer: \`${summary.policyIds.terrainConform}\``,
  `- Canonical lake cells: **${summary.canonicalLakeCellCount}**`,
  `- Affected world fraction: **${round(summary.support.affectedFraction * 100, 3)}%**`,
  `- Strong-core fraction: **${round(summary.support.strongFraction * 100, 3)}%**`,
  `- Exactly untouched world fraction: **${round(summary.support.exactOneFraction * 100, 3)}%**`,
  `- Open cirque directions: **${summary.geometry.openDirections}/${summary.geometry.directionCount}**`,
  `- Basin grade p95: **${summary.geometry.p95ObservedGradeDegrees}°**`,
  `- Chunk shared-edge pairs: **${summary.seams.comparedVertexPairs}**`,
  `- Max shared-edge height delta: **${summary.seams.maxHeightDelta} m**`,
  `- Height determinism checksum: **${summary.determinism.heightChecksum}**`,
  '',
  'All values above are generated from the exact checked-out PR head. Gameplay road/seat browser',
  'safety is emitted separately by `gameplay-safety.json` in the runtime job.',
  '',
].join('\n');
writeFileSync(resolve(artifactRoot, 'summary.md'), markdown, 'utf8');

console.log('[summarizeLakeBasinExactHead] PASS');
console.log(markdown);
