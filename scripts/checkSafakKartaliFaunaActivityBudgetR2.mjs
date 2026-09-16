import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FAUNA_ACTIVITY_BUDGET_POLICY, FAUNA_ACTIVITY_KINDS, FAUNA_ACTIVITY_LODS, createFaunaActivityBudgetLedger, evaluateFaunaActivityBudget, faunaActivityBudgetDigest, replayFaunaActivityBudget, validateFaunaActivityBudget } from '../src/3d/gameplay/livingWorldFaunaActivityBudget.js';

const species = ['deer','wolf','boar','horse','fox','eagle','rabbit','dragon'];
const threatLevels = [0,0.12,0.24,0.38,0.52,0.68,0.84,1];
const resourceLevels = [0,1];
const make = (id, overrides = {}) => ({ id, species:'deer', kind:'movement', lod:'distant', currentTick:20, lastSelectedTick:14, threat:0.18, resourceNeed:0.22, reproductionPressure:0.1, socialPressure:0.2, movementPressure:0.3, migrationPressure:0.05, health:1, energy:0.8, active:true, eligible:true, ...overrides });

assert.equal(FAUNA_ACTIVITY_BUDGET_POLICY.deterministic,true);
assert.equal(FAUNA_ACTIVITY_LODS.length,4);
assert.equal(FAUNA_ACTIVITY_KINDS.length,8);
const runtime = Array.from({length:32},(_,i)=>make(`runtime-${i}`, { species:species[i%8], kind:FAUNA_ACTIVITY_KINDS[i%8], lod:FAUNA_ACTIVITY_LODS[i%4], threat:threatLevels[i%8], resourceNeed:threatLevels[(i*3)%8] }));
const context = { tick:42, seed:'fauna-r2', budget:32, maxSelected:32, globalThreat:0.2, weatherStress:0.35 };
const first = evaluateFaunaActivityBudget(runtime,context);
assert.deepEqual(evaluateFaunaActivityBudget(runtime,context),first);
assert.equal(faunaActivityBudgetDigest(first),faunaActivityBudgetDigest(evaluateFaunaActivityBudget([...runtime].reverse(),context)));
assert.equal(validateFaunaActivityBudget(first).valid,true);
assert.ok(first.selected.length <= first.budget);
assert.ok(first.budget >= 4 && first.budget <= 96);
assert.equal(evaluateFaunaActivityBudget([make('threat',{kind:'threat',threat:1}),make('quiet',{kind:'ambient',threat:0})],{tick:5,budget:4}).selected[0].id,'threat');
assert.equal(evaluateFaunaActivityBudget([make('resource',{kind:'resource',resourceNeed:1}),make('movement',{kind:'movement',resourceNeed:0,movementPressure:0.9})],{tick:5,budget:4}).selected[0].id,'resource');
const ledger=createFaunaActivityBudgetLedger({maxHistory:2});
ledger.evaluate(runtime,{...context,tick:1}); ledger.evaluate(runtime,{...context,tick:2}); ledger.evaluate(runtime,{...context,tick:3});
assert.equal(ledger.snapshot().history.length,2); ledger.reset(); assert.equal(ledger.snapshot().history.length,0); ledger.dispose(); assert.equal(ledger.evaluate(runtime,context).disposed,true);
const replay=replayFaunaActivityBudget(runtime,[{...context,tick:7},{...context,tick:8},{...context,tick:9}]);
assert.equal(replay.length,3); assert.notEqual(faunaActivityBudgetDigest(replay[0]),faunaActivityBudgetDigest(replay[1]));

let computed=0;
for (const specimen of species) for (const lod of FAUNA_ACTIVITY_LODS) for (const kind of FAUNA_ACTIVITY_KINDS) for (const threat of threatLevels) for (const resource of resourceLevels) {
  const result=evaluateFaunaActivityBudget([make(`${specimen}-${lod}-${kind}-${threat}-${resource}`,{species:specimen,lod,kind,threat,resourceNeed:resource})],{tick:computed,seed:'matrix',budget:4});
  assert.equal(validateFaunaActivityBudget(result).valid,true);
  computed += 1;
}
assert.equal(computed,4096);

const matrixRoot=path.join(process.cwd(),'artifacts','safak-kartali-fauna-activity-budget-r2');
const files=fs.readdirSync(matrixRoot).filter((name)=>/^part-\d+\.matrix$/.test(name)).sort();
assert.equal(files.length,8);
const ids=[];
for(const name of files){ const lines=fs.readFileSync(path.join(matrixRoot,name),'utf8').trim().split(/\r?\n/); assert.equal(lines.length,512,name); for(const line of lines){ const parts=line.split('|'); assert.equal(parts[0],'FAUNA_BUDGET_R2'); const id=Number(parts[1]); assert.ok(Number.isInteger(id)&&id>=0&&id<4096); assert.equal(parts.length,10); ids.push(id); } }
assert.equal(ids.length,4096); assert.equal(new Set(ids).size,4096); assert.deepEqual([...new Set(ids)].sort((a,b)=>a-b),Array.from({length:4096},(_,i)=>i));
console.log(JSON.stringify({pass:true,policy:FAUNA_ACTIVITY_BUDGET_POLICY.id,computed,corpus:ids.length,digest:faunaActivityBudgetDigest(first),selected:first.selected.length,deferred:first.deferred.length,files}));
