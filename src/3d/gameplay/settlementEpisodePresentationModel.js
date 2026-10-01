/**
 * Settlement episode presentation model.
 * Pure UX projection over the authored episode director. It never executes
 * gameplay and never replaces SettlementCampaignRuntime as state authority.
 */
import { SETTLEMENT_EPISODE_DIRECTOR_VERSION } from './settlementEpisodeDirector.js';
import {
  getSettlementService,
  getSettlementItem,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementQuestObjective,
  getSettlementDialogueCondition,
  getSettlementPerk,
} from './settlementCampaignContent.js';
import {
  getSettlementQuestChainStep,
  getSettlementQuestChainReward,
} from './settlementCampaignQuestChains.js';

export const SETTLEMENT_EPISODE_PRESENTATION_VERSION = 1;
export const SETTLEMENT_EPISODE_PRESENTATION_LIMITS = Object.freeze({
  text: 180, cards: 12, actions: 8, hints: 3, history: 8, resources: 8,
});

const ACTION_LABELS = Object.freeze({
  talk: 'Konuş', collect: 'Topla', deliver: 'Teslim Et', craft: 'Üret',
  travel: 'Seyahat Et', trade: 'Takas Yap', buy: 'Satın Al', sell: 'Sat',
  equip: 'Kuşan', rest: 'Dinlen', train: 'Talime Gir', save: 'Kaydet', interact: 'Etkileş',
});
const ACTION_ORDER = Object.freeze(['talk','buy','sell','trade','craft','equip','collect','deliver','train','rest','travel','save','interact']);
const PANEL_BY_ACTION = Object.freeze({
  talk:'quests', buy:'trade', sell:'trade', trade:'trade', craft:'craft', equip:'craft',
  travel:'travel', collect:'overview', deliver:'overview', train:'overview', rest:'overview',
  save:'overview', interact:'overview',
});
const TONE_BY_PHASE = Object.freeze({ idle:'neutral', entered:'positive', 'service-open':'positive', ready:'positive', executing:'accent', complete:'success', blocked:'warning', disposed:'muted' });
const PRIORITY_BY_ACTION = Object.freeze({ talk:100, collect:95, deliver:95, craft:90, trade:85, buy:85, sell:85, equip:80, train:78, travel:72, rest:70, save:68, interact:60 });

const text = (value, fallback='') => { const normalized=String(value ?? '').trim(); return normalized ? normalized.slice(0,SETTLEMENT_EPISODE_PRESENTATION_LIMITS.text) : fallback; };
const integer = (value,min,max,fallback=min) => { const n=Number(value); return Number.isFinite(n) ? Math.max(min,Math.min(max,Math.trunc(n))) : fallback; };
const finite = (value,fallback=0) => { const n=Number(value); return Number.isFinite(n) ? n : fallback; };
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => { if(!value || typeof value!=='object' || Object.isFrozen(value)) return value; Object.freeze(value); for(const nested of Object.values(value)) freeze(nested); return value; };

