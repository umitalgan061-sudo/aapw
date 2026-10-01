import { strict as assert } from 'node:assert';
import { createSettlementEpisodeDirector } from '../src/3d/gameplay/settlementEpisodeDirector.js';
import { buildSettlementEpisodePresentation } from '../src/3d/gameplay/settlementEpisodePresentationModel.js';
import { buildSettlementEpisodeDialogueView,resolveSettlementEpisodeDialogueSelection } from '../src/3d/gameplay/settlementEpisodeDialoguePresenter.js';
import { getSettlementEpisodeDialogueScene } from '../src/3d/gameplay/settlementEpisodeDialogueContent.js';
import { buildSettlementEpisodeCheckpoint,validateSettlementEpisodeCheckpoint } from '../src/3d/gameplay/settlementEpisodeCheckpoint.js';
import { getSettlementEpisodeHandoffCase } from '../src/3d/gameplay/settlementEpisodeHandoffContract.js';
import { buildSettlementEpisodeJourneyCard } from '../src/3d/gameplay/settlementEpisodeJourney.js';
import { buildSettlementEpisodeSavePrompt } from '../src/3d/gameplay/settlementEpisodeSavePolicy.js';
import { buildSettlementEpisodeRuntimeSnapshot,validateSettlementEpisodeRuntimeSnapshot } from '../src/3d/gameplay/settlementEpisodeRuntimeSnapshot.js';
import { buildSettlementEpisodeAcceptanceScore } from '../src/3d/gameplay/settlementEpisodeVerticalSliceAcceptance.js';
import { buildSettlementEpisodeProgression } from '../src/3d/gameplay/settlementEpisodeProgression.js';
import { listSettlementEpisodes,getSettlementEpisode } from '../src/3d/gameplay/settlementEpisodeContent.js';

let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks+=1;};const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;};
function runtime(){let state={activeService:null,panel:'overview',route:[],history:[],feedback:null,lastAction:null,revision:0};return{open(service,panel){state={...state,activeService:service,panel};return{ok:true,view:{...state}};},close(){state={...state,activeService:null,panel:'overview'};return{ok:true,view:{...state}};},async execute(action,input){state={...state,lastAction:{action,nodeId:input.nodeId,episodeId:input.episodeId,episodeStepId:input.episodeStepId},history:[...state.history,{action,stepId:input.episodeStepId}],feedback:{status:'success',code:'ok',message:'Tamamlandı.'},revision:state.revision+1};return{ok:true,action,nodeId:input.nodeId,view:{...state}};},view(){return{...state};},exportState(){return{version:1,runtimeVersion:1,contentVersion:2,...state,requestIds:[]};},importState(next){state={...state,...next};return{ok:true};}};}
const expected={
 iron_and_oath:['iron-01','iron-02','iron-03','iron-04','iron-05','iron-06','iron-07','iron-08'],
 market_routes:['market-01','market-02','market-03','market-04','market-05','market-06','market-07','market-08'],
 road_watch:['watch-01','watch-02','watch-03','watch-04','watch-05','watch-06','watch-07','watch-08'],
 hearth_and_home:['home-01','home-02','home-03','home-04','home-05','home-06','home-07','home-08'],
 winter_supply:['winter-01','winter-02','winter-03','winter-04','winter-05','winter-06','winter-07','winter-08'],
 stable_master:['stable-01','stable-02','stable-03','stable-04','stable-05','stable-06','stable-07','stable-08'],
};

