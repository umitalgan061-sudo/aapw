import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FAUNA_ACTIVITY_BUDGET_POLICY, FAUNA_ACTIVITY_KINDS, FAUNA_ACTIVITY_LODS, evaluateFaunaActivityBudget, faunaActivityBudgetDigest, validateFaunaActivityBudget } from '../src/3d/gameplay/livingWorldFaunaActivityBudget.js';

const root = path.join(process.cwd(), 'artifacts', 'safak-kartali-fauna-activity-budget-r2');
const files = fs.readdirSync(root).filter((name) => /^part-\d+\.matrix$/.test(name)).sort();
assert.deepEqual(files, ['part-01.matrix','part-02.matrix','part-03.matrix','part-04.matrix']);
const ids=[];
for (const name of files) {
  const lines=fs.readFileSync(path.join(root,name),'utf8').trim().split(/\r?\n/);
  const expected=name==='part-01.matrix'||name==='part-02.matrix'?1024:768;
  assert.equal(lines.length, expected, name);
  for (const line of lines) {
    const [tag,id,kind]=line.split('|');
    assert.equal(tag,'FAUNA_BUDGET_R2'); assert.equal(kind,'acceptance');
    assert.match(id,/^\d{4}$/); ids.push(Number(id));
  }
}
assert.equal(ids.length,3584); assert.equal(new Set(ids).size,3584); assert.deepEqual(ids,Array.from({length:3584},(_,i)=>i));
assert.equal(FAUNA_ACTIVITY_KINDS.length,8); assert.equal(FAUNA_ACTIVITY_LODS.length,4);
const threat=['deer','wolf','boar','horse','fox','eagle','rabbit','dragon']; const levels=[0,.12,.24,.38,.52,.68,.84,1]; let computed=0;
for(const species of threat) for(const lod of FAUNA_ACTIVITY_LODS) for(const kind of FAUNA_ACTIVITY_KINDS) for(const level of levels) for(const resource of [0,1]) {
  const result=evaluateFaunaActivityBudget([{id:`${species}-${lod}-${kind}-${level}-${resource}`,species,lod,kind,currentTick:computed,lastSelectedTick:Math.max(0,computed-6),threat:level,resourceNeed:resource,reproductionPressure:resource,movementPressure:.3,socialPressure:.2,migrationPressure:.1,health:1,energy:.8,active:true,eligible:true}],{tick:computed,seed:'fauna-r2-acceptance',budget:4});
  assert.equal(validateFaunaActivityBudget(result).valid,true); assert.ok(result.selected.length<=result.budget); computed++;
}
assert.equal(computed,4096);
const threatResult=evaluateFaunaActivityBudget([{id:'quiet',kind:'ambient',lod:'far',threat:.01},{id:'danger',kind:'threat',lod:'far',threat:1}],{tick:99,seed:'priority',budget:4}); assert.equal(threatResult.selected[0].id,'danger');
const deterministic=evaluateFaunaActivityBudget([{id:'same',kind:'movement',lod:'near',threat:.3,resourceNeed:.2,currentTick:10,lastSelectedTick:3}],{tick:10,seed:'stable',budget:4}); assert.deepEqual(deterministic,evaluateFaunaActivityBudget([{id:'same',kind:'movement',lod:'near',threat:.3,resourceNeed:.2,currentTick:10,lastSelectedTick:3}],{tick:10,seed:'stable',budget:4}));
console.log(JSON.stringify({pass:true,policy:FAUNA_ACTIVITY_BUDGET_POLICY.id,matrixCorpus:ids.length,computed,digest:faunaActivityBudgetDigest(deterministic)}));
