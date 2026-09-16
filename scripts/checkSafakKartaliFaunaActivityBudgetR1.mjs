import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FAUNA_ACTIVITY_BUDGET_POLICY,
  FAUNA_ACTIVITY_KINDS,
  FAUNA_ACTIVITY_LODS,
  createFaunaActivityBudgetLedger,
  evaluateFaunaActivityBudget,
  faunaActivityBudgetDigest,
  replayFaunaActivityBudget,
  validateFaunaActivityBudgetResult,
} from '../src/3d/gameplay/livingWorldFaunaActivityBudget.js';

const species = ['deer', 'wolf', 'boar', 'horse', 'fox', 'eagle', 'rabbit', 'dragon'];
const lods = FAUNA_ACTIVITY_LODS;
const kinds = FAUNA_ACTIVITY_KINDS;
const threatLevels = [0, 0.12, 0.24, 0.38, 0.52, 0.68, 0.84, 1];
const resourceLevels = [0, 0.12, 0.24, 0.38, 0.52, 0.68, 0.84, 1];

function candidate(id, overrides = {}) {
  return {
    id,
    species: 'deer',
    kind: 'movement',
    lod: 'distant',
    tick: 12,
    currentTick: 12,
    lastSelectedTick: 8,
    recentWorkTicks: 4,
    threat: 0.18,
    resourceNeed: 0.22,
    reproductionPressure: 0.1,
    socialPressure: 0.2,
    movementPressure: 0.3,
    migrationPressure: 0.05,
    health: 1,
    energy: 0.8,
    active: true,
    eligible: true,
    ...overrides,
  };
}

assert.equal(FAUNA_ACTIVITY_BUDGET_POLICY.deterministic, true);
assert.equal(new Set(species).size, 8);
assert.equal(lods.length, 4);
assert.equal(kinds.length, 8);

const baseCandidates = Array.from({ length: 32 }, (_, index) => candidate(`runtime-${index}`, {
  species: species[index % species.length],
  kind: kinds[index % kinds.length],
  lod: lods[index % lods.length],
  threat: threatLevels[index % threatLevels.length],
  resourceNeed: resourceLevels[(index * 3) % resourceLevels.length],
  reproductionPressure: resourceLevels[(index * 5) % resourceLevels.length],
  starvationTicks: index,
}));

const context = { tick: 42, seed: 'fauna-r1-replay', budget: 32, maxSelected: 32, globalThreat: 0.2, weatherStress: 0.35 };
const first = evaluateFaunaActivityBudget(baseCandidates, context);
const second = evaluateFaunaActivityBudget(baseCandidates, context);
assert.deepEqual(second, first, 'same input must produce identical result');
assert.equal(faunaActivityBudgetDigest(second), faunaActivityBudgetDigest(first));
assert.equal(validateFaunaActivityBudgetResult(first).valid, true);
assert.ok(first.selected.length <= context.maxSelected);
assert.ok(first.selected.length <= first.budget);

const reordered = [...baseCandidates].reverse();
const reorderedResult = evaluateFaunaActivityBudget(reordered, context);
assert.equal(faunaActivityBudgetDigest(reorderedResult), faunaActivityBudgetDigest(first), 'ranking must be input-order invariant');

const malformed = evaluateFaunaActivityBudget([
  candidate('bad-input', { threat: 'wat', resourceNeed: Infinity, active: true }),
  null,
  candidate('inactive', { active: false }),
  candidate('ineligible', { eligible: false }),
], { tick: -4, budget: 99999, seed: null });
assert.equal(validateFaunaActivityBudgetResult(malformed).valid, true);
assert.equal(malformed.tick, 0);
assert.equal(malformed.budget, FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget);
assert.ok(malformed.selected.every((entry) => typeof entry.id === 'string'));

const threatFirst = evaluateFaunaActivityBudget([
  candidate('quiet', { threat: 0.02, kind: 'ambient' }),
  candidate('threat', { threat: 1, kind: 'threat' }),
], { tick: 5, seed: 'threat-priority', budget: 4 });
assert.equal(threatFirst.selected[0].id, 'threat');

const resourceFirst = evaluateFaunaActivityBudget([
  candidate('movement', { movementPressure: 0.9, kind: 'movement', resourceNeed: 0.1 }),
  candidate('resource', { resourceNeed: 1, kind: 'resource', movementPressure: 0.1 }),
], { tick: 5, seed: 'resource-priority', budget: 4 });
assert.equal(resourceFirst.selected[0].id, 'resource');

