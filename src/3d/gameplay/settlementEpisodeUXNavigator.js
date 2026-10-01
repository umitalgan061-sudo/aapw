/**
 * Settlement episode UX navigator.
 * Keeps only presentation focus/navigation state. Gameplay state remains owned
 * by the existing Episode Director and SettlementCampaignRuntime.
 */
import { buildSettlementEpisodePresentation } from './settlementEpisodePresentationModel.js';
import { buildSettlementEpisodeDialogueView } from './settlementEpisodeDialoguePresenter.js';
import { buildSettlementEpisodeJourneyCard } from './settlementEpisodeJourney.js';
import { getSettlementEpisodeHandoffCase } from './settlementEpisodeHandoffContract.js';

export const SETTLEMENT_EPISODE_UX_NAVIGATOR_VERSION=1;
export const SETTLEMENT_EPISODE_UX_NAVIGATOR_LIMITS=Object.freeze({focusHistory:32,panels:6,actions:8,text:180});
const PANELS=Object.freeze(['quests','trade','craft','travel','overview','dialogue']);
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,180):fallback;};
const integer=(value,min,max,fallback=min)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback;};

function panelFor(snapshot){const action=snapshot?.beat?.action;if(['buy','sell','trade'].includes(action))return'trade';if(action==='craft'||action==='equip')return'craft';if(action==='travel')return'travel';if(action==='talk')return'dialogue';return'overview';}
function focusTargets(snapshot){const model=buildSettlementEpisodePresentation(snapshot);const targets=[];if(model.primary?.id)targets.push({id:model.primary.id,kind:'objective',label:model.primary.title});if(model.primary?.service?.id)targets.push({id:`service:${model.primary.service.id}`,kind:'service',label:model.primary.service.label});for(const action of model.actions??[])targets.push({id:`action:${action.id}`,kind:'action',label:action.label,available:action.available});if(model.footer?.history?.length)targets.push({id:'history',kind:'history',label:'İşlem geçmişi'});return targets.slice(0,8);}
function normalizeFocus(focus,targets){if(!targets.length)return 0;if(typeof focus==='number')return integer(focus,0,targets.length-1,0);const index=targets.findIndex((target)=>target.id===focus);return index>=0?index:0;}

export function buildSettlementEpisodeUXView(snapshot,focus=0){
 const presentation=buildSettlementEpisodePresentation(snapshot);const dialogue=buildSettlementEpisodeDialogueView(snapshot);const journey=buildSettlementEpisodeJourneyCard(snapshot?.episodeId);const handoff=getSettlementEpisodeHandoffCase(snapshot?.beat?.stepId);const panel=panelFor(snapshot);const targets=focusTargets(snapshot);const focusIndex=normalizeFocus(focus,targets);
 return freeze({version:SETTLEMENT_EPISODE_UX_NAVIGATOR_VERSION,episodeId:text(snapshot?.episodeId),stepId:text(snapshot?.beat?.stepId),phase:text(snapshot?.phase,'idle'),panel,focusIndex,focusTarget:targets[focusIndex]??null,targets,presentation,dialogue:dialogue.ok?dialogue:null,journey:journey.ok?journey:null,handoff:handoff?clone(handoff):null});
}

export function createSettlementEpisodeUXNavigator(options={}){
 const now=typeof options.now==='function'?options.now:()=>Date.now();const onNavigate=typeof options.onNavigate==='function'?options.onNavigate:null;let disposed=false;let focus=0;let history=[];let sequence=0;
 const record=(type,payload={})=>{history=[...history,{sequence:++sequence,at:now(),type,...clone(payload)}].slice(-SETTLEMENT_EPISODE_UX_NAVIGATOR_LIMITS.focusHistory);};
 const view=(snapshot)=>disposed?{ok:false,reason:'disposed'}:{ok:true,state:buildSettlementEpisodeUXView(snapshot,focus),history:clone(history)};
 const emit=(snapshot,type,payload={})=>{const state=buildSettlementEpisodeUXView(snapshot,focus);record(type,{episodeId:state.episodeId,stepId:state.stepId,focusIndex:state.focusIndex,...payload});try{onNavigate?.(clone(state));}catch{}return freeze({ok:true,state,history:clone(history)});};
 const setFocus=(snapshot,next)=>{if(disposed)return{ok:false,reason:'disposed'};const state=buildSettlementEpisodeUXView(snapshot,focus);focus=normalizeFocus(next,state.targets);return emit(snapshot,'focus-changed',{focusId:state.targets[focus]?.id??null});};
 const nextFocus=(snapshot)=>{const state=buildSettlementEpisodeUXView(snapshot,focus);if(!state.targets.length)return{ok:true,state};focus=(focus+1)%state.targets.length;return emit(snapshot,'focus-next',{focusId:state.targets[focus]?.id??null});};
 const previousFocus=(snapshot)=>{const state=buildSettlementEpisodeUXView(snapshot,focus);if(!state.targets.length)return{ok:true,state};focus=(focus-1+state.targets.length)%state.targets.length;return emit(snapshot,'focus-previous',{focusId:state.targets[focus]?.id??null});};
 const moveToPanel=(snapshot,panel)=>{if(disposed)return{ok:false,reason:'disposed'};const normalized=text(panel,'overview');if(!PANELS.includes(normalized))return{ok:false,reason:'unknown-panel',panel:normalized};const state=buildSettlementEpisodeUXView(snapshot,focus);record('panel-requested',{from:state.panel,to:normalized});return emit(snapshot,'panel-selected',{panel:normalized});};
 const reconcile=(snapshot)=>{if(disposed)return{ok:false,reason:'disposed'};const state=buildSettlementEpisodeUXView(snapshot,focus);focus=normalizeFocus(focus,state.targets);record('reconciled',{focusId:state.targets[focus]?.id??null,panel:state.panel});return emit(snapshot,'reconciled');};
 const reset=()=>{if(disposed)return{ok:false,reason:'disposed'};focus=0;history=[];sequence=0;return{ok:true,focusIndex:0,history:[]};};
 const dispose=()=>{disposed=true;history=[];};
 return Object.freeze({version:SETTLEMENT_EPISODE_UX_NAVIGATOR_VERSION,view,setFocus,nextFocus,previousFocus,moveToPanel,reconcile,reset,dispose});
}
