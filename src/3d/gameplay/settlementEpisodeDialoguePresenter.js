/**
 * UX presenter for the authored settlement dialogue scenes.
 * It maps the current Episode Director beat to dialogue data; it never mutates
 * quest, inventory, economy, NPC or save state.
 */
import { getSettlementEpisodeDialogueScene, resolveSettlementEpisodeDialogueChoice } from './settlementEpisodeDialogueContent.js';
import { getSettlementEpisode } from './settlementEpisodeContent.js';

export const SETTLEMENT_EPISODE_DIALOGUE_PRESENTER_VERSION=1;
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,220):fallback;};
const ACTION_LABELS=Object.freeze({talk:'Konuş',collect:'Topla',deliver:'Teslim Et',craft:'Üret',travel:'Seyahat Et',trade:'Takas Yap',buy:'Satın Al',sell:'Sat',equip:'Kuşan',rest:'Dinlen',train:'Talime Gir',save:'Kaydet',interact:'Etkileş'});
const RESPONSE_TONE=Object.freeze({ask:'curious',accept:'commit',confirm:'commit',inspect:'inspect',craft:'commit',equip:'commit',rest:'calm',status:'inspect',route:'commit',cost:'inspect',save:'commit',interact:'commit',leave:'cancel',back:'cancel'});

function buildChoice(scene,choice){return{...clone(choice),tone:RESPONSE_TONE[choice.id]??'neutral',dispatch:{action:scene.action,episodeId:'',episodeStepId:scene.stepId,dialogueChoiceId:choice.id}};}
function buildNarrativeState(snapshot,scene,episode){return{episodeId:text(snapshot?.episodeId),stepId:scene.stepId,episodeTitle:text(episode?.title),speaker:scene.speaker,speakerRole:scene.speakerRole,line:scene.line,intent:scene.intent,actionLabel:ACTION_LABELS[scene.action]??scene.action,choices:scene.choices.map((choice)=>buildChoice(scene,choice)),tags:[...scene.tags],ux:clone(scene.ux),historyVisible:true};}

export function buildSettlementEpisodeDialogueView(snapshot){
  const episodeId=text(snapshot?.episodeId); const stepId=text(snapshot?.beat?.stepId); if(!episodeId||!stepId)return freeze({ok:false,reason:'no-current-dialogue'});
  const scene=getSettlementEpisodeDialogueScene(episodeId,stepId); if(!scene)return freeze({ok:false,reason:'dialogue-scene-missing',episodeId,stepId});
  const episode=getSettlementEpisode(episodeId); return freeze({ok:true,version:SETTLEMENT_EPISODE_DIALOGUE_PRESENTER_VERSION,...buildNarrativeState(snapshot,scene,episode)});
}

export function resolveSettlementEpisodeDialogueSelection(snapshot,choiceId){
  const view=buildSettlementEpisodeDialogueView(snapshot); if(!view.ok)return view; const selected=resolveSettlementEpisodeDialogueChoice(view.episodeId,view.stepId,choiceId); if(!selected.ok)return selected;
  return freeze({...selected,choice:{id:selected.choiceId,label:selected.label,tone:selected.tone},input:{dialogueChoiceId:selected.choiceId,episodeId:view.episodeId,episodeStepId:view.stepId}});
}

export function createSettlementEpisodeDialoguePresenter(options={}){
  const onSelect=typeof options.onSelect==='function'?options.onSelect:null; let disposed=false;
  const view=(snapshot)=>disposed?{ok:false,reason:'disposed'}:buildSettlementEpisodeDialogueView(snapshot);
  const select=async(snapshot,choiceId)=>{
    if(disposed)return{ok:false,reason:'disposed'}; const result=resolveSettlementEpisodeDialogueSelection(snapshot,choiceId); if(result.ok&&onSelect){try{await onSelect(clone(result));}catch{/* consumer callback is non-authoritative */}} return result;
  };
  const dispose=()=>{disposed=true;};
  return Object.freeze({version:SETTLEMENT_EPISODE_DIALOGUE_PRESENTER_VERSION,view,select,dispose});
}
