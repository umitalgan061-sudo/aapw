/**
 * Settlement episode runtime bridge.
 * Composes the existing EventBus, Episode Director, Presentation Model and
 * checkpoint codec without taking ownership of gameplay state.
 */
import { SETTLEMENT_CAMPAIGN_EVENT_NAMES } from './settlementCampaignEventBridge.js';
import { createSettlementEpisodeDirector } from './settlementEpisodeDirector.js';
import { createSettlementEpisodePresentationProjector } from './settlementEpisodePresentationModel.js';
import { createSettlementEpisodeCheckpointAdapter } from './settlementEpisodeCheckpoint.js';
import { listSettlementEpisodes, getSettlementEpisode } from './settlementEpisodeContent.js';

export const SETTLEMENT_EPISODE_RUNTIME_BRIDGE_VERSION = 1;
export const SETTLEMENT_EPISODE_RUNTIME_BRIDGE_LIMITS = Object.freeze({
  requestHistory: 64, eventHistory: 96, text: 180,
});
const text=(value,fallback='')=>{const normalized=String(value??'').trim();return normalized?normalized.slice(0,SETTLEMENT_EPISODE_RUNTIME_BRIDGE_LIMITS.text):fallback;};
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const integer=(value,min,max,fallback=min)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;return`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;}
function digest(value){let hash=2166136261;const source=stable(value);for(let i=0;i<source.length;i+=1){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function normalizeRequest(raw){const source=raw&&typeof raw==='object'?raw:{};return{version:integer(source.version,1,9,1),requestId:text(source.requestId),type:text(source.type),episodeId:text(source.episodeId),action:text(source.action),stepId:text(source.stepId),input:clone(source.input??{})};}
const REQUEST_TYPES=Object.freeze(['episode-open','episode-select','episode-next','episode-previous','episode-step','episode-service-open','episode-service-close','episode-prepare','episode-execute','episode-state','episode-reset','episode-checkpoint-export','episode-checkpoint-restore','episode-manifest']);

export function createSettlementEpisodeRuntimeBridge(options={}){
  const bus=options.bus; const runtime=options.runtime;
  if(!bus||typeof bus.on!=='function'||typeof bus.emit!=='function')throw new TypeError('Episode runtime bridge requires EventBus on/emit.');
  if(!runtime||typeof runtime.open!=='function'||typeof runtime.execute!=='function')throw new TypeError('Episode runtime bridge requires SettlementCampaignRuntime.');
  const now=typeof options.now==='function'?options.now:()=>Date.now();
  const director=options.director??createSettlementEpisodeDirector({runtime,snapshot:options.snapshot,conditionEvaluator:options.conditionEvaluator,now,onEvent:(event)=>bus.emit('aapw:settlement-episode:event',clone(event))});
  const projector=options.projector??createSettlementEpisodePresentationProjector({now,onModel:(model)=>bus.emit('aapw:settlement-episode:model',clone(model))});
  const checkpoint=options.checkpoint??createSettlementEpisodeCheckpointAdapter({director,runtime});
  let disposed=false; let sequence=0; let requestOrder=[]; let eventHistory=[];
  const rememberRequest=(id)=>{if(!id)return false;if(requestOrder.includes(id))return true;requestOrder=[...requestOrder,id].slice(-64);return false;};
  const rememberEvent=(event)=>{eventHistory=[...eventHistory,{sequence:++sequence,at:now(),...clone(event)}].slice(-96);};
  const emit=(name,payload={})=>{const event={version:SETTLEMENT_EPISODE_RUNTIME_BRIDGE_VERSION,name,at:now(),...clone(payload)};rememberEvent(event);try{bus.emit(name,event);}catch{/* telemetry is non-authoritative */}return event;};
  const envelope=(request,result)=>({version:SETTLEMENT_EPISODE_RUNTIME_BRIDGE_VERSION,requestId:request.requestId,type:request.type,ok:result?.ok===true,reason:text(result?.reason,result?.ok===false?'request-rejected':''),result:clone(result)});
  const handle=async(raw)=>{
    if(disposed)return{ok:false,reason:'disposed'}; const request=normalizeRequest(raw);
    if(request.version!==1)return{ok:false,reason:'unsupported-version',requestId:request.requestId};
    if(!REQUEST_TYPES.includes(request.type))return{ok:false,reason:'unknown-request-type',requestId:request.requestId};
    if(!request.requestId)return{ok:false,reason:'missing-request-id'}; if(rememberRequest(request.requestId))return{ok:false,reason:'duplicate-request',requestId:request.requestId};
    let result;
    try{
      if(request.type==='episode-open')result=director.openEpisode(request.episodeId,{cursor:request.input?.cursor});
      else if(request.type==='episode-select')result=director.chooseEpisode(request.episodeId);
      else if(request.type==='episode-next')result=director.next();
      else if(request.type==='episode-previous')result=director.previous();
      else if(request.type==='episode-step')result=director.setCursor(request.input?.cursor);
      else if(request.type==='episode-service-open')result=director.openCurrentService();
      else if(request.type==='episode-service-close')result=director.closeService();
      else if(request.type==='episode-prepare')result=director.prepareCurrent(request.input);
      else if(request.type==='episode-execute')result=await director.executeCurrent(request.input);
      else if(request.type==='episode-state')result={ok:true,view:director.snapshot()};
      else if(request.type==='episode-reset')result=director.reset();
      else if(request.type==='episode-checkpoint-export')result=checkpoint.exportCheckpoint();
      else if(request.type==='episode-checkpoint-restore')result=await checkpoint.restoreRuntime(request.input?.checkpoint);
      else if(request.type==='episode-manifest')result={ok:true,manifest:director.manifest()};
      else result={ok:false,reason:'unknown-request-type'};
    }catch(error){result={ok:false,reason:'bridge-handler-threw',message:text(error?.message,'Bölüm işlemi yürütülemedi.')};}
    const out=envelope(request,result); emit('aapw:settlement-episode:response',out);
    if(result?.ok===false)emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.feedback,{requestId:request.requestId,code:out.reason,message:text(result?.message)});
    else if(request.type==='episode-open')emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.opened,{requestId:request.requestId,result:clone(result)});
    else if(request.type==='episode-service-close')emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.closed,{requestId:request.requestId,result:clone(result)});
    else if(request.type==='episode-checkpoint-restore')emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.restored,{requestId:request.requestId,result:clone(result)});
    else emit(SETTLEMENT_CAMPAIGN_EVENT_NAMES.action,{requestId:request.requestId,result:clone(result)});
    const projection=projector.project(director.snapshot()); emit('aapw:settlement-episode:model-requested',{requestId:request.requestId,digest:projection.ok?projection.digest:null,phase:director.snapshot().phase});
    return freeze(out);
  };
  const listener=(payload)=>{void handle(payload);}; const unsubscribe=bus.on('aapw:settlement-episode:request',listener);
  const snapshot=()=>freeze({version:SETTLEMENT_EPISODE_RUNTIME_BRIDGE_VERSION,disposed,sequence,supportedRequests:[...REQUEST_TYPES],episodes:listSettlementEpisodes().map((id)=>({id,title:getSettlementEpisode(id)?.title??id})),director:director.snapshot(),eventHistory:clone(eventHistory),requestCount:requestOrder.length,digest:digest({director:director.snapshot(),eventHistory})});
  const project=()=>projector.project(director.snapshot()); const exportCheckpoint=()=>checkpoint.exportCheckpoint(); const restoreCheckpoint=(value)=>checkpoint.restoreRuntime(value); const manifest=()=>director.manifest();
  const dispose=()=>{if(disposed)return{ok:true};disposed=true;try{unsubscribe?.();}catch{}try{projector.dispose?.();}catch{}try{checkpoint.dispose?.();}catch{}try{director.dispose?.();}catch{}try{bus.emit('aapw:settlement-episode:disposed',{version:1,at:now()});}catch{}return{ok:true};};
  return Object.freeze({version:SETTLEMENT_EPISODE_RUNTIME_BRIDGE_VERSION,runtime,director,projector,checkpoint,handle,project,snapshot,exportCheckpoint,restoreCheckpoint,manifest,dispose});
}

export function createSettlementEpisodeRequest(type,input={}){const source=input&&typeof input==='object'?input:{};return freeze({version:1,requestId:text(source.requestId,`episode-request-${Date.now()}`),type:text(type),episodeId:text(source.episodeId),action:text(source.action),stepId:text(source.stepId),input:clone(source.input??{})});}
