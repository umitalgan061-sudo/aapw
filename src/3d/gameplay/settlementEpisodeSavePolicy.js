/**
 * Save UX policy for settlement episodes.
 * Persistence itself remains in SettlementCampaignRuntime; this module only
 * tells the UI when a save affordance is useful and what checkpoint reason to
 * show to the player.
 */
import { getSettlementEpisode } from './settlementEpisodeContent.js';
import { getSettlementEpisodeHandoffCase } from './settlementEpisodeHandoffContract.js';

export const SETTLEMENT_EPISODE_SAVE_POLICY_VERSION=1;
const SAVE_EVENTS=Object.freeze(['episode-opened','action-succeeded','travel-completed','episode-complete','manual-request']);
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,180):fallback;};
const integer=(value,min,max,fallback=min)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};

export function getSettlementEpisodeSaveEvent(event){return SAVE_EVENTS.includes(event)?event:'manual-request';}
export function shouldSuggestSettlementEpisodeSave(snapshot,event='manual-request'){
 const source=snapshot&&typeof snapshot==='object'?snapshot:{};const phase=text(source.phase,'idle');const episodeId=text(source.episodeId);const stepId=text(source.beat?.stepId);const handoff=getSettlementEpisodeHandoffCase(stepId);const saveEvent=getSettlementEpisodeSaveEvent(event);
 if(!episodeId||!getSettlementEpisode(episodeId))return freeze({suggest:false,reason:'no-episode',event:saveEvent});
 if(phase==='blocked'||phase==='executing')return freeze({suggest:false,reason:phase==='blocked'?'blocked-step':'action-in-flight',event:saveEvent,episodeId,stepId});
 if(saveEvent==='episode-opened')return freeze({suggest:true,reason:'new-episode-checkpoint',event:saveEvent,episodeId,stepId});
 if(saveEvent==='action-succeeded')return freeze({suggest:true,reason:handoff?.state==='persistence'?'persistence-step':'progress-checkpoint',event:saveEvent,episodeId,stepId});
 if(saveEvent==='travel-completed')return freeze({suggest:true,reason:'location-transition',event:saveEvent,episodeId,stepId});
 if(saveEvent==='episode-complete')return freeze({suggest:true,reason:'episode-completion',event:saveEvent,episodeId,stepId});
 return freeze({suggest:true,reason:'manual-save-available',event:saveEvent,episodeId,stepId});
}
export function buildSettlementEpisodeSavePrompt(snapshot,event='manual-request'){
 const policy=shouldSuggestSettlementEpisodeSave(snapshot,event);if(!policy.suggest)return freeze({visible:false,title:'',message:'',reason:policy.reason});
 const messages={
  'new-episode-checkpoint':'Yeni bölüm başladı. İstersen ilerlemeni kaydet.',
  'persistence-step':'Kayıt adımı tamamlandı. Bu noktayı korumak güvenli olabilir.',
  'progress-checkpoint':'Bölüm ilerledi. İlerlemeyi bir kontrol noktasına yazabilirsin.',
  'location-transition':'Yeni bir konuma geçildi. İlerlemeyi güvenceye alabilirsin.',
  'episode-completion':'Bölüm tamamlandı. Ödül ve ilerlemeyi kalıcılaştır.',
  'manual-save-available':'İlerleme kaydı hazır.',
 };
 return freeze({visible:true,title:'İlerlemeyi kaydet',message:messages[policy.reason]??messages['manual-save-available'],reason:policy.reason,event:policy.event,episodeId:policy.episodeId,stepId:policy.stepId});
}
export function buildSettlementEpisodeSaveButton(snapshot,event='manual-request'){
 const policy=shouldSuggestSettlementEpisodeSave(snapshot,event);return freeze({visible:Boolean(policy.suggest),label:policy.suggest?'Kaydet':'Kayıt kullanılamıyor',enabled:Boolean(policy.suggest),reason:policy.reason,episodeId:policy.episodeId??null,stepId:policy.stepId??null});
}
export function validateSettlementEpisodeSavePolicy(){const errors=[];for(const event of ['episode-opened','action-succeeded','travel-completed','episode-complete','manual-request']){if(getSettlementEpisodeSaveEvent(event)!==event)errors.push(`event:${event}`);}if(SAVE_EVENTS.length!==5)errors.push('event-count');return{ok:errors.length===0,errors,events:[...SAVE_EVENTS]};}
export function buildSettlementEpisodeSavePolicyManifest(){return freeze({version:SETTLEMENT_EPISODE_SAVE_POLICY_VERSION,events:[...SAVE_EVENTS],validation:validateSettlementEpisodeSavePolicy()});}
export function createSettlementEpisodeSavePolicy(){const validation=validateSettlementEpisodeSavePolicy();return Object.freeze({version:SETTLEMENT_EPISODE_SAVE_POLICY_VERSION,valid:validation.ok,validation:clone(validation),event:getSettlementEpisodeSaveEvent,shouldSuggest:shouldSuggestSettlementEpisodeSave,prompt:buildSettlementEpisodeSavePrompt,button:buildSettlementEpisodeSaveButton,manifest:buildSettlementEpisodeSavePolicyManifest});}
