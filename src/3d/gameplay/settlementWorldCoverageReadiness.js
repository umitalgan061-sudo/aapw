/**
 * Settlement World Coverage UX readiness projection.
 *
 * This module consumes the existing World Coverage plan only. It owns no
 * settlement state, quest state, inventory mutation, economy, crafting,
 * travel, save/load or model/material placement authority.
 */
import { createSettlementWorldCoveragePlan } from './settlementWorldCoverageSlice.js';

export const SETTLEMENT_WORLD_COVERAGE_READINESS_VERSION = 1;
const PRIORITY = Object.freeze({ trade: 40, quests: 35, craft: 30, travel: 25, rest: 20, train: 18 });
const freeze=(value)=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const text=(value,fallback='')=>{const normalized=String(value??'').trim();return normalized?normalized.slice(0,120):fallback;};
const stable=(value)=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest=(value)=>{let hash=2166136261;const source=stable(value);for(let i=0;i<source.length;i+=1){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');};

function candidates(plan){
  const rows=[];
  const push=(serviceId,intent,score,reason)=>rows.push({serviceId,intent,score,reason});
  for(const row of plan.services){
    if(row.status==='blocked'||row.status==='available-blocked')continue;
    const primary=row.primaryIntent;
    const serviceScore=PRIORITY[row.domain?.includes('smith')?'craft':row.domain?.includes('trade')?'trade':row.domain?.includes('rest')?'rest':row.domain?.includes('training')?'train':row.domain?.includes('mount')?'travel':'quests']??10;
    push(row.id,primary,serviceScore+(row.status==='ready'?10:0),row.status);
  }
  for(const quest of plan.objectives??[])if(!quest.complete)push('tavern',text(quest.action,'advanceQuest'),35+(quest.ratio??0)*10,'quest-objective');
  return rows.sort((a,b)=>b.score-a.score||a.serviceId.localeCompare(b.serviceId)||a.intent.localeCompare(b.intent)).slice(0,8);
}

export function createSettlementWorldCoverageReadiness(input={}){
  const plan=createSettlementWorldCoveragePlan(input);
  const candidatesList=candidates(plan);
  const selected=candidatesList[0]??null;
  const safeFallback=plan.services.find(row=>!['blocked','available-blocked'].includes(row.status))?.id??'gate';
  const output={version:SETTLEMENT_WORLD_COVERAGE_READINESS_VERSION,settlementId:plan.settlementId,locationId:plan.locationId,selected,alternatives:candidatesList.slice(1),safeFallback,blockedServices:plan.services.filter(row=>row.status==='blocked').map(row=>row.id),summary:{candidateCount:candidatesList.length,readyServices:plan.serviceSummary.ready,partialServices:plan.serviceSummary.partial,interactionable:candidatesList.length>0}};
  return freeze({...output,fingerprint:digest(output)});
}

export function createSettlementWorldCoverageQuickActions(readiness={}, limit=3){
  const rows=[readiness.selected,...(readiness.alternatives??[])].filter(Boolean).slice(0,Math.max(1,limit));
  return freeze(rows.map(row=>({serviceId:row.serviceId,intent:row.intent,reason:text(row.reason,'ready')})));
}
