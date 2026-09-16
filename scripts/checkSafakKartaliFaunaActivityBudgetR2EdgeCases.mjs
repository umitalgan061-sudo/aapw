import assert from 'node:assert/strict';
import { evaluateFaunaActivityBudget, normalizeFaunaActivityCandidate, normalizeFaunaActivityContext, scoreFaunaActivityCandidate, stableHash, validateFaunaActivityBudget } from '../src/3d/gameplay/livingWorldFaunaActivityBudget.js';

const base={id:'edge',species:'deer',kind:'movement',lod:'distant',currentTick:10,lastSelectedTick:4,threat:.3,resourceNeed:.2,reproductionPressure:.2,socialPressure:.2,movementPressure:.2,migrationPressure:.2,health:1,energy:1};
const cases=[
  ['nan-threat',{threat:NaN}],['inf-threat',{threat:Infinity}],['negative-threat',{threat:-1}],['over-threat',{threat:2}],
  ['nan-energy',{energy:NaN}],['zero-energy',{energy:0}],['negative-energy',{energy:-1}],['over-energy',{energy:2}],
  ['unknown-kind',{kind:'mystery'}],['unknown-lod',{lod:'mystery'}],['missing-id',{id:''}],['null-id',{id:null}],
  ['inactive',{active:false}],['ineligible',{eligible:false}],['occluded',{occluded:true,lod:'far'}],['near-occluded',{occluded:true,lod:'near'}],
  ['stale',{currentTick:100,lastSelectedTick:0,recentWorkTicks:99}],['fresh',{currentTick:10,lastSelectedTick:9,recentWorkTicks:0}],
  ['priority',{priority:1}],['low-priority',{priority:0}],['resource',{kind:'resource',resourceNeed:1}],['reproduction',{kind:'reproduction',reproductionPressure:1}],
  ['social',{kind:'social',socialPressure:1}],['migration',{kind:'migration',migrationPressure:1}],['rest',{kind:'rest',energy:.2}],['ambient',{kind:'ambient'}],
  ['threat',{kind:'threat',threat:1}],['culled',{lod:'culled'}],['far',{lod:'far'}],['distant',{lod:'distant'}],['near',{lod:'near'}],['bad-tick',{currentTick:-5}],
  ['bad-last',{lastSelectedTick:-5}],['bad-distance',{distanceMeters:-5}],['bad-fairness',{fairnessEpoch:-8}],['bad-health',{health:-2}],['bad-health-high',{health:3}],
  ['bad-resource',{resourceNeed:-2}],['bad-reproduction',{reproductionPressure:3}],['bad-social',{socialPressure:3}],['bad-movement',{movementPressure:3}],['bad-migration',{migrationPressure:3}],
  ['weather-resource',{kind:'resource',resourceNeed:.8}],['weather-rest',{kind:'rest',resourceNeed:.1}],['settlement-ambient',{kind:'ambient'}],['settlement-threat',{kind:'threat'}],
];
for(const [name,overrides] of cases){
  const normalized=normalizeFaunaActivityCandidate({...base,...overrides},0);
  assert.equal(typeof normalized.id,'string',name);
  assert.ok(normalized.threat>=0&&normalized.threat<=1,name);
  assert.ok(normalized.health>=0&&normalized.health<=1,name);
  assert.ok(normalized.energy>=0&&normalized.energy<=1,name);
  const context=normalizeFaunaActivityContext({tick:-1,budget:99999,maxSelected:99999,candidateCap:99999,globalThreat:2,weatherStress:-1,settlementPressure:2});
  assert.equal(context.tick,0,name); assert.equal(context.budget,96,name); assert.equal(context.maxSelected,96,name); assert.equal(context.candidateCap,256,name);
  const score=scoreFaunaActivityCandidate(normalized,context); assert.ok(Number.isFinite(score)&&score>=0,name);
  const result=evaluateFaunaActivityBudget([{...base,...overrides}],{tick:10,seed:`edge-${name}`,budget:4});
  assert.equal(validateFaunaActivityBudget(result).valid,true,name);
  assert.equal(stableHash(name),stableHash(name),name);
}

const duplicate=evaluateFaunaActivityBudget([{...base,id:'same'},{...base,id:'same'}],{tick:10,seed:'duplicate',budget:4});
assert.equal(new Set(duplicate.selected.map((x)=>x.id)).size,duplicate.selected.length);
const huge=evaluateFaunaActivityBudget(Array.from({length:512},(_,i)=>({...base,id:`huge-${i}`,kind:i%2?'ambient':'movement'})),{tick:10,seed:'huge',budget:1000,candidateCap:1000,maxSelected:1000});
assert.ok(huge.summary.eligibleCount<=256); assert.ok(huge.selected.length<=96); assert.ok(huge.deferred.length>=0);
const noInput=evaluateFaunaActivityBudget(null,{tick:3,budget:4}); assert.equal(noInput.summary.inputCount,0); assert.equal(validateFaunaActivityBudget(noInput).valid,true);
console.log(JSON.stringify({pass:true,edgeCases:cases.length,hugeSelected:huge.selected.length,hugeEligible:huge.summary.eligibleCount}));
