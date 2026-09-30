/**
 * Bounded settlement UX telemetry. No gameplay state ownership or PII.
 */
export const SETTLEMENT_TELEMETRY_VERSION=1;
const LIMIT=64;
const text=(value,fallback='')=>{const v=String(value??'').trim();return v?v.slice(0,80):fallback;};
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
export function normalizeSettlementTelemetry(entry={}){const source=entry&&typeof entry==='object'?entry:{};return{version:1,type:text(source.type,'unknown'),action:text(source.action),service:text(source.service),result:source.result===true,code:text(source.code),revision:Number.isInteger(source.revision)?source.revision:0,durationMs:Number.isFinite(Number(source.durationMs))?Math.max(0,Number(source.durationMs)):0};}
export function appendSettlementTelemetry(history=[],entry){const list=Array.isArray(history)?history:[];const normalized=normalizeSettlementTelemetry(entry);return[...list,normalized].slice(-LIMIT);}
export function summarizeSettlementTelemetry(history=[]){const list=(Array.isArray(history)?history:[]).slice(-LIMIT).map(normalizeSettlementTelemetry);const actions={};for(const entry of list){actions[entry.action]=(actions[entry.action]??0)+1;}return{version:1,count:list.length,successes:list.filter(v=>v.result).length,failures:list.filter(v=>!v.result).length,actions,averageDurationMs:list.length?Math.round(list.reduce((sum,v)=>sum+v.durationMs,0)/list.length):0};}
export function buildSettlementTelemetryEnvelope(entry={}){const value=normalizeSettlementTelemetry(entry);return{version:1,event:value,privacy:{containsGameplayPrivateState:false,containsCoordinates:false,containsInventoryContents:false}};}
export function validateSettlementTelemetryEnvelope(envelope){const errors=[];if(envelope?.version!==1)errors.push('version');if(!envelope?.event?.type)errors.push('type');if(envelope?.privacy?.containsGameplayPrivateState!==false)errors.push('privacy');return{ok:errors.length===0,errors};}
export function deterministicSettlementTelemetryDigest(history=[]){const stable=(value)=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(k=>`${k}:${JSON.stringify(value[k])}`).join(',')}}`;let hash=2166136261;const source=stable((Array.isArray(history)?history:[]).slice(-LIMIT).map(normalizeSettlementTelemetry));for(let i=0;i<source.length;i++){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
export function filterSettlementTelemetry(history=[],type=''){return(Array.isArray(history)?history:[]).map(normalizeSettlementTelemetry).filter(entry=>!type||entry.type===text(type));}
