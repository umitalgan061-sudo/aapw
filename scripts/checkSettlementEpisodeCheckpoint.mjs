import { strict as assert } from 'node:assert';
import { createSettlementEpisodeDirector } from '../src/3d/gameplay/settlementEpisodeDirector.js';
import { buildSettlementEpisodeCheckpoint, validateSettlementEpisodeCheckpoint, migrateSettlementEpisodeCheckpoint, createSettlementEpisodeCheckpointAdapter, inspectSettlementEpisodeCheckpoint } from '../src/3d/gameplay/settlementEpisodeCheckpoint.js';

let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks+=1;}; const eq=(a,b,m)=>{assert.equal(a,b,m);checks+=1;};
function runtime(){ let state={activeService:'house',panel:'overview',route:['house'],history:[],requestIds:[],lastAction:null,revision:7}; return {open(service,panel){state={...state,activeService:service,panel};return {ok:true,view:{...state}};},async execute(){return {ok:true};},view(){return {...state};},exportState(){return {...state,version:1,runtimeVersion:1,contentVersion:2};},async importState(next){state={...state,...next};return {ok:true};}}; }
const rt=runtime(); const director=createSettlementEpisodeDirector({runtime:rt}); director.openEpisode('hearth_and_home'); director.setCursor(2);
const checkpoint=buildSettlementEpisodeCheckpoint(director.snapshot(),rt.exportState()); ok(checkpoint.checksum,'checksum-created'); eq(checkpoint.episodeId,'hearth_and_home','episode-id'); eq(checkpoint.cursor,2,'cursor'); eq(validateSettlementEpisodeCheckpoint(checkpoint).ok,true,'checkpoint-valid');
const digestA=validateSettlementEpisodeCheckpoint(checkpoint).body; const digestB=validateSettlementEpisodeCheckpoint({...checkpoint}).body; eq(JSON.stringify(digestA),JSON.stringify(digestB),'deterministic-body');
const bad={...checkpoint,checksum:'deadbeef'}; eq(validateSettlementEpisodeCheckpoint(bad).ok,false,'tamper-blocked'); ok(validateSettlementEpisodeCheckpoint(bad).errors.includes('checksum'),'tamper-error');
const unknown={...checkpoint,episodeId:'unknown'}; unknown.checksum=checkpoint.checksum; ok(validateSettlementEpisodeCheckpoint(unknown).errors.some((e)=>e.startsWith('episode:')),'unknown-episode-blocked');
const migrated=migrateSettlementEpisodeCheckpoint({...checkpoint,version:0}); ok(migrated,'v0-migrated'); eq(migrated.version,1,'migration-version'); eq(validateSettlementEpisodeCheckpoint(migrated).ok,true,'migrated-valid');
eq(migrateSettlementEpisodeCheckpoint({schema:'other',version:1}),null,'unsupported-migration');
const adapter=createSettlementEpisodeCheckpointAdapter({director,runtime:rt}); const exported=adapter.exportCheckpoint(); ok(exported.ok,'adapter-export'); eq(adapter.validate(exported.checkpoint).ok,true,'adapter-validate'); eq(adapter.digest(exported.checkpoint),adapter.digest(exported.checkpoint),'adapter-digest-stable');
const imported=await adapter.restoreRuntime(exported.checkpoint); ok(imported.ok,'adapter-restore'); eq(imported.episodeId,'hearth_and_home','restore-episode'); eq(imported.cursor,2,'restore-cursor');
const inspected=inspectSettlementEpisodeCheckpoint(exported.checkpoint); ok(inspected.ok,'inspect-ok'); eq(inspected.nextStep,'home-03','next-step'); eq(inspected.nextAction,'interact','next-action'); eq(inspected.nextService,'house','next-service'); eq(inspected.runtimeRevision,7,'runtime-revision');
const reset=adapter.reset(); ok(reset.ok,'adapter-reset'); eq(director.snapshot().episodeId,null,'adapter-reset-episode');
adapter.dispose(); eq(adapter.exportCheckpoint().ok,false,'disposed-export'); eq(adapter.validate(exported.checkpoint).ok,false,'disposed-validate'); eq(adapter.restoreRuntime(exported.checkpoint).ok,false,'disposed-restore'); eq(adapter.digest(exported.checkpoint),null,'disposed-digest');
console.log(`SETTLEMENT_EPISODE_CHECKPOINT_OK checks=${checks}`);
