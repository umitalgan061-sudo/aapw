/**
 * Shipped-runtime snapshot compositor for settlement episodes.
 *
 * The compositor is deliberately read-only: it calls existing projections and
 * produces one deterministic payload for a browser/UI integration point. It
 * does not create gameplay state, three.js objects, DOM nodes or persistence.
 */
import { buildSettlementEpisodePresentation } from './settlementEpisodePresentationModel.js';
import { buildSettlementEpisodeDialogueView } from './settlementEpisodeDialoguePresenter.js';
import { buildSettlementEpisodeJourneyCard } from './settlementEpisodeJourney.js';
import { buildSettlementEpisodeProgression, buildSettlementEpisodeProgressionBanner } from './settlementEpisodeProgression.js';
import { buildSettlementEpisodeSavePrompt, buildSettlementEpisodeSaveButton } from './settlementEpisodeSavePolicy.js';
import { getSettlementEpisodeHandoffCase } from './settlementEpisodeHandoffContract.js';
import { buildSettlementEpisodeCheckpoint, validateSettlementEpisodeCheckpoint, inspectSettlementEpisodeCheckpoint } from './settlementEpisodeCheckpoint.js';

export const SETTLEMENT_EPISODE_RUNTIME_SNAPSHOT_VERSION=1;
export const SETTLEMENT_EPISODE_RUNTIME_SNAPSHOT_LIMITS=Object.freeze({history:12,text:180,episodes:6});
const clone=(value)=>value==null?value:JSON.parse(JSON.stringify(value));
const freeze=(value)=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const child of Object.values(value))freeze(child);return value;};
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,180):fallback;};
function stable(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return`[${value.map(stable).join(',')}]`;return`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;}
function digest(value){let hash=2166136261;const source=stable(value);for(let index=0;index<source.length;index+=1){hash^=source.charCodeAt(index);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
function normalizeRuntime(runtimeView){const source=runtimeView&&typeof runtimeView==='object'?runtimeView:{};return{activeService:text(source.activeService),panel:text(source.panel,'overview'),feedback:clone(source.feedback??null),lastAction:clone(source.lastAction??null),history:Array.isArray(source.history)?clone(source.history).slice(-12):[],route:Array.isArray(source.route)?source.route.map((entry)=>text(entry)).filter(Boolean).slice(-24):[]};}
function buildCheckpointProof(snapshot,runtimeExport){if(!runtimeExport)return{available:false,valid:false,reason:'runtime-export-unavailable'};const checkpoint=buildSettlementEpisodeCheckpoint(snapshot,runtimeExport);const validation=validateSettlementEpisodeCheckpoint(checkpoint);const inspection=validation.ok?inspectSettlementEpisodeCheckpoint(checkpoint):null;return{available:true,valid:validation.ok,checksum:checkpoint.checksum,errors:clone(validation.errors),inspection:clone(inspection)};}
function buildOwnershipProof(){return{episodeOwner:'settlementEpisodeRuntimeSnapshot',questOwner:'settlementCampaignQuestChains',runtimeOwner:'settlementCampaignRuntime',dialogueOwner:'settlementEpisodeDialogueContent',worldPlacementContract:'shared-material-placement-v1',stateMutationOwner:'existing-runtime-handlers',threeDAssetAdded:false};}

export function buildSettlementEpisodeRuntimeSnapshot({directorSnapshot,runtimeView={},runtimeExportState=null,questSnapshot={}}={}){
 const director=directorSnapshot&&typeof directorSnapshot==='object'?directorSnapshot:{};const presentation=buildSettlementEpisodePresentation(director);const dialogue=buildSettlementEpisodeDialogueView(director);const journey=buildSettlementEpisodeJourneyCard(director.episodeId);const progression=buildSettlementEpisodeProgression(questSnapshot);const progressionBanner=buildSettlementEpisodeProgressionBanner(questSnapshot);const savePrompt=buildSettlementEpisodeSavePrompt(director,'manual-request');const saveButton=buildSettlementEpisodeSaveButton(director,'manual-request');const handoff=getSettlementEpisodeHandoffCase(director.beat?.stepId);const runtime=normalizeRuntime(runtimeView);const checkpoint=buildCheckpointProof(director,runtimeExportState);
 const payload={version:SETTLEMENT_EPISODE_RUNTIME_SNAPSHOT_VERSION,episodeId:text(director.episodeId),stepId:text(director.beat?.stepId),phase:text(director.phase,'idle'),revision:Number(director.revision)||0,runtime,presentation,dialogue:dialogue.ok?dialogue:null,journey:journey?.ok?journey:null,progression,progressionBanner,save:{prompt:savePrompt,button:saveButton},handoff:handoff?clone(handoff):null,checkpoint,ownership:buildOwnershipProof()};
 const digestInput={episodeId:payload.episodeId,stepId:payload.stepId,phase:payload.phase,revision:payload.revision,presentation:payload.presentation,dialogue:payload.dialogue,journey:payload.journey,progression:payload.progression,save:payload.save,handoff:payload.handoff};return freeze({...payload,digest:digest(digestInput)});
}
export function buildSettlementEpisodeRuntimeSnapshotDigest(snapshot){if(!snapshot||typeof snapshot!=='object')return null;return digest({episodeId:snapshot.episodeId,stepId:snapshot.stepId,phase:snapshot.phase,revision:snapshot.revision,presentation:snapshot.presentation,dialogue:snapshot.dialogue,journey:snapshot.journey,progression:snapshot.progression,save:snapshot.save,handoff:snapshot.handoff});}
export function validateSettlementEpisodeRuntimeSnapshot(snapshot){const errors=[];const source=snapshot&&typeof snapshot==='object'?snapshot:{};if(Number(source.version)!==SETTLEMENT_EPISODE_RUNTIME_SNAPSHOT_VERSION)errors.push('version');if(text(source.digest)!==buildSettlementEpisodeRuntimeSnapshotDigest(source))errors.push('digest');if(!source.presentation)errors.push('presentation');if(!source.ownership)errors.push('ownership');if(!source.progression)errors.push('progression');if(!source.save?.prompt||!source.save?.button)errors.push('save');if(source.handoff&&source.stepId!==source.handoff.stepId)errors.push('handoff-step');return{ok:errors.length===0,errors};}
export function buildSettlementEpisodeRuntimeSnapshotProof(snapshot){const validation=validateSettlementEpisodeRuntimeSnapshot(snapshot);return freeze({ok:validation.ok,errors:validation.errors,digest:validation.ok?sourceDigest(snapshot):text(snapshot?.digest),components:{presentation:Boolean(snapshot?.presentation),dialogue:Boolean(snapshot?.dialogue),journey:Boolean(snapshot?.journey),progression:Boolean(snapshot?.progression),save:Boolean(snapshot?.save),handoff:Boolean(snapshot?.handoff),checkpoint:Boolean(snapshot?.checkpoint?.available)}});}
function sourceDigest(snapshot){return buildSettlementEpisodeRuntimeSnapshotDigest(snapshot);}
export function createSettlementEpisodeRuntimeSnapshotResolver(){return Object.freeze({version:SETTLEMENT_EPISODE_RUNTIME_SNAPSHOT_VERSION,build:buildSettlementEpisodeRuntimeSnapshot,digest:buildSettlementEpisodeRuntimeSnapshotDigest,validate:validateSettlementEpisodeRuntimeSnapshot,proof:buildSettlementEpisodeRuntimeSnapshotProof});}
