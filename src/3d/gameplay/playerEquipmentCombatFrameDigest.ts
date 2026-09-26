/** Observation-only digest over the shipped player equipment/combat frame. */
const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const text=(v,f='none')=>typeof v==='string'&&v.length?v:f;
const stable=(v)=>Number(finite(v,0).toFixed(4));
const equipmentOf=(frame)=>{const e=frame?.equipment||{};return Object.fromEntries(['mainHandId','offHandId','chestId','headId','backId'].map(k=>[k,text(e[k],'')]))};
export function createPlayerEquipmentCombatFrameDigest(frame={}){
 const a=frame.attack||{},d=frame.defense||{},m=frame.movement||{},o=frame.outcome||{};
 return Object.freeze({version:1,revision:Math.max(0,Math.floor(finite(frame.revision))),phase:text(frame.phase),attack:{kind:text(a.kind),comboStep:clamp(Math.floor(finite(a.comboStep)),0,3),active:Boolean(a.active),serial:Math.max(0,Math.floor(finite(a.serial))),ranged:Boolean(a.ranged),twoHanded:Boolean(a.twoHanded)},defense:{guarding:Boolean(d.guarding),result:text(d.result)},movement:{state:text(m.state),grounded:Boolean(m.grounded),speedMps:stable(m.speedMps),staminaRatio:stable(clamp(finite(m.staminaRatio,1),0,1)),poiseRatio:stable(clamp(finite(m.poiseRatio,1),0,1))},equipment:equipmentOf(frame),outcome:{outcome:text(o.outcome),serial:Math.max(0,Math.floor(finite(o.serial)))}});
}
export function playerEquipmentCombatFrameDigestKey(frame={}){return JSON.stringify(createPlayerEquipmentCombatFrameDigest(frame));}
export function isPlayerEquipmentCombatFrameDigest(v){return Boolean(v&&v.version===1&&typeof v.phase==='string'&&v.attack&&typeof v.attack.kind==='string'&&v.movement&&typeof v.movement.state==='string'&&v.equipment&&typeof v.equipment==='object');}
