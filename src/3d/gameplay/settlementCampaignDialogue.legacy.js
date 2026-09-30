/**
 * Settlement dialogue presentation adapter.
 * Conditions are evaluated against authoritative snapshots; branch state is not owned here.
 */
import { getSettlementDialogueCondition, getSettlementService, getSettlementQuestObjective } from './settlementCampaignContent.js';
import { evaluateDialogueCondition, evaluateDialogueConditions, normalizeRpgSnapshot } from './settlementCampaignRules.js';

export const SETTLEMENT_DIALOGUE_ADAPTER_VERSION = 1;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const BRANCHES=Object.freeze({
  tavern_arrival:{id:'tavern_arrival',service:'tavern',speaker:'Han Sahibi',prompt:'Bu yerleşime ilk kez gelmiş gibisin.',conditions:['flag_01','reputation_02'],next:['tavern_supply','tavern_rumour']},
  tavern_supply:{id:'tavern_supply',service:'tavern',speaker:'Han Sahibi',prompt:'Depodaki eksikleri kapatacak birine ihtiyacım var.',conditions:['item_03','quest_04'],next:['smithing_request','market_request']},
  tavern_rumour:{id:'tavern_rumour',service:'tavern',speaker:'Han Sahibi',prompt:'Yol hakkında bir söylenti duymak ister misin?',conditions:['skill_04'],next:['gate_warning']},
  smithing_request:{id:'smithing_request',service:'blacksmith',speaker:'Demirci',prompt:'Demir ve kömür getirebilirsen sana bir iş açarım.',conditions:['item_06','skill_09'],next:['smithing_reward']},
  smithing_reward:{id:'smithing_reward',service:'blacksmith',speaker:'Demirci',prompt:'İşi tamamladın; iyi bir malzeme seçimi yaptın.',conditions:['quest_11'],next:['barracks_offer']},
  market_request:{id:'market_request',service:'market',speaker:'Pazar Görevlisi',prompt:'Pazar bugün sakin; doğru fiyata alıcı bulabilirsin.',conditions:['reputation_07','skill_13'],next:['market_deal']},
  market_deal:{id:'market_deal',service:'market',speaker:'Pazar Görevlisi',prompt:'Toplu satış yapacaksan fiyatı yeniden hesaplayalım.',conditions:['item_18'],next:['tavern_supply']},
  barracks_offer:{id:'barracks_offer',service:'barracks',speaker:'Çavuş',prompt:'Kışlada bir eğitim görevi var.',conditions:['skill_24','reputation_22'],next:['gate_warning']},
  gate_warning:{id:'gate_warning',service:'gate',speaker:'Kapı Nöbetçisi',prompt:'Yolun durumunu kontrol etmeden çıkma.',conditions:['reputation_27'],next:['departure']},
  departure:{id:'departure',service:'gate',speaker:'Kapı Nöbetçisi',prompt:'Yol maliyeti ve yorgunluk kabul edilebilir görünüyor.',conditions:['reputation_31'],next:[]},
  house_return:{id:'house_return',service:'house',speaker:'Ev Sahibi',prompt:'Burada eşyalarını güvenle düzenleyebilirsin.',conditions:['flag_36'],next:['recovery']},
  recovery:{id:'recovery',service:'house',speaker:'Ev Sahibi',prompt:'Dinlenmek için uygun bir yer hazırladın.',conditions:['skill_39'],next:[]},
});
function stateOf(branch,snapshot){const checks=evaluateDialogueConditions(branch.conditions,snapshot);return{...clone(branch),service:getSettlementService(branch.service)?.id??branch.service,checks:checks.checks,available:checks.ok};}
export function listSettlementDialogueBranches(){return Object.keys(BRANCHES);}
export function getSettlementDialogueBranch(id){const value=BRANCHES[id];return value?{...clone(value)}:null;}
export function evaluateSettlementDialogueBranch(id,snapshot={}){const value=BRANCHES[id];return value?{ok:true,branch:stateOf(value,snapshot)}:{ok:false,reason:'unknown-branch'};}
export function buildSettlementDialogueGraph(snapshot={},options={}){const state=normalizeRpgSnapshot(snapshot);const root=text(options.root,'tavern_arrival');const queue=[root];const visited=[];const nodes=[];while(queue.length&&nodes.length<12){const id=queue.shift();if(visited.includes(id))continue;visited.push(id);const branch=BRANCHES[id];if(!branch)continue;nodes.push(stateOf(branch,state));for(const next of branch.next)if(!visited.includes(next))queue.push(next);}return{version:SETTLEMENT_DIALOGUE_ADAPTER_VERSION,root,nodes,availableCount:nodes.filter(v=>v.available).length};}
export function selectNextDialogueBranch(id,snapshot={},preference={}){const branch=BRANCHES[id];if(!branch)return{ok:false,reason:'unknown-branch'};const candidates=branch.next.map(next=>BRANCHES[next]).filter(Boolean).map(next=>stateOf(next,snapshot)).filter(next=>next.available);if(!candidates.length)return{ok:false,reason:'no-available-branch',candidates:[]};const preferred=text(preference.service);const selected=candidates.find(v=>v.service===preferred)??candidates[0];return{ok:true,branch:selected,candidates:candidates.map(v=>v.id)};}
export function buildDialogueChoice(id,snapshot={}){const branch=BRANCHES[id];if(!branch)return null;const checks=branch.conditions.map(conditionId=>({conditionId,...evaluateDialogueCondition(conditionId,snapshot)}));return{id:branch.id,speaker:branch.speaker,prompt:branch.prompt,serviceId:getSettlementService(branch.service)?.id??branch.service,available:checks.every(v=>v.ok),conditions:checks,next:[...branch.next]};}
export function summarizeDialogueBranch(id,snapshot={}){const branch=buildDialogueChoice(id,snapshot);if(!branch)return{ok:false,reason:'unknown-branch'};return{ok:true,id:branch.id,speaker:branch.speaker,prompt:branch.prompt,available:branch.available,blockedBy:branch.conditions.filter(v=>!v.ok).map(v=>v.reason)};}
export function questDialogueBridge(objectiveId,snapshot={}){const objective=getSettlementQuestObjective(objectiveId);if(!objective)return{ok:false,reason:'unknown-objective'};const branches=listSettlementDialogueBranches().filter(id=>BRANCHES[id].conditions.some(conditionId=>getSettlementDialogueCondition(conditionId)?.type==='quest'));return{ok:true,objective:clone(objective),branches:branches.map(id=>summarizeDialogueBranch(id,snapshot))};}
