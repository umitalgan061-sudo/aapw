/**
 * Input boundary for settlement episode actions.
 * It validates/normalizes player-facing payloads before the existing runtime
 * handler receives them. It owns no inventory, economy, quest or world state.
 */
import { getSettlementEpisodeHandoffCase } from './settlementEpisodeHandoffContract.js';
import { getSettlementEpisodeBeat } from './settlementEpisodeContent.js';
import { getSettlementItem,getSettlementRecipe,getSettlementRoute,getSettlementService } from './settlementCampaignContent.js';

export const SETTLEMENT_EPISODE_INPUT_NORMALIZER_VERSION=1;
export const SETTLEMENT_EPISODE_INPUT_LIMITS=Object.freeze({text:120,quantity:999});
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,120):fallback;};
const integer=(value,min,max,fallback=min)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};
const ACTION_INPUT_KEYS=Object.freeze({talk:'nodeId',collect:'itemId',deliver:'itemId',craft:'recipeId',travel:'routeId',trade:'itemId',buy:'itemId',sell:'itemId',equip:'itemId',rest:'nodeId',train:'nodeId',save:'nodeId',interact:'nodeId'});
const ENTITY_GETTER=Object.freeze({itemId:getSettlementItem,recipeId:getSettlementRecipe,routeId:getSettlementRoute,nodeId:getSettlementService});

export function getSettlementEpisodeRequiredInputKey(action){return ACTION_INPUT_KEYS[action]??null;}
export function normalizeSettlementEpisodeInput(stepId,input={}){
 const handoff=getSettlementEpisodeHandoffCase(stepId);const beat=stepId?getSettlementEpisodeBeat(handoff?.episodeId,stepId):null;
 if(!handoff||!beat)return{ok:false,reason:'unknown-step'};
 const source=input&&typeof input==='object'?input:{};const key=handoff.inputKey;const raw=text(source[key]);
 if(!raw)return{ok:false,reason:'required-input-missing',stepId,inputKey:key};
 const getter=ENTITY_GETTER[key];const entity=getter?getter(raw):null;
 if(!entity)return{ok:false,reason:'unknown-input-entity',stepId,inputKey:key,value:raw};
 const normalized={...clone(source),[key]:raw,nodeId:text(source.nodeId,handoff.service),episodeId:handoff.episodeId,episodeStepId:stepId};
 if(source.quantity!=null)normalized.quantity=integer(source.quantity,1,SETTLEMENT_EPISODE_INPUT_LIMITS.quantity,1);
 if(source.requestId!=null)normalized.requestId=text(source.requestId);
 if(source.dialogueChoiceId!=null)normalized.dialogueChoiceId=text(source.dialogueChoiceId);
 return Object.freeze({ok:true,stepId,episodeId:handoff.episodeId,action:handoff.action,runtimeAction:handoff.runtimeAction,inputKey:key,input:normalized,entity:clone(entity)});
}
export function buildSettlementEpisodeInputPreview(stepId,input={}){const result=normalizeSettlementEpisodeInput(stepId,input);if(!result.ok)return result;return Object.freeze({ok:true,stepId:result.stepId,action:result.action,runtimeAction:result.runtimeAction,inputKey:result.inputKey,summary:{service:text(result.input.nodeId),entityId:text(result.input[result.inputKey]),quantity:result.input.quantity??null,requestId:text(result.input.requestId)}});}
export function validateSettlementEpisodeInput(stepId,input={}){const result=normalizeSettlementEpisodeInput(stepId,input);return Object.freeze({ok:result.ok,reason:result.ok?'':result.reason,stepId:result.stepId??text(stepId),inputKey:result.inputKey??getSettlementEpisodeRequiredInputKey(input?.action??''),entity:result.entity??null});}
export function createSettlementEpisodeInputNormalizer(){return Object.freeze({version:SETTLEMENT_EPISODE_INPUT_NORMALIZER_VERSION,requiredKey:getSettlementEpisodeRequiredInputKey,normalize:normalizeSettlementEpisodeInput,preview:buildSettlementEpisodeInputPreview,validate:validateSettlementEpisodeInput});}
