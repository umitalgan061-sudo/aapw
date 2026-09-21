/** Deterministic shelter/visibility evidence. Read-only. */
import { createWorldActivityContext } from './worldActivityContext.js';
export const WORLD_SHELTER_CONTEXT_VERSION=1;
export const WORLD_SHELTER_TYPES=Object.freeze(['none','lean-to','hut','tavern','house','cave','gatehouse']);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const WEATHER_SHELTER=Object.freeze({clear:.18,cloud:.28,fog:.42,rain:.72,snow:.86,storm:1,wind:.46,sleet:.88});
function shelterType(context,weather){if(context.stage==='inside'||context.stage==='service'){if(context.topActivity==='rest')return context.topActivity==='rest'?'tavern':'house';return'hut';}if(weather==='storm')return'gatehouse';if(['snow','sleet'].includes(weather))return'lean-to';if(weather==='rain')return'hut';return'none';}
function need(context,weather,fatigue){return c(WEATHER_SHELTER[weather]??.4)*.65+c(fatigue/100)*.35;}
function visibility(weather){return{clear:1,cloud:.92,fog:.32,rain:.62,snow:.48,storm:.24,wind:.76,sleet:.4}[weather]??.7;}
export function createWorldShelterContext(options={}){const activity=createWorldActivityContext(options);const fatigue=Math.max(0,Math.min(100,n(options.player?.fatigue)));const weather=activity.weather;const shelter=shelterType(activity,weather);const shelterNeed=need(activity,weather,fatigue);const vis=visibility(weather);const p={version:1,settlementId:activity.settlementId,stage:activity.stage,weather,shelter,shelterNeed,visibility:vis,fatigue,preferred:shelterNeed>.68?shelter:'none',ownership:{readOnly:true,noWorldMutation:true,noShelterSpawn:true,noWeatherMutation:true}};return freeze({...p,fingerprint:digest(p)});}
export function validateWorldShelterContext(v){const s=v&&typeof v==='object'?v:{};const e=[];if(!WORLD_SHELTER_TYPES.includes(s.shelter))e.push('shelter');if(s.shelterNeed<0||s.shelterNeed>1)e.push('need');if(s.visibility<0||s.visibility>1)e.push('visibility');if(!s.ownership?.readOnly||!s.ownership?.noWorldMutation)e.push('ownership');return freeze({ok:e.length===0,errors:e,fingerprint:s.fingerprint??digest(s)});}
export function summarizeWorldShelterContext(o={}){const x=createWorldShelterContext(o);return freeze({settlementId:x.settlementId,stage:x.stage,weather:x.weather,shelter:x.shelter,preferred:x.preferred,shelterNeed:x.shelterNeed,visibility:x.visibility,fingerprint:x.fingerprint});}
export const WORLD_SHELTER_CONTEXT_API=Object.freeze({version:1,types:[...WORLD_SHELTER_TYPES],create:'createWorldShelterContext',validate:'validateWorldShelterContext',summary:'summarizeWorldShelterContext'});