function stable(value) {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash=2166136261; const source=stable(value);
  for(let index=0; index<source.length; index+=1){ hash^=source.charCodeAt(index); hash=Math.imul(hash,16777619); }
  return (hash>>>0).toString(16).padStart(8,'0');
}
function normalizeFeedback(feedback) {
  const source=feedback && typeof feedback==='object' ? feedback : {};
  const status=text(source.status,'neutral');
  const severity=status==='error'?'danger':status==='warning'||status==='blocked'?'warning':status==='success'?'success':'neutral';
  return {status,severity,code:text(source.code),message:text(source.message),action:text(source.action)};
}
function normalizeHistory(history) {
  if(!Array.isArray(history)) return [];
  return history.filter((entry)=>entry && typeof entry==='object').slice(-8).map((entry)=>({
    sequence:integer(entry.sequence,0,999999,0), type:text(entry.type,'event'), at:finite(entry.at,0),
    stepId:text(entry.stepId), action:text(entry.action), message:text(entry.message),
  }));
}
function resourceHint(step) {
  if(!step) return null;
  if(step.recipe){ const recipe=getSettlementRecipe(step.recipe); if(recipe) return {kind:'recipe',id:recipe.id,label:recipe.label,station:recipe.station,xp:recipe.xp,minutes:recipe.minutes,ingredients:clone(recipe.ingredients)}; }
  if(step.route){ const route=getSettlementRoute(step.route); if(route) return {kind:'route',id:route.id,label:route.label,destination:route.destination,cost:route.cost,fatigue:route.fatigue,risk:route.risk,checkpoint:route.checkpoint}; }
  if(step.target){ const item=getSettlementItem(step.target); if(item) return {kind:'item',id:item.id,label:item.label,category:item.category,buy:item.buy,sell:item.sell,quantity:integer(step.quantity,1,999,1),weight:item.weight}; }
  return null;
}
function conditionCards(step) {
  if(!step || !Array.isArray(step.conditions)) return [];
  return step.conditions.slice(0,3).map((conditionId)=>{
    const condition=getSettlementDialogueCondition(conditionId);
    if(!condition) return {id:conditionId,label:'Bilinmeyen koşul',known:false,type:'unknown',threshold:null};
    return {id:conditionId,label:condition.label ?? condition.description ?? conditionId,known:true,type:text(condition.type,'unknown'),target:text(condition.target),threshold:condition.threshold ?? null};
  });
}
function objectiveCard(step) {
  if(!step?.objective) return null;
  const objective=getSettlementQuestObjective(step.objective);
  if(!objective) return {id:step.objective,label:'Görev hedefi bulunamadı',known:false,type:'unknown'};
  return {id:objective.id,label:objective.label ?? objective.description ?? objective.id,description:text(objective.description),known:true,type:text(objective.type,'talk'),target:text(objective.target),quantity:Number.isFinite(Number(objective.quantity))?Number(objective.quantity):null};
}
function serviceCard(serviceId) {
  if(!serviceId) return null;
  const service=getSettlementService(serviceId);
  if(!service) return {id:serviceId,label:'Hizmet bulunamadı',known:false,kind:'unknown',actions:[]};
  return {id:service.id,label:service.label,kind:service.kind,domain:service.domain,prompt:text(service.prompt),known:true,actions:Array.isArray(service.actions)?service.actions.slice(0,12):[]};
}
function buildActionAffordances(beat, runtime, feedback) {
  if(!beat) return [];
  const service=serviceCard(beat.service); const serviceActions=service?.actions ?? []; const current=beat.action;
  const candidates=new Set([current,...serviceActions]); const blockedCode=feedback?.code;
  return ACTION_ORDER.filter((action)=>candidates.has(action)).slice(0,8).map((action)=>({
    id:action,label:ACTION_LABELS[action] ?? action,priority:PRIORITY_BY_ACTION[action] ?? 10,current:action===current,
    panel:PANEL_BY_ACTION[action] ?? 'overview',available:runtime?.activeService===beat.service || action===current,
    blocked:Boolean(blockedCode)&&action===current,blockedReason:action===current?blockedCode:'',
  })).sort((a,b)=>Number(b.current)-Number(a.current)||b.priority-a.priority);
}
function progressModel(view) {
  const episode=view?.episode; const beatCount=integer(episode?.beats?.length,0,99,0); const cursor=integer(view?.cursor,0,beatCount,0); const completed=Math.min(cursor,beatCount);
  return {beatCount,currentIndex:cursor,completed,remaining:Math.max(0,beatCount-completed),percent:beatCount>0?Math.round((completed/beatCount)*100):0,isComplete:view?.phase==='complete'||cursor>=beatCount};
}
function phaseHint(phase) {
  const copy={idle:'Bir yerleşim bölümü seç.',entered:'Bölüm başladı; ilk hizmet adımını aç.','service-open':'Hizmet açık; mevcut adımı tamamla.',ready:'Sonraki bölüm adımı hazır.',executing:'İşlem yürütülüyor.',complete:'Bölüm tamamlandı.',blocked:'Mevcut adım için bir koşul veya kaynak eksik.',disposed:'Bölüm oturumu kapalı.'};
  return {tone:TONE_BY_PHASE[phase] ?? 'neutral',text:copy[phase] ?? 'Bölüm durumu güncelleniyor.'};
}
function buildPrimaryCard(view) {
  const beat=view?.beat; if(!beat) return null;
  const questStep=getSettlementQuestChainStep(view.episodeId,beat.stepId);
  return freeze({
    id:beat.stepId,title:text(beat.title,'Yerleşim görevi'),prompt:text(beat.prompt,'Mevcut adımı tamamla.'),
    service:serviceCard(beat.service),action:{id:beat.action,label:ACTION_LABELS[beat.action] ?? beat.action,panel:PANEL_BY_ACTION[beat.action] ?? 'overview',priority:PRIORITY_BY_ACTION[beat.action] ?? 10},
    objective:objectiveCard(questStep),conditions:conditionCards(questStep),resource:resourceHint(questStep),
    hints:Array.isArray(beat.hints)?beat.hints.slice(0,3):[],tags:Array.isArray(beat.tags)?beat.tags.slice(0,6):[],
    quest:questStep?{id:questStep.id,rewardXp:finite(questStep.rewardXp,0),target:text(questStep.target ?? questStep.recipe ?? questStep.route)}:null,
  });
}
function buildRewardModel(episodeId) {
  const reward=episodeId?getSettlementQuestChainReward(episodeId):null; if(!reward) return null;
  const perk=reward.perk?getSettlementPerk(reward.perk):null;
  return {xp:finite(reward.xp,0),copper:finite(reward.copper,0),perk:text(reward.perk),perkLabel:text(perk?.label,reward.perk?reward.perk.replace(/_/g,' '):'')};
}
function buildSecondaryCards(view) {
  const episode=view?.episode; if(!episode?.beats) return [];
  return episode.beats.map((beat,index)=>({id:beat.stepId,index,title:text(beat.title),action:beat.action,service:beat.service,panel:PANEL_BY_ACTION[beat.action] ?? 'overview',active:index===view.cursor,completed:index<view.cursor||view.phase==='complete',locked:index>view.cursor&&view.phase!=='complete'})).slice(0,12);
}
function buildFooter(view) {
  const runtimeHistory=normalizeHistory(view?.runtime?.history); const localHistory=normalizeHistory(view?.history);
  const merged=[...runtimeHistory,...localHistory].sort((a,b)=>a.sequence-b.sequence||a.at-b.at).slice(-8);
  return {feedback:normalizeFeedback(view?.feedback),history:merged,activeService:serviceCard(view?.activeService),panel:text(view?.panel,'overview')};
}

