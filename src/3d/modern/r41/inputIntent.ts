import type{MutationSource}from'./contracts';
export type InputKind='keyboard'|'mouse'|'gamepad'|'touch'|'xr'|'virtual';
export interface InputIntent{readonly id:string;readonly tick:number;readonly kind:InputKind;readonly action:string;readonly value:number;readonly source:MutationSource;readonly sequence:number;}
export class DeterministicInputPipeline{
 #sequence=1;#buffer:InputIntent[]=[];readonly maxBuffer:number;
 constructor(maxBuffer=4096){this.maxBuffer=Math.max(64,Math.trunc(maxBuffer));}
 push(input:{readonly action:string;readonly value:number;readonly deadZone?:number;readonly sensitivity?:number},tick:number,kind:InputKind,source:MutationSource='ui'){if(!input.action.trim()||!Number.isFinite(tick))return null;const dead=clamp(input.deadZone??.08,0,.5);const raw=clamp(input.value,-1,1);const magnitude=Math.abs(raw)<dead?0:Math.sign(raw)*((Math.abs(raw)-dead)/(1-dead));const intent=Object.freeze({id:'input-'+this.#sequence,tick,kind,action:input.action,value:clamp(magnitude*(input.sensitivity??1),-1,1),source,sequence:this.#sequence++});this.#buffer.push(intent);while(this.#buffer.length>this.maxBuffer)this.#buffer.shift();return intent;}
 drain(tick:number){const out=this.#buffer.filter(v=>v.tick<=tick);this.#buffer=this.#buffer.filter(v=>v.tick>tick);return Object.freeze(out);}
 peek(){return Object.freeze([...this.#buffer]);}size(){return this.#buffer.length;}clear(){this.#buffer=[];}
}
function clamp(v:number,min:number,max:number){return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;}
