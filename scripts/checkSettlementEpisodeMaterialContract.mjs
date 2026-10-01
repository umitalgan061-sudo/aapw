import { strict as assert } from 'node:assert';
import { buildSettlementEpisodeManifest } from '../src/3d/gameplay/settlementEpisodeContent.js';
import { buildSettlementEpisodeRuntimeSnapshot } from '../src/3d/gameplay/settlementEpisodeRuntimeSnapshot.js';
import { buildSettlementEpisodeJourneyCard } from '../src/3d/gameplay/settlementEpisodeJourney.js';
import { getSettlementEpisodeHandoffCase } from '../src/3d/gameplay/settlementEpisodeHandoffContract.js';

const EXPECTED_CONTRACT='shared-material-placement-v1';
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks+=1;};
const eq=(actual,expected,message)=>{assert.equal(actual,expected,message);checks+=1;};

const manifest=buildSettlementEpisodeManifest();
eq(manifest.contract,EXPECTED_CONTRACT,'episode-manifest-contract');
ok(Object.isFrozen(manifest),'manifest-frozen');
eq(manifest.episodes.length,6,'contract-episode-count');

for(const episode of manifest.episodes){
  eq(episode.entry.placementContract,EXPECTED_CONTRACT,`placement-contract:${episode.id}`);
  ok(episode.entry.requires.includes('settlement-present'),`settlement-required:${episode.id}`);
  ok(episode.entry.requires.includes('runtime-ready'),`runtime-required:${episode.id}`);
  eq(episode.completion.rewardSource,'settlementCampaignQuestChains',`reward-owner:${episode.id}`);
  eq(episode.beats.length,8,`beat-count:${episode.id}`);
  for(const beat of episode.beats){
    const handoff=getSettlementEpisodeHandoffCase(beat.stepId);
    ok(handoff,`handoff:${beat.stepId}`);
    eq(handoff.episodeId,episode.id,`handoff-episode:${beat.stepId}`);
    eq(handoff.service,beat.service,`handoff-service:${beat.stepId}`);
  }
  const journey=buildSettlementEpisodeJourneyCard(episode.id);
  ok(journey.ok,`journey:${episode.id}`);
  eq(journey.stages[0].node,episode.service,`entry-node:${episode.id}`);
  eq(journey.stages[4].interaction,'episode-complete',`exit-event:${episode.id}`);
}

function runtime(){
  let state={activeService:'blacksmith',panel:'quests',route:[],history:[],feedback:null,lastAction:null};
  return {
    open(service,panel){state={...state,activeService:service,panel};return{ok:true,view:{...state}};},
    view(){return{...state};},
    exportState(){return{version:1,runtimeVersion:1,contentVersion:2,...state,requestIds:[]};},
    importState(next){state={...state,...next};return{ok:true};},
    async execute(action,input){state={...state,lastAction:{action,episodeId:input.episodeId,episodeStepId:input.episodeStepId,nodeId:input.nodeId},history:[...state.history,{type:'action',action}]};return{ok:true,action,nodeId:input.nodeId,view:{...state}};},
  };
}

for(const episodeId of ['iron_and_oath','market_routes','road_watch','hearth_and_home','winter_supply','stable_master']){
  const rt=runtime();
  const snapshot={episodeId,stepId:null,phase:'idle'};
  const combined=buildSettlementEpisodeRuntimeSnapshot({
    directorSnapshot:{episodeId,stepId:null,phase:'idle',revision:0,beat:null,runtimeOk:true,runtime:rt.view()},
    runtimeView:rt.view(),
    runtimeExportState:rt.exportState(),
    questSnapshot:{quests:{}},
  });
  eq(combined.ownership.worldPlacementContract,EXPECTED_CONTRACT,`snapshot-contract:${episodeId}`);
  eq(combined.ownership.threeDAssetAdded,false,`asset-flag:${episodeId}`);
  eq(combined.ownership.runtimeOwner,'settlementCampaignRuntime',`runtime-owner:${episodeId}`);
  eq(combined.ownership.questOwner,'settlementCampaignQuestChains',`quest-owner:${episodeId}`);
  eq(combined.checkpoint.available,true,`checkpoint-available:${episodeId}`);
  ok(combined.digest,'snapshot-digest:'+episodeId);
}

const invalid={...manifest,contract:'legacy-material-contract'};
eq(invalid.contract, 'legacy-material-contract','mutation-local-only');
eq(manifest.contract,EXPECTED_CONTRACT,'source-manifest-untouched');
const unknown=getSettlementEpisodeHandoffCase('missing-step');
eq(unknown,null,'unknown-step-safe');
const known=getSettlementEpisodeHandoffCase('market-06');
eq(known.runtimeAction,'travel','known-runtime-action');
eq(known.inputKey,'routeId','known-route-input');
console.log(`SETTLEMENT_EPISODE_MATERIAL_CONTRACT_OK checks=${checks} contract=${EXPECTED_CONTRACT}`);
