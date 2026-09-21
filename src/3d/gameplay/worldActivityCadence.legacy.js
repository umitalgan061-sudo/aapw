/** Deterministic, read-only cadence planner for environmental activities. */
import { createWorldActivityContext } from './worldActivityContext.js';
export const WORLD_ACTIVITY_CADENCE_VERSION=1;
export const WORLD_ACTIVITY_CADENCE_STATES=Object.freeze(['silent','calm','active','urgent','sheltered']);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const c=v=>Math.max(0,Math.min(1,n(v)));
const freeze=(v,s=new Set())=>{if(!v||typeof v!=='object'||s.has(v))return v;s.add(v);Object.freeze(v);for(const x of Object.values(v))freeze(x,s);return v;};
const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?`[${v.map(stable).join(',')}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest=v=>{let h=2166136261,s=stable(v);for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const HOUR_STATE=Object.freeze({preDawn:.42,dawn:.66,morning:.82,midday:.9,afternoon:.86,dusk:.7,evening:.58,night:.4});
function hourPhase(hour){const h=((n(hour,12)%24)+24)%24; if(h<5)return'preDawn';if(h<7)return'dawn';if(h<11)return'morning';if(h<14)return'midday';if(h<18)return'afternoon';if(h<20)return'dusk';if(h<23)return'evening';return'night';}
function stateFor(context,phase,weather){if(context.topActivity==='rest'&&['snow','sleet','storm'].includes(weather))return'sheltered';if(weather==='storm')return'urgent';if(context.activityCount===0)return'silent';if(HOUR_STATE[phase]<.5)return'calm';return context.activityCount>=6?'active':'calm';}
function pulse(state){return{silent:0,calm:.32,active:.68,urgent:1,sheltered:.44}[state]??.3;}
function interval(state,mobile){const base={silent:18,calm:10,active:6,urgent:2,sheltered:8}[state]??10;return Math.max(1,Math.round(base*(mobile?.75:1)));}
export function createWorldActivityCadence(options={}){const context=createWorldActivityContext(options);const hour=n(options.hour,12);const phase=hourPhase(hour);const weather=context.weather;const state=stateFor(context,phase,weather);const p={version:1,settlementId:context.settlementId,stage:context.stage,phase,state,pulse:pulse(state),cadenceSeconds:interval(state,Boolean(options.mobile)),weather,topActivity:context.topActivity,activityCount:context.activityCount,signals:context.signals.slice(0,6),ownership:{readOnly:true,noTimerOwnership:true,noWorldMutation:true,noActorSpawn:true}};return freeze({...p,fingerprint:digest(p)});}
export function validateWorldActivityCadence(v){const s=v&&typeof v==='object'?v:{};const e=[];if(!WORLD_ACTIVITY_CADENCE_STATES.includes(s.state))e.push('state');if(s.pulse<0||s.pulse>1)e.push('pulse');if(s.cadenceSeconds<1)e.push('cadence');if(!s.ownership?.readOnly||!s.ownership?.noWorldMutation)e.push('ownership');return freeze({ok:e.length===0,errors:e,fingerprint:s.fingerprint??digest(s)});}
export function summarizeWorldActivityCadence(o={}){const x=createWorldActivityCadence(o);return freeze({settlementId:x.settlementId,stage:x.stage,phase:x.phase,state:x.state,pulse:x.pulse,cadenceSeconds:x.cadenceSeconds,weather:x.weather,topActivity:x.topActivity,fingerprint:x.fingerprint});}
export const WORLD_ACTIVITY_CADENCE_API=Object.freeze({version:1,states:[...WORLD_ACTIVITY_CADENCE_STATES],create:'createWorldActivityCadence',validate:'validateWorldActivityCadence',summary:'summarizeWorldActivityCadence'});
