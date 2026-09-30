/**
 * Settlement campaign coordinator.
 * Coordinates the existing adapters while keeping state mutation delegated.
 */
import { getSettlementService } from './settlementCampaignContent.js';
import { evaluateActionRule, normalizeRpgSnapshot } from './settlementCampaignRules.js';
import { buildSettlementScenarioRun, getSettlementScenarioStep } from './settlementCampaignScenario.js';
import { buildSettlementScenarioCheckpoint } from './settlementCampaignScenario.js';
import { createTradeReceipt, createCraftReceipt, appendSettlementReceipt } from './settlementCampaignReceiptLedger.js';
import { buildSettlementProgressionEnvelope } from './settlementCampaignProgression.js';
import { buildTravelSurvivalEnvelope } from './settlementCampaignSurvival.js';

export const SETTLEMENT_CAMPAIGN_COORDINATOR_VERSION=1;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const integer=(value,min=0,max=999999)=>Math.max(min,Math.min(max,Math.trunc(Number(value)||0)));
const SUCCESS_ACTIONS=new Set(['enter','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save']);

function state(runtime){return normalizeRpgSnapshot(runtime.getViewModel().player);}
function serviceForAction(action){if(['trade','buy','sell'].includes(action))return'market';if(['craft','equip'].includes(action))return'blacksmith';if(['acceptQuest','advanceQuest','talk','rest'].includes(action))return'tavern';if(action==='travel'||action==='enter'||action==='exit')return'gate';if(action==='save'||action==='interact')return'house';if(action==='train')return'barracks';return null;}

export function createSettlementCampaignCoordinator(runtime,options={}){
  if(!runtime||typeof runtime.execute!=='function'||typeof runtime.getViewModel!=='function')throw new TypeError('Runtime is required.');
  let sequence=0;let currentStep=text(options.startStep,'arrival');let receipts=[];let completed=[];let journal=[];let locked=false;
  const record=entry=>{journal=[...journal,{sequence:++sequence,at:typeof options.now==='function'?options.now():Date.now(),...clone(entry)}].slice(-64);};
  const current=()=>getSettlementScenarioStep(currentStep);
  const checkpoint=()=>buildSettlementScenarioCheckpoint(runtime,completed);
  const canExecute=(action,input={})=>{if(locked)return{ok:false,reason:'coordinator-locked'};if(!SUCCESS_ACTIONS.has(action)&&!options.allowCustomActions)return{ok:false,reason:'unknown-action'};const role=serviceForAction(action);if(role&&!getSettlementService(role))return{ok:false,reason:'missing-service'};const rule=evaluateActionRule(action,{snapshot:state(runtime),...input});return{ok:true,action,role,rule};};
  const execute=async(action,input={})=>{const gate=canExecute(action,input);if(!gate.ok){record({type:'blocked',action,reason:gate.reason});return gate;}const result=await runtime.execute(action,{...input,requestId:input.requestId??`coord-${sequence+1}`});record({type:'action',action,role:gate.role,ok:result.ok,reason:result.reason});if(result.ok){const step=current();if(step?.action===action&&!completed.includes(step.id)){completed=[...completed,step.id];record({type:'step-completed',stepId:step.id});}}return result;};
  const advance=()=>{const run=buildSettlementScenarioRun(runtime,{startStep:currentStep});const index=run.steps.findIndex(value=>value.step?.id===currentStep);const next=run.steps[index+1]?.step?.id;if(!next)return{ok:false,reason:'scenario-complete'};currentStep=next;record({type:'step-activated',stepId:next});return{ok:true,step:clone(current())};};
  const travelPreview=(routeId='north_gate')=>buildTravelSurvivalEnvelope(state(runtime),routeId,runtime.getViewModel().panels?.travel?.find(v=>v.id===routeId)?.quote??{},{});
  const progressionPreview=(action='talk',input={})=>buildSettlementProgressionEnvelope({action,snapshot:state(runtime),skillXp:input.skillXp,quality:input.quality,difficulty:input.difficulty,chain:input.chain});
  const receiptFor=(action,input,result)=>{if(!result?.ok)return null;if(['trade','buy','sell'].includes(action))return createTradeReceipt({itemId:input.itemId,quantity:input.quantity,direction:action==='sell'?'sell':'buy',requestId:input.requestId??`coord-${sequence}`,sequence,timestamp:typeof options.now==='function'?options.now():Date.now()});if(action==='craft')return createCraftReceipt({recipeId:input.recipeId,requestId:input.requestId??`coord-${sequence}`,sequence,timestamp:typeof options.now==='function'?options.now():Date.now(),snapshot:state(runtime)});return null;};
  const executeWithReceipt=async(action,input={})=>{const result=await execute(action,input);const receipt=receiptFor(action,input,result);if(receipt?.ok){const added=appendSettlementReceipt(receipts,receipt.receipt);if(added.ok)receipts=added.history;else record({type:'receipt-rejected',reason:added.reason});}return{...result,receipt};};
  const snapshot=()=>({version:1,currentStep,completed:[...completed],receipts:clone(receipts),journal:clone(journal),locked});
  const restore=raw=>{if(raw?.version!==1)return{ok:false,reason:'invalid-coordinator-state'};if(raw.currentStep&&!getSettlementScenarioStep(raw.currentStep))return{ok:false,reason:'unknown-step'};currentStep=text(raw.currentStep,'arrival');completed=Array.isArray(raw.completed)?raw.completed.filter(value=>getSettlementScenarioStep(value)).slice(0,48):[];receipts=Array.isArray(raw.receipts)?raw.receipts.slice(-64):[];journal=Array.isArray(raw.journal)?raw.journal.slice(-64):[];locked=Boolean(raw.locked);return{ok:true,state:snapshot()};};
  const lock=()=>{locked=true;record({type:'lock'});return{ok:true};};const unlock=()=>{locked=false;record({type:'unlock'});return{ok:true};};
  return Object.freeze({version:SETTLEMENT_CAMPAIGN_COORDINATOR_VERSION,current,canExecute,execute,executeWithReceipt,advance,checkpoint,travelPreview,progressionPreview,snapshot,restore,lock,unlock,receipts:()=>clone(receipts),journal:()=>clone(journal)});
}
