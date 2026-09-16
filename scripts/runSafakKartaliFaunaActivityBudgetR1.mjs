import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FAUNA_ACTIVITY_BUDGET_POLICY,
  evaluateFaunaActivityBudget,
  faunaActivityBudgetDigest,
  validateFaunaActivityBudgetResult,
} from '../src/3d/gameplay/livingWorldFaunaActivityBudget.js';

const root = process.cwd();
const matrixRoot = path.join(root, 'artifacts', 'safak-kartali-fauna-activity-budget-r1');
const files = fs.readdirSync(matrixRoot).filter((name) => /^part-\d+\.matrix$/.test(name)).sort();
assert.equal(files.length, 9);

const ids = [];
for (const file of files) {
  const rows = fs.readFileSync(path.join(matrixRoot, file), 'utf8').trim().split(/\r?\n/);
  assert.ok(rows.length >= 256, file);
  for (const row of rows) {
    const parts = row.split('|');
    assert.ok(parts[0] === 'FAUNA_BUDGET_R1' || parts[0] === 'FAUNA_BUDGET_CASE');
    const id = Number(parts[1]);
    assert.ok(Number.isInteger(id) && id >= 0 && id < 4096);
    ids.push(id);
  }
}
assert.equal(ids.length, 4096);
assert.equal(new Set(ids).size, 4096);
assert.deepEqual([...new Set(ids)].sort((a, b) => a - b), Array.from({ length: 4096 }, (_, i) => i));

const base = { id: 'acceptance-fauna', species: 'deer', lod: 'near', kind: 'threat', currentTick: 30, lastSelectedTick: 20, threat: 0.84, resourceNeed: 0.12, movementPressure: 0.18, health: 1, energy: 0.9, active: true, eligible: true };
const a = evaluateFaunaActivityBudget([base], { tick: 30, seed: 'acceptance', budget: 8 });
const b = evaluateFaunaActivityBudget([{ ...base }], { tick: 30, seed: 'acceptance', budget: 8 });
assert.deepEqual(a, b);
assert.equal(faunaActivityBudgetDigest(a), faunaActivityBudgetDigest(b));
assert.equal(validateFaunaActivityBudgetResult(a).valid, true);
assert.equal(a.selected[0].reason, 'threat');
assert.ok(a.selected.length <= a.budget);
assert.ok(a.budget >= FAUNA_ACTIVITY_BUDGET_POLICY.minBudget && a.budget <= FAUNA_ACTIVITY_BUDGET_POLICY.maxBudget);

console.log(JSON.stringify({ pass: true, corpus: ids.length, files, digest: faunaActivityBudgetDigest(a) }));