export function buildSettlementEpisodePresentation(directorSnapshot) {
  const view=directorSnapshot && typeof directorSnapshot==='object'?directorSnapshot:{}; const phase=text(view.phase,'idle'); const progress=progressModel(view); const primary=buildPrimaryCard(view); const reward=progress.isComplete?buildRewardModel(view.episodeId):null;
  return freeze({
    version:SETTLEMENT_EPISODE_PRESENTATION_VERSION,directorVersion:SETTLEMENT_EPISODE_DIRECTOR_VERSION,phase,phaseHint:phaseHint(phase),
    episode:view.episode?{id:text(view.episode.id),title:text(view.episode.title),summary:text(view.episode.summary),chapter:text(view.episode.chapter),beatCount:progress.beatCount}:null,
    progress,service:primary?.service ?? serviceCard(view.activeService),primary,
    actions:buildActionAffordances(primary,view,normalizeFeedback(view.feedback)),cards:buildSecondaryCards(view),reward,footer:buildFooter(view),
  });
}
export function buildSettlementEpisodeActionBar(model,limit=6) {
  const actions=Array.isArray(model?.actions)?model.actions:[]; const current=actions.filter((entry)=>entry.current); const rest=actions.filter((entry)=>!entry.current);
  return freeze([...current,...rest].slice(0,integer(limit,1,8,6)).map((entry)=>({id:entry.id,label:entry.label,panel:entry.panel,priority:entry.priority,current:entry.current,available:entry.available,blocked:entry.blocked,blockedReason:entry.blockedReason})));
}
export function buildSettlementEpisodeProgressStrip(model) {
  const source=model?.progress ?? {}; const completed=integer(source.completed,0,99,0); const total=integer(source.beatCount,0,99,0); const remaining=integer(source.remaining,0,99,0); const percent=integer(source.percent,0,100,0);
  return freeze({completed,total,remaining,percent,label:source.isComplete?'Bölüm tamamlandı':`${completed}/${total} adım`});
}
export function buildSettlementEpisodeBlockedNotice(model) {
  const feedback=model?.footer?.feedback ?? {}; if(!feedback.code&&!feedback.message&&model?.phase!=='blocked') return null;
  return freeze({visible:true,severity:feedback.severity ?? 'warning',title:feedback.code||'Adım bekliyor',message:feedback.message||model?.primary?.prompt||'Mevcut adımın koşullarını tamamla.',action:model?.primary?.action?.label ?? 'Devam Et'});
}
export function buildSettlementEpisodeResourcePanel(model) {
  const resource=model?.primary?.resource;
  if(!resource) return freeze({visible:false,kind:null,title:'',rows:[]});
  if(resource.kind==='item') return freeze({visible:true,kind:'item',title:resource.label,rows:[['Kategori',resource.category],['Gerekli adet',resource.quantity],['Alış',resource.buy],['Satış',resource.sell],['Ağırlık',resource.weight]]});
  if(resource.kind==='recipe') return freeze({visible:true,kind:'recipe',title:resource.label,rows:[['İstasyon',resource.station],['XP',resource.xp],['Süre',resource.minutes],['Malzemeler',Object.entries(resource.ingredients ?? {}).map(([id,count])=>`${id} ×${count}`).join(', ')]]});
  return freeze({visible:true,kind:'route',title:resource.label,rows:[['Hedef',resource.destination],['Maliyet',resource.cost],['Yorgunluk',resource.fatigue],['Risk',resource.risk],['Kontrol',resource.checkpoint]]});
}
export function buildSettlementEpisodeConditionsPanel(model) {
  const conditions=Array.isArray(model?.primary?.conditions)?model.primary.conditions:[];
  return freeze({visible:conditions.length>0,count:conditions.length,rows:conditions.map((condition)=>({id:condition.id,label:text(condition.label,condition.id),type:condition.type,target:condition.target,threshold:condition.threshold}))});
}
export function buildSettlementEpisodePerkReward(model) {
  const reward=model?.reward; if(!reward?.perk) return null;
  const perk=getSettlementPerk(reward.perk);
  return freeze({id:reward.perk,label:reward.perkLabel,effect:clone(perk?.effect ?? null),description:text(perk?.description)});
}
export function createSettlementEpisodePresentationProjector(options={}) {
  const now=typeof options.now==='function'?options.now:()=>Date.now(); const onModel=typeof options.onModel==='function'?options.onModel:null; let disposed=false; let revision=0;
  const project=(snapshot)=>{
    if(disposed) return freeze({ok:false,reason:'disposed',version:SETTLEMENT_EPISODE_PRESENTATION_VERSION});
    revision+=1; const model=buildSettlementEpisodePresentation(snapshot); const result=freeze({ok:true,revision,generatedAt:finite(now(),0),model,actionBar:buildSettlementEpisodeActionBar(model),progress:buildSettlementEpisodeProgressStrip(model),blockedNotice:buildSettlementEpisodeBlockedNotice(model),resources:buildSettlementEpisodeResourcePanel(model),conditions:buildSettlementEpisodeConditionsPanel(model),rewardPerk:buildSettlementEpisodePerkReward(model),digest:digest(model)});
    try { onModel?.(clone(result)); } catch { /* UI telemetry is non-authoritative. */ }
    return result;
  };
  const dispose=()=>{disposed=true;};
  return Object.freeze({project,dispose});
}
