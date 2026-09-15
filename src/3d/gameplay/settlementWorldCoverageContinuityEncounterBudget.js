/** Read-only deterministic presentation-slot budget for settlement boundaries. */
import { createSettlementWorldCoverageContinuityExperience } from './settlementWorldCoverageContinuityExperience.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS = Object.freeze({
  maxSlots: 12,
  maxPrioritySlots: 4,
  mobileScale: 0.62,
  minScore: 0.35,
});
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const t=(v,d='')=>{const s=String(v??'').trim();return s?s.slice(0,140):d;};
const c=(v,d=0)=>Math.max(0,Math.min(1,n(v,d)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261;const s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const stageWeight=s=>({far:.58,approach:.72,threshold:.92,inside:1,service:1,departure:.74,resume:.86}[s]??.5);
const cueWeight=q=>Math.round(c(q?.score)*.7+c(n(q?.priority,q?.score))*.3*1000)/1000;
const role=c=>({gateway:'navigation',warning:'navigation',service:'interaction',road:'travel',route:'travel',checkpoint:'resume'}[t(c?.type,'ambient')]??'atmosphere');
const cost=(r,m)=>Math.round((({navigation:1.05,interaction:1.1,travel:.95,resume:.9,atmosphere:.72}[r]??.8)*(m?.62:1))*100)/100;

function candidates(experience,mobile){
  return experience.quickCues.map((cue,index)=>{const r=role(cue);return{
    id:`encounter:${cue.id}`,rank:index+1,sourceId:cue.id,type:cue.type,role:r,label:cue.label,copy:cue.copy,
    score:Math.round(cueWeight(cue)*stageWeight(experience.stage)*1000)/1000,cost:cost(r,mobile),metadata:cue.metadata,
  };}).filter(x=>x.score>=SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.minScore)
    .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
function choose(rows,mobile){
  const max=mobile?8:12,slots=[],roles=new Set();let budgetCost=0;
  for(const row of rows){
    const penalty=roles.has(row.role)?.08:0;
    const next=Math.round((budgetCost+row.cost+penalty)*100)/100;
    if(slots.length>=max||next>max*.98)continue;
    slots.push({...row,selectedScore:Math.round(Math.max(0,row.score-penalty)*1000)/1000});roles.add(row.role);budgetCost=next;
  }
  return {slots,budgetCost,max};
}
function priorities(slots){
  return slots.slice(0,4).map((x,i)=>({rank:i+1,id:x.id,role:x.role,score:x.selectedScore,label:x.label}));
}

export function createSettlementWorldCoverageContinuityEncounterBudget(options={}){
  const mobile=Boolean(options.mobile),experience=createSettlementWorldCoverageContinuityExperience(options);
  const rows=candidates(experience,mobile),selected=choose(rows,mobile);
  const result={
    version:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_VERSION,settlementId:experience.settlementId,
    stage:experience.stage,mode:experience.mode,mobile,readiness:experience.readiness,candidateCount:rows.length,
    selectedCount:selected.slots.length,maxSlots:selected.max,budgetCost:selected.budgetCost,
    roles:Object.freeze([...new Set(selected.slots.map(x=>x.role))]),prioritySlots:priorities(selected.slots),slots:selected.slots,
    ownership:{readOnly:true,noNpcSpawn:true,noCombatMutation:true,noSaveMutation:true},
  };
  return freeze({...result,fingerprint:digest(result)});
}

export function validateSettlementWorldCoverageContinuityEncounterBudget(options={}){
  const b=createSettlementWorldCoverageContinuityEncounterBudget(options),errors=[];
  if(b.selectedCount>b.maxSlots)errors.push('slot-cap');
  if(b.prioritySlots.length>SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_LIMITS.maxPrioritySlots)errors.push('priority-cap');
  if(b.budgetCost<0)errors.push('negative-cost');
  if(!b.ownership.readOnly||!b.ownership.noNpcSpawn||!b.ownership.noSaveMutation)errors.push('ownership');
  const ids=b.slots.map(x=>x.id);
  if(new Set(ids).size!==ids.length)errors.push('duplicate-slot-id');
  if(b.slots.some(x=>x.score<0||x.score>1))errors.push('score-range');
  return freeze({ok:errors.length===0,errors,settlementId:b.settlementId,selectedCount:b.selectedCount,budgetCost:b.budgetCost,fingerprint:b.fingerprint});
}

export function summarizeSettlementWorldCoverageContinuityEncounterBudget(options={}){
  const b=createSettlementWorldCoverageContinuityEncounterBudget(options);
  return freeze({settlementId:b.settlementId,stage:b.stage,mode:b.mode,mobile:b.mobile,selectedCount:b.selectedCount,maxSlots:b.maxSlots,
    roles:b.roles,priorityCount:b.prioritySlots.length,budgetCost:b.budgetCost,topSlot:b.slots[0]?.id??null,fingerprint:b.fingerprint});
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_API=Object.freeze({
  version:SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ENCOUNTER_BUDGET_VERSION,maxSlots:12,maxPrioritySlots:4,
  planner:'createSettlementWorldCoverageContinuityEncounterBudget',validate:'validateSettlementWorldCoverageContinuityEncounterBudget',
  summary:'summarizeSettlementWorldCoverageContinuityEncounterBudget',
});
