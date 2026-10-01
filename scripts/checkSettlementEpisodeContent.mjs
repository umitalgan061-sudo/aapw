import { strict as assert } from 'node:assert';
import {
  listSettlementEpisodes,
  getSettlementEpisode,
  getSettlementEpisodeBeat,
  buildSettlementEpisodeManifest,
  validateSettlementEpisodeContent,
  createSettlementEpisodeContentResolver,
} from '../src/3d/gameplay/settlementEpisodeContent.js';
import { getSettlementQuestChain, getSettlementQuestChainStep, getSettlementQuestChainReward } from '../src/3d/gameplay/settlementCampaignQuestChains.js';
import { getSettlementService, getSettlementQuestObjective, getSettlementDialogueCondition, getSettlementRecipe, getSettlementRoute, getSettlementItem } from '../src/3d/gameplay/settlementCampaignContent.js';

let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks+=1;}; const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;}; const deep=(a,b,m)=>{assert.deepEqual(a,b,m);checks+=1;};
const EXPECTED={
  iron_and_oath:{service:'blacksmith',actions:['talk','talk','collect','collect','craft','equip','rest','talk'],steps:['iron-01','iron-02','iron-03','iron-04','iron-05','iron-06','iron-07','iron-08']},
  market_routes:{service:'market',actions:['talk','buy','sell','trade','talk','travel','sell','talk'],steps:['market-01','market-02','market-03','market-04','market-05','market-06','market-07','market-08']},
  road_watch:{service:'barracks',actions:['talk','train','equip','talk','travel','travel','talk','travel'],steps:['watch-01','watch-02','watch-03','watch-04','watch-05','watch-06','watch-07','watch-08']},
  hearth_and_home:{service:'house',actions:['rest','save','interact','talk','rest','save','interact','talk'],steps:['home-01','home-02','home-03','home-04','home-05','home-06','home-07','home-08']},
  winter_supply:{service:'farm',actions:['talk','collect','collect','craft','trade','rest','travel','talk'],steps:['winter-01','winter-02','winter-03','winter-04','winter-05','winter-06','winter-07','winter-08']},
  stable_master:{service:'stable',actions:['talk','trade','rest','talk','travel','travel','talk','travel'],steps:['stable-01','stable-02','stable-03','stable-04','stable-05','stable-06','stable-07','stable-08']},
};
const validation=validateSettlementEpisodeContent(); ok(validation.ok,'content-validator-green'); eq(validation.errors.length,0,'content-error-count'); ok(Array.isArray(validation.warnings),'content-warnings-array');
const resolver=createSettlementEpisodeContentResolver(); ok(resolver.valid,'resolver-valid'); eq(resolver.version,1,'resolver-version');
const manifest=buildSettlementEpisodeManifest(); eq(manifest.episodes.length,6,'manifest-six-episodes'); eq(manifest.version,1,'manifest-version'); eq(manifest.contract,'shared-material-placement-v1','manifest-contract'); ok(Object.isFrozen(manifest),'manifest-frozen');
for(const [episodeId,expected] of Object.entries(EXPECTED)){
  const episode=getSettlementEpisode(episodeId); ok(episode,`episode-present:${episodeId}`); eq(episode.service,expected.service,`service:${episodeId}`); eq(episode.beats.length,8,`beat-count:${episodeId}`);
  eq(episode.beats.map((b)=>b.stepId).join('|'),expected.steps.join('|'),`step-order:${episodeId}`); eq(episode.beats.map((b)=>b.action).join('|'),expected.actions.join('|'),`action-order:${episodeId}`); ok(episode.entry.placementContract==='shared-material-placement-v1',`placement-contract:${episodeId}`);
  const chain=getSettlementQuestChain(episodeId); const reward=getSettlementQuestChainReward(episodeId); ok(chain,`chain:${episodeId}`); ok(reward,`reward:${episodeId}`); eq(chain.steps.length,8,`chain-step-count:${episodeId}`);
  for(const beat of episode.beats){ const step=getSettlementQuestChainStep(episodeId,beat.stepId); ok(step,`step:${beat.stepId}`); eq(step.action,beat.action,`action-parity:${beat.stepId}`); ok(getSettlementQuestObjective(step.objective),`objective:${beat.stepId}`); for(const condition of step.conditions??[]) ok(getSettlementDialogueCondition(condition),`condition:${beat.stepId}:${condition}`); if(step.recipe) ok(getSettlementRecipe(step.recipe),`recipe:${beat.stepId}`); if(step.route) ok(getSettlementRoute(step.route),`route:${beat.stepId}`); if(step.target) ok(!/^item_|^recipe_|^route_/.test(step.target)||Boolean(getSettlementItem(step.target)),`target:${beat.stepId}`); }
}
const actionCoverage=new Set(); const serviceCoverage=new Set(); for(const episodeId of listSettlementEpisodes()){ const episode=getSettlementEpisode(episodeId); serviceCoverage.add(episode.service); for(const beat of episode.beats) actionCoverage.add(beat.action); }
for(const action of ['talk','collect','buy','sell','trade','craft','equip','rest','train','travel','save','interact']) ok(actionCoverage.has(action),`action-covered:${action}`);
for(const service of ['blacksmith','market','barracks','house','farm','stable']) ok(serviceCoverage.has(service),`service-covered:${service}`);
const objectiveIds=[]; const conditionIds=[]; for(const episodeId of listSettlementEpisodes()){ for(const step of getSettlementQuestChain(episodeId).steps){ objectiveIds.push(step.objective); conditionIds.push(...(step.conditions??[])); }}
eq(new Set(objectiveIds).size,objectiveIds.length,'objective-refs-distinct'); eq(new Set(conditionIds).size,conditionIds.length,'condition-refs-distinct');
eq(new Set(listSettlementEpisodes().flatMap((id)=>getSettlementEpisode(id).beats.map((b)=>b.title))).size,48,'unique-titles');
const snapshots=listSettlementEpisodes().map((id)=>({id,service:getSettlementEpisode(id).service,beats:getSettlementEpisode(id).beats.map((b)=>({stepId:b.stepId,action:b.action,prompt:b.prompt}))})); deep(snapshots,listSettlementEpisodes().map((id)=>({id,service:getSettlementEpisode(id).service,beats:getSettlementEpisode(id).beats.map((b)=>({stepId:b.stepId,action:b.action,prompt:b.prompt}))})),'repeatable');
const malformed=resolver.resolve('unknown','unknown-step'); eq(malformed.ok,false,'unknown-blocked'); eq(malformed.reason,'unknown-beat','unknown-reason'); const known=resolver.getBeat('market_routes','market-06'); eq(known.action,'travel','known-action'); eq(known.service,'gate','travel-gate');
eq(new Set(listSettlementEpisodes().map((id)=>getSettlementQuestChainReward(id).perk)).size,6,'unique-rewards');
console.log(`SETTLEMENT_EPISODE_CONTENT_OK checks=${checks} episodes=${listSettlementEpisodes().length} beats=48`);
