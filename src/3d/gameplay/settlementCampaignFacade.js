/**
 * Director facade for the settlement vertical slice.
 * Composes existing adapters; it does not become an RPG system owner.
 */
import { createSettlementCampaignUiModel } from './settlementCampaignUiModel.js';
import { createSettlementJourneyController } from './settlementCampaignJourney.js';
import { buildSettlementDialogueGraph } from './settlementCampaignDialogue.js';
import { buildSettlementInteractionMatrix } from './settlementCampaignInteractionMatrix.js';
import { buildSettlementInteriorManifest } from './settlementCampaignInterior.js';
import { buildSettlementShopCatalog } from './settlementCampaignShop.js';
import { buildSettlementProgressionEnvelope } from './settlementCampaignProgression.js';
import { buildSurvivalReport } from './settlementCampaignSurvival.js';
import { createSettlementCampaignSavePayload } from './settlementCampaignSaveAdapter.js';

export const SETTLEMENT_CAMPAIGN_FACADE_VERSION=1;
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const integer=(value,min=0,max=999999)=>Math.max(min,Math.min(max,Math.trunc(Number(value)||0)));
export function createSettlementCampaignFacade(runtime,options={}){
  if(!runtime||typeof runtime.getViewModel!=='function')throw new TypeError('Settlement campaign runtime required.');
  const ui=createSettlementCampaignUiModel(runtime);const journey=createSettlementJourneyController(runtime);const interaction=buildSettlementInteractionMatrix();const interior=buildSettlementInteriorManifest();
  const readSnapshot=()=>runtime.getViewModel().player??{};
  const model=()=>{const view=runtime.getViewModel();const snapshot=readSnapshot();return{version:1,runtimeVersion:view.version,contentVersion:view.contentVersion,revision:view.revision,ui:ui.build(),journey:journey.state(),dialogue:buildSettlementDialogueGraph(snapshot,{root:options.dialogueRoot}),interaction,interior,shop:buildSettlementShopCatalog(snapshot,{direction:options.shopDirection==='buy'?'buy':'sell'}),progression:buildSettlementProgressionEnvelope({action:view.lastAction??'talk',snapshot}),survival:buildSurvivalReport(snapshot,{restService:view.activeService?.id??'tavern'}),runtimeState:runtime.exportState?.()??null};};
  const can(action,context={})=>{const view=runtime.getViewModel();const actionList=view.availableActions??[];return{ok:actionList.includes(action),action,activeService:view.activeService?.id??null,reason:actionList.includes(action)?'':'action-unavailable',context:clone(context)};};
  const execute=async(action,input={})=>{const gate=can(action,input);if(!gate.ok)return gate;return runtime.execute(action,input);};
  const enter=serviceId=>runtime.open(serviceId,options.panel??'overview');
  const save=async(metadata={})=>{const payload=createSettlementCampaignSavePayload(runtime,metadata);if(!payload.ok)return payload;const result=await runtime.save({...metadata,requestId:metadata.requestId??`facade-save-${integer(runtime.getViewModel().revision+1)}`});return{...result,savePayload:payload};};
  const reset=()=>runtime.reset();
  const dispose=()=>runtime.dispose();
  return Object.freeze({version:SETTLEMENT_CAMPAIGN_FACADE_VERSION,model,can,execute,enter,save,reset,dispose,ui,journey,interaction,interior});
}
export function buildSettlementDirectorSummary(facade){const value=facade.model();return{version:value.version,revision:value.revision,service:text(value.ui.service?.id),panel:text(value.ui.header?.title),journeyStage:text(value.journey.stage),availableActions:(value.ui.actions??[]).filter(v=>v.enabled).map(v=>v.action),questCount:value.ui.quests?.length??0,inventoryItems:value.ui.inventory?.length??0,survivalHealthy:value.survival?.healthy===true,placementRoles:value.interior?.interiors?.length??0};}
