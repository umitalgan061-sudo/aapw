/**
 * Authoring audit for the settlement vertical slice.
 * Turns the director requirements into deterministic, machine-checkable facts.
 */
import { createSettlementContentManifest, validateSettlementContent, getSettlementService, getSettlementItem, getSettlementRecipe, getSettlementRoute } from './settlementCampaignContent.js';
import { buildSettlementInteriorManifest, validateSettlementInteriorContract } from './settlementCampaignInterior.js';
import { buildSettlementInteractionMatrix, validateSettlementInteractionMatrix } from './settlementCampaignInteractionMatrix.js';
import { validateSettlementScenario, buildSettlementScenarioManifest } from './settlementCampaignScenario.js';
import { buildContractManifest, validateContractManifest } from './settlementCampaignContracts.js';

export const SETTLEMENT_AUTHORING_AUDIT_VERSION = 1;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,160):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const REQUIRED_ROLES=['blacksmith','tavern','market','farm','barracks','stable','house','gate'];
const REQUIRED_DOMAINS=Object.freeze({blacksmith:'smithing',tavern:'rest-dialogue',market:'trade',farm:'survival',barracks:'training',stable:'mount-travel',house:'persistence',gate:'travel'});
const REQUIRED_FUNCTIONAL_ACTIONS=Object.freeze({blacksmith:['craft','trade'],tavern:['talk','acceptQuest','rest'],market:['trade','buy','sell'],farm:['rest','travel'],barracks:['train','acceptQuest'],stable:['travel','rest'],house:['save','rest'],gate:['enter','travel']});

export function auditSettlementServices() {
  const errors=[];const rows=[];
  for(const role of REQUIRED_ROLES){const service=getSettlementService(role);if(!service){errors.push(`missing:${role}`);continue;}if(service.domain!==REQUIRED_DOMAINS[role])errors.push(`domain:${role}`);for(const action of REQUIRED_FUNCTIONAL_ACTIONS[role])if(!service.actions.includes(action))errors.push(`action:${role}:${action}`);rows.push({id:role,label:service.label,kind:service.kind,domain:service.domain,actions:[...service.actions]});}
  return{ok:errors.length===0,errors,rows};
}

export function auditSettlementEconomy() {
  const errors=[];const content=createSettlementContentManifest();const rows=[];
  for(const id of content.items){const item=getSettlementItem(id);if(!item){errors.push(`item:${id}`);continue;}if(item.buy<item.sell)errors.push(`negative-margin:${id}`);if(item.weight<=0)errors.push(`weight:${id}`);rows.push({id,label:item.label,buy:item.buy,sell:item.sell,margin:item.buy-item.sell,weight:item.weight});}
  return{ok:errors.length===0,errors,rows,totalItems:rows.length};
}

export function auditSettlementRecipes() {
  const errors=[];const rows=[];for(const id of ['iron_sword','iron_dagger','steel_buckle','linen_tunic','leather_gloves','travel_rations']){const recipe=getSettlementRecipe(id);if(!recipe){errors.push(`recipe:${id}`);continue;}if(!Object.keys(recipe.ingredients).length)errors.push(`ingredients:${id}`);if(recipe.xp<=0)errors.push(`xp:${id}`);if(recipe.minutes<=0)errors.push(`time:${id}`);rows.push({id,station:recipe.station,ingredients:clone(recipe.ingredients),xp:recipe.xp,minutes:recipe.minutes});}return{ok:errors.length===0,errors,rows};
}

export function auditSettlementRoutes() {
  const errors=[];const rows=[];for(const id of ['north_gate','river_market','hill_fort','old_mill','east_road','winter_pass']){const route=getSettlementRoute(id);if(!route){errors.push(`route:${id}`);continue;}if(route.cost<=0)errors.push(`cost:${id}`);if(route.fatigue<=0)errors.push(`fatigue:${id}`);if(!route.checkpoint)errors.push(`checkpoint:${id}`);rows.push({id,destination:route.destination,cost:route.cost,fatigue:route.fatigue,risk:route.risk,checkpoint:route.checkpoint});}return{ok:errors.length===0,errors,rows};
}

export function auditSettlementAuthoring() {
  const content=validateSettlementContent();const services=auditSettlementServices();const economy=auditSettlementEconomy();const recipes=auditSettlementRecipes();const routes=auditSettlementRoutes();const interiorManifest=buildSettlementInteriorManifest();const interiors=validateSettlementInteriorContract(interiorManifest);const interaction=validateSettlementInteractionMatrix(buildSettlementInteractionMatrix());const scenario=validateSettlementScenario();const contract=validateContractManifest(buildContractManifest());
  const checks={content,services,economy,recipes,routes,interiors,interaction,scenario,contract};
  const failed=Object.entries(checks).filter(([,result])=>!result.ok).map(([name])=>name);
  return{version:1,ok:failed.length===0,failed,checks,manifest:{content:createSettlementContentManifest(),interior:interiorManifest,interaction:buildSettlementInteractionMatrix(),scenario:buildSettlementScenarioManifest()}};
}

export function summarizeSettlementAuthoring(audit) {
  const value=audit&&typeof audit==='object'?audit:{};const checks=value.checks??{};const passed=Object.values(checks).filter(result=>result?.ok===true).length;const total=Object.keys(checks).length;return{ok:value.ok===true,passed,total,failed:value.failed??[],services:value.checks?.services?.rows?.length??0,items:value.checks?.economy?.totalItems??0,recipes:value.checks?.recipes?.rows?.length??0,routes:value.checks?.routes?.rows?.length??0};
}

export function buildAuthoringEvidence(audit) {
  const summary=summarizeSettlementAuthoring(audit);return{version:SETTLEMENT_AUTHORING_AUDIT_VERSION,summary,source:'settlement-campaign-authoring',deterministic:true,requiredRoles:[...REQUIRED_ROLES],requiredDomains:{...REQUIRED_DOMAINS},functionalActions:clone(REQUIRED_FUNCTIONAL_ACTIONS),noRuntimeEditorImports:true};
}

export function validateAuthoringEvidence(evidence) {
  const errors=[];if(evidence?.version!==1)errors.push('version');if(evidence?.summary?.ok!==true)errors.push('audit-failed');if(evidence?.noRuntimeEditorImports!==true)errors.push('editor-boundary');if(evidence?.deterministic!==true)errors.push('determinism');for(const role of REQUIRED_ROLES)if(!evidence.requiredRoles?.includes(role))errors.push(`role:${role}`);return{ok:errors.length===0,errors};
}

export function compareAuthoringAudits(before,after){const left=summarizeSettlementAuthoring(before);const right=summarizeSettlementAuthoring(after);return{improved:right.passed-left.passed,passedBefore:left.passed,passedAfter:right.passed,failedBefore:left.failed,failedAfter:right.failed,changed:JSON.stringify(left)!==JSON.stringify(right)};}