for(const episodeId of listSettlementEpisodes()){
 const rt=runtime();
 const director=createSettlementEpisodeDirector({runtime:rt,now:()=>250});
 const episode=getSettlementEpisode(episodeId);
 eq(expected[episodeId].length,8,`expected-eight:${episodeId}`);
 eq(episode.beats.length,8,`authored-eight:${episodeId}`);
 const opened=director.openEpisode(episodeId);
 ok(opened.ok,`open:${episodeId}`);
 eq(director.snapshot().episodeId,episodeId,`open-episode:${episodeId}`);
 const journey=buildSettlementEpisodeJourneyCard(episodeId);
 ok(journey.ok,`journey:${episodeId}`);
 eq(journey.stages.length,5,`journey-stages:${episodeId}`);
 const acceptance=buildSettlementEpisodeAcceptanceScore(episodeId);
 eq(acceptance.total,10,`acceptance-total:${episodeId}`);
 eq(acceptance.passed,10,`acceptance-passed:${episodeId}`);
 for(let index=0;index<8;index+=1){
  director.setCursor(index);
  const beat=episode.beats[index];
  eq(director.snapshot().beat.stepId,expected[episodeId][index],`step:${episodeId}:${index}`);
  const presentation=buildSettlementEpisodePresentation(director.snapshot());
  eq(presentation.primary.id,beat.stepId,`ux-step:${episodeId}:${index}`);
  eq(presentation.primary.action.id,beat.action,`ux-action:${episodeId}:${index}`);
  eq(presentation.primary.service.id,beat.service,`ux-service:${episodeId}:${index}`);
  const dialogue=buildSettlementEpisodeDialogueView(director.snapshot());
  ok(dialogue.ok,`dialogue:${episodeId}:${index}`);
  eq(dialogue.stepId,beat.stepId,`dialogue-step:${episodeId}:${index}`);
  eq(dialogue.choices.length,3,`dialogue-choices:${episodeId}:${index}`);
  const selected=resolveSettlementEpisodeDialogueSelection(director.snapshot(),dialogue.choices[0].id);
  ok(selected.ok,`dialogue-select:${episodeId}:${index}`);
  eq(selected.input.episodeStepId,beat.stepId,`dialogue-dispatch-step:${episodeId}:${index}`);
  const scene=getSettlementEpisodeDialogueScene(episodeId,beat.stepId);
  ok(scene,`scene:${episodeId}:${index}`);
  eq(scene.action,beat.action,`scene-action:${episodeId}:${index}`);
  const handoff=getSettlementEpisodeHandoffCase(beat.stepId);
  ok(handoff,`handoff:${episodeId}:${index}`);
  eq(handoff.action,beat.action,`handoff-action:${episodeId}:${index}`);
  eq(handoff.service,beat.service,`handoff-service:${episodeId}:${index}`);
  const prepared=director.prepareCurrent({itemId:'iron_ore',recipeId:'iron_sword',routeId:'north_gate'});
  ok(prepared.ok,`prepare:${episodeId}:${index}`);
  eq(prepared.stepId,beat.stepId,`prepare-step:${episodeId}:${index}`);
  eq(prepared.action,beat.action,`prepare-action:${episodeId}:${index}`);
  eq(prepared.runtimeAction,handoff.runtimeAction,`prepare-runtime-action:${episodeId}:${index}`);
  const savePrompt=buildSettlementEpisodeSavePrompt(director.snapshot(),'action-succeeded');
  ok(savePrompt.visible,`save-prompt:${episodeId}:${index}`);
  const checkpoint=buildSettlementEpisodeCheckpoint(director.snapshot(),rt.exportState());
  ok(validateSettlementEpisodeCheckpoint(checkpoint).ok,`checkpoint:${episodeId}:${index}`);
  const runtimeSnapshot=buildSettlementEpisodeRuntimeSnapshot({directorSnapshot:director.snapshot(),runtimeView:rt.view(),runtimeExportState:rt.exportState(),questSnapshot:{quests:{}}});
  ok(validateSettlementEpisodeRuntimeSnapshot(runtimeSnapshot).ok,`runtime-snapshot:${episodeId}:${index}`);
  if(index<7){
   const executed=await director.executeCurrent({requestId:`e2e-${episodeId}-${index}`});
   ok(executed.ok,`execute:${episodeId}:${index}`);
   eq(director.snapshot().cursor,index+1,`advance:${episodeId}:${index}`);
  }else{
   const executed=await director.executeCurrent({requestId:`e2e-${episodeId}-${index}`});
   ok(executed.ok,`execute-final:${episodeId}`);
   eq(executed.phase,'complete',`complete:${episodeId}`);
   eq(director.snapshot().phase,'complete',`complete-snapshot:${episodeId}`);
  }
 }
 const after=director.snapshot();
 eq(after.cursor,8,`final-cursor:${episodeId}`);
 eq(after.phase,'complete',`final-phase:${episodeId}`);
 const completionPresentation=buildSettlementEpisodePresentation(after);
 ok(completionPresentation.progress.isComplete,`progress-complete:${episodeId}`);
 eq(completionPresentation.progress.completed,8,`progress-completed:${episodeId}`);
 const projection=buildSettlementEpisodeProgression({quests:{[episodeId]:{state:'completed'}}});
 ok(projection.episodes.some((entry)=>entry.episodeId===episodeId),'progression-contains-episode');
}

const emptyDirector=createSettlementEpisodeDirector({runtime:runtime(),now:()=>1});
const emptyState=emptyDirector.snapshot();
eq(emptyState.phase,'idle','empty-phase');
const emptyRuntimeSnapshot=buildSettlementEpisodeRuntimeSnapshot({directorSnapshot:emptyState,runtimeView:{},runtimeExportState:null,questSnapshot:{quests:{}}});
ok(validateSettlementEpisodeRuntimeSnapshot(emptyRuntimeSnapshot).ok,'empty-runtime-snapshot-valid');
const invalidDialogue=resolveSettlementEpisodeDialogueSelection(emptyState,'missing');
eq(invalidDialogue.ok,false,'empty-dialogue-selection-blocked');
console.log(`SETTLEMENT_EPISODE_END_TO_END_OK checks=${checks} episodes=${listSettlementEpisodes().length} beats=48`);
