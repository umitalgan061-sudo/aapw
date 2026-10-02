export interface AudioSourceState{readonly id:string;readonly x:number;readonly y:number;readonly z:number;readonly gain:number;readonly priority:number;}
export interface ListenerState{readonly x:number;readonly y:number;readonly z:number;}
export class SpatialAudioBudget{
 readonly maxVoices:number;readonly maxDistance:number;
 constructor(maxVoices=64,maxDistance=120){this.maxVoices=Math.max(4,Math.trunc(maxVoices));this.maxDistance=Math.max(1,maxDistance);}
 mix(sources:readonly AudioSourceState[],listener:ListenerState){const ranked=sources.map(source=>{const dx=source.x-listener.x,dy=source.y-listener.y,dz=source.z-listener.z;const distance=Math.hypot(dx,dy,dz);return{source,distance,score:source.priority*source.gain/(1+distance*.04)};}).filter(v=>v.distance<=this.maxDistance).sort((a,b)=>b.score-a.score||a.source.id.localeCompare(b.source.id));const active=new Set(ranked.slice(0,this.maxVoices).map(v=>v.source.id));return Object.freeze(ranked.map(v=>Object.freeze({id:v.source.id,distance:v.distance,gain:Math.max(0,Math.min(1,v.source.gain/(1+v.distance*.04))),muted:!active.has(v.source.id),hrtf:v.distance<40})).sort((a,b)=>a.id.localeCompare(b.id)));}
}
