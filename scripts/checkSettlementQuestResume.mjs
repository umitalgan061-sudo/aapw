import assert from 'node:assert/strict';
import { createSettlementQuestResume, isSettlementQuestResume } from '../src/3d/gameplay/settlementQuestResume.ts';
import { isSettlementQuestResumeContract } from '../src/3d/gameplay/settlementQuestResumePolicy.ts';

const base={settlementId:'canonical-settlement-001',chainId:'iron_and_oath',stepId:'iron-05',serviceId:'blacksmith',stage:'service',action:'craft',completedStepIds:['iron-01','iron-03','iron-02'],requiredConditionIds:['skill_09','item_03'],missingConditionIds:[],conditionsSatisfied:true,progressRevision:4};
const ready=createSettlementQuestResume(base);
assert.equal(ready.reason,'ready'); assert.equal(ready.ready,true); assert.equal(ready.completedCount,3); assert.equal(isSettlementQuestResume(ready),true); assert.equal(isSettlementQuestResumeContract(ready),true); assert.equal(Object.isFrozen(ready),true);
const reordered=createSettlementQuestResume({...base,completedStepIds:['iron-03','iron-02','iron-01'],requiredConditionIds:['item_03','skill_09']}); assert.equal(reordered.resumeKey,ready.resumeKey);
const blocked=createSettlementQuestResume({...base,missingConditionIds:['skill_09'],conditionsSatisfied:false}); assert.equal(blocked.reason,'condition-blocked'); assert.equal(isSettlementQuestResumeContract(blocked),true);
const complete=createSettlementQuestResume({...base,chainComplete:true,stepId:''}); assert.equal(complete.reason,'quest-complete'); assert.equal(complete.completed,true); assert.equal(isSettlementQuestResumeContract(complete),true);
const stageBlocked=createSettlementQuestResume({...base,stage:'approach'}); assert.equal(stageBlocked.reason,'stage-blocked');
const invalid=createSettlementQuestResume({...base,serviceId:'unknown-service',action:'teleport'}); assert.equal(invalid.reason,'invalid-input'); assert.equal(isSettlementQuestResumeContract(invalid),false);
assert.equal(isSettlementQuestResume({...ready,ready:false}),false);
assert.equal(isSettlementQuestResume({...ready,resumeKey:'ffffffff'}),false);
assert.equal(isSettlementQuestResume({...ready,completedStepIds:['iron-02','iron-01']}),false);
assert.equal(isSettlementQuestResume({...ready,completedCount:99}),false);
assert.equal(isSettlementQuestResume({...ready,progressRevision:1.5}),false);
assert.equal(isSettlementQuestResume(new Proxy(ready,{get(){throw new Error('poisoned accessor')}})),false);
console.log('settlement-quest-resume: 16 checks passed');
