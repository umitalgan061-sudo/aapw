import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createSettlementEpisodeDirector } from '../src/3d/gameplay/settlementEpisodeDirector.js';
import { createSettlementEpisodeRuntimeBridge } from '../src/3d/gameplay/settlementEpisodeRuntimeBridge.js';
import { createSettlementEpisodePresentationProjector } from '../src/3d/gameplay/settlementEpisodePresentationModel.js';
import { createSettlementEpisodeCheckpointAdapter } from '../src/3d/gameplay/settlementEpisodeCheckpoint.js';

let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks+=1;};const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;};
const forbidden=['EditorMaterialStudio','MaterialStudio','WorldAssetPlacementPipeline','MaterialAssignmentCore','three','Terrain','combat','NPC','Faction'];
const sourceFiles=[
 'src/3d/gameplay/settlementEpisodeContent.js',
 'src/3d/gameplay/settlementEpisodeDirector.js',
 'src/3d/gameplay/settlementEpisodeCheckpoint.js',
 'src/3d/gameplay/settlementEpisodePresentationModel.js',
 'src/3d/gameplay/settlementEpisodeRuntimeBridge.js',
 'src/3d/gameplay/settlementEpisodeDialogueContent.js',
 'src/3d/gameplay/settlementEpisodeDialoguePresenter.js',
];
for(const file of sourceFiles){
 const content=fs.readFileSync(path.resolve(file),'utf8');
 ok(content.length>0,`non-empty:${file}`);
 for(const term of forbidden)ok(!content.includes(term),`ownership-term:${file}:${term}`);
 ok(!content.includes('document.'),`no-dom-document:${file}`);
 ok(!content.includes('window.'),`no-dom-window:${file}`);
 ok(!content.includes('localStorage'),`no-storage-owner:${file}`);
 ok(!content.includes('sessionStorage'),`no-session-owner:${file}`);
}
function bus(){const listeners=new Map();return{events:[],on(name,fn){listeners.set(name,fn);return()=>listeners.delete(name);},emit(name,payload){this.events.push({name,payload});},send(payload){listeners.get('aapw:settlement-episode:request')?.(payload);}};}
function runtime(){let state={activeService:null,panel:'overview',route:[],history:[],feedback:null,lastAction:null,revision:0};return{open(service,panel){state={...state,activeService:service,panel};return{ok:true,view:{...state}};},close(){state={...state,activeService:null,panel:'overview'};return{ok:true,view:{...state}};},async execute(action,input){state={...state,lastAction:{action,episodeId:input.episodeId,episodeStepId:input.episodeStepId,nodeId:input.nodeId},history:[...state.history,{type:'action',action}],revision:state.revision+1};return{ok:true,action,nodeId:input.nodeId,view:{...state}};},view(){return{...state};},exportState(){return{version:1,runtimeVersion:1,contentVersion:2,...state,requestIds:[]};},importState(next){state={...state,...next};return{ok:true};}};}
const rt=runtime();const d=createSettlementEpisodeDirector({runtime:rt});eq(typeof d.openEpisode,'function','director-open');eq(typeof d.executeCurrent,'function','director-execute');eq(typeof d.snapshot,'function','director-snapshot');eq(typeof d.manifest,'function','director-manifest');
const p=createSettlementEpisodePresentationProjector();eq(typeof p.project,'function','projector-project');
const cp=createSettlementEpisodeCheckpointAdapter({director:d,runtime:rt});eq(typeof cp.exportCheckpoint,'function','checkpoint-export');eq(typeof cp.restoreRuntime,'function','checkpoint-restore');
const b=bus();const bridge=createSettlementEpisodeRuntimeBridge({bus:b,runtime:rt,director:d,projector:p,checkpoint:cp});eq(typeof bridge.handle,'function','bridge-handle');eq(typeof bridge.project,'function','bridge-project');eq(typeof bridge.snapshot,'function','bridge-snapshot');
const opened=await bridge.handle({version:1,requestId:'owner-open',type:'episode-open',episodeId:'iron_and_oath'});ok(opened.ok,'bridge-open');const prepared=await bridge.handle({version:1,requestId:'owner-prepare',type:'episode-prepare',input:{}});ok(prepared.ok,'bridge-prepare');const executed=await bridge.handle({version:1,requestId:'owner-execute',type:'episode-execute',input:{}});ok(executed.ok,'bridge-execute');
const state=bridge.snapshot();ok(state.director,'snapshot-director');ok(state.eventHistory.length>0,'event-history-owned-locally');eq(state.director.runtimeOk,true,'runtime-visible');ok(!('inventory' in state.director),'inventory-not-owned');ok(!('copper' in state.director),'economy-not-owned');ok(!('skills' in state.director),'skills-not-owned');
const manifest=bridge.manifest();ok(manifest.contract==='shared-material-placement-v1','shared-placement-contract-carried');ok(manifest.episodes.length===6,'six-episodes');
const exported=bridge.exportCheckpoint();ok(exported.ok,'export-checkpoint');const restored=await bridge.restoreCheckpoint(exported.checkpoint);ok(restored.ok,'restore-checkpoint');
bridge.dispose();eq(bridge.snapshot().disposed,true,'bridge-disposed');p.dispose();d.dispose();cp.dispose();
console.log(`SETTLEMENT_EPISODE_OWNERSHIP_BOUNDARY_OK checks=${checks} files=${sourceFiles.length}`);
