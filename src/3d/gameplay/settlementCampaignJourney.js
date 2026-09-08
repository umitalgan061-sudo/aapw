/**
 * Settlement campaign journey composer; no authoritative RPG state ownership.
 */
import { getSettlementService, getSettlementQuestObjective, getSettlementRecipe, getSettlementRoute } from './settlementCampaignContent.js';
import { evaluateActionRule, evaluateObjectiveRule, normalizeRpgSnapshot } from './settlementCampaignRules.js';

export const SETTLEMENT_CAMPAIGN_JOURNEY_VERSION = 1;
export const JOURNEY_STAGES = Object.freeze(['arrival','orientation','commerce','crafting','dialogue','quest','recovery','departure']);
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const STAGES=Object.freeze({
  arrival:{id:'arrival',label:'Varış',service:'gate',actions:['enter'],prompt:'Yerleşime güvenli giriş yap.'},
  orientation:{id:'orientation',label:'Yönlenme',service:'tavern',actions:['talk'],prompt:'Yerel halktan yönlendirme al.'},
  commerce:{id:'commerce',label:'Alışveriş',service:'market',actions:['trade','buy','sell'],prompt:'İhtiyaçlarını pazardan tamamla.'},
  crafting:{id:'crafting',label:'Üretim',service:'blacksmith',actions:['craft','equip'],prompt:'Malzemelerini ekipmana dönüştür.'},
  dialogue:{id:'dialogue',label:'Konuşma',service:'tavern',actions:['talk','acceptQuest'],prompt:'Görev zincirini konuşma koşullarıyla aç.'},
  quest:{id:'quest',label:'Görev',service:'tavern',actions:['advanceQuest'],prompt:'Görevin bir sonraki adımını tamamla.'},
  recovery:{id:'recovery',label:'Toparlanma',service:'house',actions:['rest','save'],prompt:'İlerlemeni güvenli biçimde koru.'},
  departure:{id:'departure',label:'Ayrılış',service:'gate',actions:['travel'],prompt:'Yol maliyetini ve yorgunluğu onayla.'},
});
export function getSettlementJourneyStage(id){const v=STAGES[id];return v?{...v,actions:[...v.actions]}:null;}
export function listSettlementJourneyStages(){return [...JOURNEY_STAGES];}
function stageFromState(snapshot){if(!snapshot.locationId||snapshot.locationId!==snapshot.settlementId)return'arrival';if(snapshot.fatigue>70||snapshot.health<35)return'recovery';return'orientation';}
export function buildSettlementJourney(runtime,options={}){
  if(!runtime||typeof runtime.getViewModel!=='function')throw new TypeError('Runtime is required.');
  const snapshot=normalizeRpgSnapshot(runtime.getViewModel().player);const requested=options.startStage??stageFromState(snapshot);const start=Math.max(0,JOURNEY_STAGES.indexOf(requested));
  const steps=JOURNEY_STAGES.slice(start).map((id,index)=>{const stage=STAGES[id];const service=getSettlementService(stage.service);return{id, index,label:stage.label,serviceId:service?.id??stage.service,prompt:stage.prompt,actions:stage.actions.map(action=>({action,ready:evaluateActionRule(action,{snapshot}).ok})),state:index===0?'current':'queued'};});
  return{version:SETTLEMENT_CAMPAIGN_JOURNEY_VERSION,startStage:requested,currentStage:steps[0]?.id??'arrival',steps,routeHint:text(options.routeId)};
}
export function evaluateJourneyStep(stageId,context={}){const stage=STAGES[stageId];if(!stage)return{ok:false,reason:'unknown-stage'};const snapshot=normalizeRpgSnapshot(context.snapshot);const checks=stage.actions.map(action=>({action,...evaluateActionRule(action,{...context,snapshot})}));return{ok:checks.some(v=>v.ok),stage:stage.id,label:stage.label,actions:checks};}
export function createSettlementJourneyController(runtime){
  if(!runtime||typeof runtime.open!=='function'||typeof runtime.execute!=='function')throw new TypeError('Settlement runtime required.');
  let stageId='arrival';let completed=new Set();let history=[];const current=()=>getSettlementJourneyStage(stageId);
  const record=entry=>{history=[...history,{at:Date.now(),stageId,...clone(entry)}].slice(-64);};
  const enterStage=next=>{if(!STAGES[next])return{ok:false,reason:'unknown-stage'};stageId=next;runtime.open(STAGES[next].service);record({type:'stage-enter',next});return{ok:true,stage:clone(current())};};
  const executeStageAction=async(action,input={})=>{const stage=current();if(!stage)return{ok:false,reason:'no-stage'};if(!stage.actions.includes(action))return{ok:false,reason:'action-not-in-stage'};const result=await runtime.execute(action,input);if(result.ok)completed.add(stageId);record({type:'stage-action',action,ok:result.ok,reason:result.reason});return result;};
  const next=()=>{const index=JOURNEY_STAGES.indexOf(stageId);return JOURNEY_STAGES[index+1]?enterStage(JOURNEY_STAGES[index+1]):{ok:false,reason:'journey-complete'};};
  const objective=id=>{const value=getSettlementQuestObjective(id);return value?{...clone(value),evaluated:evaluateObjectiveRule(id,runtime.getViewModel().player)}:null;};
  const recipe=id=>{const value=getSettlementRecipe(id);return value?{...clone(value),available:evaluateActionRule('craft',{recipeId:id,snapshot:runtime.getViewModel().player})}:null;};
  const travel=id=>{const value=getSettlementRoute(id);return value?clone(value):null;};
  const state=()=>({version:SETTLEMENT_CAMPAIGN_JOURNEY_VERSION,stage:stageId,completed:[...completed],history:clone(history),current:clone(current())});
  return Object.freeze({current,enterStage,executeStageAction,next,objective,recipe,travel,state,build:options=>buildSettlementJourney(runtime,options)});
}
export function createDefaultSettlementJourney(runtime){const controller=createSettlementJourneyController(runtime);controller.enterStage('arrival');return controller;}
