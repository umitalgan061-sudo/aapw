/**
 * Settlement episode progression projection.
 *
 * This module never changes quest state. It reads the existing quest snapshot
 * and answers one UX question: which authored settlement episode should be
 * presented next? The actual quest chain remains owned by QuestSystem and
 * settlementCampaignRuntime.
 */
import { listSettlementEpisodes, getSettlementEpisode } from './settlementEpisodeContent.js';
import { getSettlementQuestChainReward } from './settlementCampaignQuestChains.js';

export const SETTLEMENT_EPISODE_PROGRESSION_VERSION=1;
export const SETTLEMENT_EPISODE_PROGRESSION_LIMITS=Object.freeze({episodes:6,history:64,text:180});
const ORDER=Object.freeze(['iron_and_oath','market_routes','road_watch','hearth_and_home','winter_supply','stable_master']);
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,180):fallback;};
const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};

function normalizeQuestSnapshot(raw={}){
 const source=raw&&typeof raw==='object'?raw:{}; const quests=source.quests&&typeof source.quests==='object'?source.quests:{};
 const completed=new Set(); const active=new Set();
 for(const [id,record] of Object.entries(quests)){const value=record&&typeof record==='object'?record:{};if(value.completed===true||value.state==='completed')completed.add(id);else if(value.state==='active'||value.state==='in-progress')active.add(id);}
 return {completed,active,reputation:number(source.reputation,0),copper:number(source.copper,0),fatigue:number(source.fatigue,0),locationId:text(source.locationId),settlementId:text(source.settlementId)};
}
function episodeStatus(episodeId,snapshot,index){
 const previousId=ORDER[index-1]??null; const currentCompleted=snapshot.completed.has(episodeId); const previousCompleted=!previousId||snapshot.completed.has(previousId); const active=snapshot.active.has(episodeId);
 let status='locked'; let reason='previous-episode-required';
 if(currentCompleted){status='completed';reason='episode-completed';}
 else if(active){status='active';reason='episode-active';}
 else if(previousCompleted){status='available';reason='previous-episode-complete';}
 if(index===0&&!currentCompleted&&!active){status='available';reason='first-episode';}
 return {status,reason,previousId,completed:currentCompleted,active,order:index};
}
export function listSettlementEpisodeOrder(){return [...ORDER];}
export function getSettlementEpisodeProgressionStatus(episodeId,questSnapshot={}){const index=ORDER.indexOf(episodeId);if(index<0)return{ok:false,reason:'unknown-episode'};const snapshot=normalizeQuestSnapshot(questSnapshot);const episode=getSettlementEpisode(episodeId);return{ok:true,episodeId,title:text(episode?.title,episodeId),...episodeStatus(episodeId,snapshot,index)};}
export function buildSettlementEpisodeProgression(questSnapshot={}){
 const snapshot=normalizeQuestSnapshot(questSnapshot); const episodes=ORDER.map((episodeId,index)=>{const episode=getSettlementEpisode(episodeId);return{...episodeStatus(episodeId,snapshot,index),episodeId,title:text(episode?.title,episodeId),summary:text(episode?.summary),service:text(episode?.service)};});
 const next=episodes.find((episode)=>episode.status==='available'||episode.status==='active')??null;
 const completed=episodes.filter((episode)=>episode.status==='completed').length;
 return freeze({version:SETTLEMENT_EPISODE_PROGRESSION_VERSION,episodeCount:episodes.length,completedCount:completed,remainingCount:episodes.length-completed,percent:episodes.length?Math.round((completed/episodes.length)*100):0,episodes,nextEpisodeId:next?.episodeId??null,nextEpisode:clone(next),reputation:snapshot.reputation,copper:snapshot.copper,fatigue:snapshot.fatigue,locationId:snapshot.locationId,settlementId:snapshot.settlementId});
}
export function getSettlementNextEpisode(questSnapshot={}){const progression=buildSettlementEpisodeProgression(questSnapshot);return progression.nextEpisode?clone(progression.nextEpisode):null;}
export function canEnterSettlementEpisode(episodeId,questSnapshot={}){const result=getSettlementEpisodeProgressionStatus(episodeId,questSnapshot);if(!result.ok)return result;return freeze({ok:result.status==='available'||result.status==='active',episodeId,status:result.status,reason:result.reason,previousId:result.previousId});}
export function buildSettlementEpisodeProgressionBanner(questSnapshot={}){
 const progression=buildSettlementEpisodeProgression(questSnapshot); if(!progression.nextEpisode)return freeze({visible:true,tone:'success',title:'Yerleşim hikâyeleri tamamlandı',message:'Tüm mevcut bölümler tamamlandı.',episodeId:null,action:'review'});
 const next=progression.nextEpisode; const tone=next.status==='active'?'positive':'accent'; return freeze({visible:true,tone,title:next.status==='active'?'Aktif bölüm':'Yeni bölüm hazır',message:next.status==='active'?`${next.title} bölümüne devam edebilirsin.`:`${next.title} artık erişilebilir.`,episodeId:next.episodeId,action:'open'});
}
export function buildSettlementEpisodeCompletionSummary(questSnapshot={}){
 const progression=buildSettlementEpisodeProgression(questSnapshot); return freeze({completedCount:progression.completedCount,total:progression.episodeCount,percent:progression.percent,nextEpisodeId:progression.nextEpisodeId,completedEpisodes:progression.episodes.filter((entry)=>entry.status==='completed').map((entry)=>({episodeId:entry.episodeId,title:entry.title,reward:getSettlementQuestChainReward(entry.episodeId)}))});
}
export function validateSettlementEpisodeProgression(){
 const errors=[]; const seen=new Set(); if(ORDER.length!==SETTLEMENT_EPISODE_PROGRESSION_LIMITS.episodes)errors.push('episode-count');
 for(const episodeId of ORDER){if(seen.has(episodeId))errors.push(`duplicate:${episodeId}`);seen.add(episodeId);if(!getSettlementEpisode(episodeId))errors.push(`missing-episode:${episodeId}`);if(!getSettlementQuestChainReward(episodeId))errors.push(`missing-reward:${episodeId}`);}
 if(seen.size!==ORDER.length)errors.push('unique-order'); return {ok:errors.length===0,errors,order:[...ORDER]};
}
export function buildSettlementEpisodeProgressionManifest(){return freeze({version:SETTLEMENT_EPISODE_PROGRESSION_VERSION,order:[...ORDER],validation:validateSettlementEpisodeProgression(),episodes:ORDER.map((id)=>({episodeId:id,title:getSettlementEpisode(id)?.title??id,reward:clone(getSettlementQuestChainReward(id))}))});}
export function createSettlementEpisodeProgressionResolver(){const validation=validateSettlementEpisodeProgression();return Object.freeze({version:SETTLEMENT_EPISODE_PROGRESSION_VERSION,valid:validation.ok,validation:clone(validation),order:listSettlementEpisodeOrder,status:getSettlementEpisodeProgressionStatus,build:buildSettlementEpisodeProgression,next:getSettlementNextEpisode,canEnter:canEnterSettlementEpisode,banner:buildSettlementEpisodeProgressionBanner,completion:buildSettlementEpisodeCompletionSummary,manifest:buildSettlementEpisodeProgressionManifest});}
