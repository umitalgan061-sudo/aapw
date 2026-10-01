import { strict as assert } from 'node:assert';
import { createSettlementEpisodeDirector } from '../src/3d/gameplay/settlementEpisodeDirector.js';
import { createSettlementEpisodeCheckpointAdapter, validateSettlementEpisodeCheckpoint, inspectSettlementEpisodeCheckpoint } from '../src/3d/gameplay/settlementEpisodeCheckpoint.js';
import { listSettlementEpisodes, getSettlementEpisode } from '../src/3d/gameplay/settlementEpisodeContent.js';
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks+=1;}; const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;};
function runtime(){let state={activeService:null,panel:'overview',route:[],history:[],requestIds:[],lastAction:null,revision:0};return{open(service,panel){state={...state,activeService:service,panel,route:[...state.route,service],revision:state.revision+1};return{ok:true,view:{...state}};},async execute(action,input){state={...state,lastAction:{action,episodeId:input.episodeId,episodeStepId:input.episodeStepId},history:[...state.history,{type:'action',action}],revision:state.revision+1};return{ok:true,action,nodeId:input.nodeId,view:{...state}};},close(){state={...state,activeService:null,panel:'overview'};return{ok:true};},view(){return{...state};},exportState(){return{version:1,runtimeVersion:1,contentVersion:2,...state};},async importState(next){state={...state,...next};return{ok:true};}};}
for(const id of listSettlementEpisodes()){
 const rt=runtime(); const director=createSettlementEpisodeDirector({runtime:rt,now:()=>42}); const adapter=createSettlementEpisodeCheckpointAdapter({director,runtime:rt}); const opened=director.openEpisode(id); ok(opened.ok,`open-${id}`);
 for(const cursor of [0,2,4,7]){
  director.setCursor(cursor); const exported=adapter.exportCheckpoint(); ok(exported.ok,`export-${id}-${cursor}`); ok(validateSettlementEpisodeCheckpoint(exported.checkpoint).ok,`validate-${id}-${cursor}`); eq(inspectSettlementEpisodeCheckpoint(exported.checkpoint).cursor,cursor,`inspect-${id}-${cursor}`); const tampered={...exported.checkpoint,cursor:cursor+1,checksum:exported.checkpoint.checksum}; eq(validateSettlementEpisodeCheckpoint(tampered).ok,false,`tamper-${id}-${cursor}`); const restored=await adapter.restoreRuntime(exported.checkpoint); ok(restored.ok,`restore-${id}-${cursor}`); eq(restored.episodeId,id,`restore-episode-${id}-${cursor}`); eq(restored.cursor,cursor,`restore-cursor-${id}-${cursor}`);
 }
 const episode=getSettlementEpisode(id); eq(episode.beats.length,8,`beats-${id}`); ok(episode.entry.requires.includes('settlement-present'),`entry-${id}`); adapter.dispose();
}
console.log(`SETTLEMENT_EPISODE_SAVE_ROUNDTRIP_OK checks=${checks} episodes=${listSettlementEpisodes().length}`);