const ledger = createFaunaActivityBudgetLedger({ maxHistory: 2 });
ledger.evaluate(baseCandidates, { ...context, tick: 1 });
ledger.evaluate(baseCandidates, { ...context, tick: 2 });
ledger.evaluate(baseCandidates, { ...context, tick: 3 });
assert.equal(ledger.snapshot().history.length, 2);
ledger.reset();
assert.equal(ledger.snapshot().history.length, 0);
ledger.dispose();
assert.equal(ledger.evaluate(baseCandidates, context).disposed, true);

const replay = replayFaunaActivityBudget(baseCandidates, [
  { ...context, tick: 7 },
  { ...context, tick: 8 },
  { ...context, tick: 9 },
]);
assert.equal(replay.length, 3);
assert.notEqual(faunaActivityBudgetDigest(replay[0]), faunaActivityBudgetDigest(replay[1]));

let corpusCount = 0;
const corpusSamples = [];
for (const specimen of species) {
  for (const lod of lods) {
    for (const kind of kinds) {
      for (const threat of threatLevels) {
        const c = candidate(`${specimen}-${lod}-${kind}-${threat}`, {
          species: specimen,
          lod,
          kind,
          threat,
          resourceNeed: resourceLevels[(corpusCount + 1) % resourceLevels.length],
          reproductionPressure: resourceLevels[(corpusCount + 2) % resourceLevels.length],
          movementPressure: resourceLevels[(corpusCount + 3) % resourceLevels.length],
        });
        const result = evaluateFaunaActivityBudget([c], { tick: corpusCount, seed: 'corpus', budget: 4 });
        assert.equal(validateFaunaActivityBudgetResult(result).valid, true);
        corpusCount += 1;
        if (corpusSamples.length < 12) corpusSamples.push({ specimen, lod, kind, threat, digest: faunaActivityBudgetDigest(result) });
      }
    }
  }
}
assert.equal(corpusCount, 2048);
assert.equal(corpusSamples.length, 12);

const allAxes = [];
for (const specimen of species) {
  for (const lod of lods) {
    for (const threat of threatLevels) {
      for (const resource of resourceLevels) {
        const result = evaluateFaunaActivityBudget([
          candidate(`${specimen}-${lod}-${threat}-${resource}`, {
            species: specimen,
            lod,
            threat,
            resourceNeed: resource,
            kind: resource > 0.7 ? 'resource' : 'movement',
          }),
        ], { tick: allAxes.length, seed: 'all-axes', budget: 4 });
        assert.equal(validateFaunaActivityBudgetResult(result).valid, true);
        allAxes.push(faunaActivityBudgetDigest(result));
      }
    }
  }
}
assert.equal(allAxes.length, 2048);
assert.equal(new Set(allAxes).size, allAxes.length, 'computed corpus digests must remain unique');

const matrixRoot = path.resolve(new URL('.', import.meta.url).pathname, '..', '..', 'artifacts', 'safak-kartali-fauna-activity-budget-r1');
const matrixFiles = fs.readdirSync(matrixRoot).filter((name) => /^part-\d+\.matrix$/.test(name)).sort();
assert.equal(matrixFiles.length, 9, 'all nine matrix partitions must exist');
const matrixIds = [];
for (const fileName of matrixFiles) {
  const lines = fs.readFileSync(path.join(matrixRoot, fileName), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 256, `${fileName} must contain acceptance cases`);
  for (const line of lines) {
    const match = /^FAUNA_BUDGET_(?:R1\|(?:[0-9]{4})\|.*|CASE\|([0-9]{4}))$/.exec(line);
    assert.ok(match, `${fileName} contains malformed corpus row: ${line}`);
    const id = Number(line.split('|')[1]);
    assert.ok(Number.isInteger(id) && id >= 0 && id < 4096, `matrix id ${id} must be bounded`);
    matrixIds.push(id);
  }
}
assert.equal(matrixIds.length, 4096);
assert.equal(new Set(matrixIds).size, 4096, 'matrix ids must be unique');
assert.deepEqual([...new Set(matrixIds)].sort((a, b) => a - b), Array.from({ length: 4096 }, (_, index) => index));

console.log(JSON.stringify({
  pass: true,
  policy: FAUNA_ACTIVITY_BUDGET_POLICY.id,
  corpus: matrixIds.length,
  deterministicDigest: faunaActivityBudgetDigest(first),
  selected: first.selected.length,
  deferred: first.deferred.length,
  matrixFiles,
  samples: corpusSamples,
}));
