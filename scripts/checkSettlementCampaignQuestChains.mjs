import { strict as assert } from 'node:assert';
import { listSettlementQuestChains, getSettlementQuestChain, getSettlementQuestChainStep, getSettlementQuestChainReward, buildSettlementQuestChainManifest, validateSettlementQuestChains, buildSettlementQuestChainProgress, summarizeQuestChain } from '../src/3d/gameplay/settlementCampaignQuestChains.js';
import { createSettlementCampaignRuntime } from '../src/3d/gameplay/settlementCampaignRuntime.js';

let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks+=1;};const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;};
const validation=validateSettlementQuestChains();ok(validation.ok,'quest-chain-content-valid');const ids=listSettlementQuestChains();eq(ids.length,6,'quest-chain-count');
for(const id of ids){
  const chain=getSettlementQuestChain(id);
  ok(chain.id===id,`chain-id:${id}`);
  ok(chain.title.length>0,`chain-title:${id}`);
  ok(chain.service.length>0,`chain-service:${id}`);
  eq(chain.steps.length,8,`chain-steps:${id}`);
  ok(chain.reward.xp>0,`chain-reward:${id}`);
  ok(chain.reward.copper>=0,`chain-copper:${id}`);
  ok(chain.reward.perk.length>0,`chain-perk:${id}`);
  for(const step of chain.steps){
    ok(getSettlementQuestChainStep(id,step.id)?.chainId===id,`step:${step.id}`);
    ok(step.objective.length>0,`step-objective:${step.id}`);
    ok(step.action.length>0,`step-action:${step.id}`);
    ok(step.conditions.length>0,`step-conditions:${step.id}`);
    ok(step.rewardXp>0,`step-xp:${step.id}`);
  }
  const reward=getSettlementQuestChainReward(id);eq(reward.chainId,id,`reward-id:${id}`);ok(reward.xp>0,`reward-xp:${id}`);
  const summary=summarizeQuestChain(id);eq(summary.steps,8,`summary-steps:${id}`);ok(summary.totalXp>summary.reward.xp,`summary-total-xp:${id}`);
}
const runtime=createSettlementCampaignRuntime({initialState:{settlementId:'north-settlement',locationId:'north-settlement',inventory:{iron_ore:10,coal:5},skills:{smithing:5},perks:[]},handlers:{}});
const manifest=buildSettlementQuestChainManifest();eq(manifest.chains.length,6,'manifest-chains');ok(manifest.limits.stepsPerChain===8,'manifest-step-limit');
for(const id of ids){const chain=getSettlementQuestChain(id);const completed=chain.steps.slice(0,2).map(step=>step.id);const progress=buildSettlementQuestChainProgress(id,runtime.getViewModel().player,completed);ok(progress.ok,`progress:${id}`);eq(progress.completedCount,2,`progress-count:${id}`);eq(progress.activeIndex,2,`progress-active:${id}`);ok(progress.steps[2].state==='active',`progress-active-state:${id}`);ok(progress.steps[0].state==='complete',`progress-complete-state:${id}`);}
const full=buildSettlementQuestChainProgress(ids[0],runtime.getViewModel().player,getSettlementQuestChain(ids[0]).steps.map(step=>step.id));ok(full.complete,'full-chain-complete');eq(full.activeIndex,8,'full-chain-index');
console.log(`SETTLEMENT_CAMPAIGN_QUEST_CHAINS_OK checks=${checks} chains=${ids.length}`);
