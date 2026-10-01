/** Deterministic multi-impact recoil/camera impulse accumulator. */
import type { CombatPresentationCue } from './combatPresentationV1';
import { criticallyDamped, deterministicHash, type Vec3 } from './deterministicMath';

export interface CombatImpulseConfig { readonly maxImpulses:number; readonly maxYawDegrees:number; readonly maxPitchDegrees:number; readonly maxRecoilMeters:number; readonly decaySeconds:number; }
export interface CombatImpulse { readonly tick:number; readonly priority:number; readonly direction:Readonly<Vec3>; readonly magnitude:number; readonly yawDegrees:number; readonly pitchDegrees:number; readonly recoilMeters:number; readonly cueId:string; }
export interface CombatImpulseState { readonly version:1; readonly tick:number; readonly yawDegrees:number; readonly pitchDegrees:number; readonly recoil:Readonly<Vec3>; readonly shake:number; readonly impulseCount:number; readonly digest:number; }

const DEFAULT:CombatImpulseConfig=Object.freeze({maxImpulses:8,maxYawDegrees:10,maxPitchDegrees:8,maxRecoilMeters:0.18,decaySeconds:0.18});
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;

export class CombatImpulseStack {
  readonly config:CombatImpulseConfig; #impulses:CombatImpulse[]=[]; #tick=-1;
  constructor(config:Partial<CombatImpulseConfig>={}){this.config=Object.freeze({...DEFAULT,...config});}
  addCue(cue:CombatPresentationCue):void{
    if(cue.tick<this.#tick)throw new RangeError('impulse ticks must be monotonic');
    this.#tick=cue.tick;
    const priority=cue.priority;
    const magnitude=clamp(cue.intensity);
    const yaw=clamp(cue.camera.amplitude)* (cue.direction.x<0?-1:1) * (cue.camera.mode==='critical-shake'?3.5:cue.camera.mode==='death-pulse'?2.8:1.6);
    const pitch=(cue.direction.y<0?-1:1)*clamp(cue.camera.amplitude)*(cue.semantic==='stagger'?2.5:1.2);
    const value={tick:cue.tick,priority,direction:Object.freeze({...cue.direction}),magnitude:Number(magnitude.toFixed(4)),yawDegrees:Number(yaw.toFixed(4)),pitchDegrees:Number(pitch.toFixed(4)),recoilMeters:Number(Math.min(this.config.maxRecoilMeters,cue.reaction.recoilMeters).toFixed(4)),cueId:cue.id};
    this.#impulses.push(Object.freeze(value) as CombatImpulse);
    this.#impulses.sort((a,b)=>b.priority-a.priority||b.magnitude-a.magnitude||a.cueId.localeCompare(b.cueId));
    if(this.#impulses.length>this.config.maxImpulses)this.#impulses.splice(this.config.maxImpulses);
  }
  addCues(cues:readonly CombatPresentationCue[]):void{for(const cue of [...cues].sort((a,b)=>a.tick-b.tick||b.priority-a.priority))this.addCue(cue);}
  sample(elapsedSeconds=0):CombatImpulseState{
    const t=clamp(finite(elapsedSeconds,0)/Math.max(0.001,this.config.decaySeconds));
    const decay=1-t;
    let yaw=0,pitch=0,rx=0,ry=0,rz=0,shake=0;
    for(const impulse of this.#impulses){const weight=Math.max(0.05,decay)*(0.65+impulse.priority*0.12);yaw+=impulse.yawDegrees*weight;pitch+=impulse.pitchDegrees*weight;rx+=-impulse.direction.x*impulse.recoilMeters*weight;ry+=-impulse.direction.y*impulse.recoilMeters*weight;rz+=-impulse.direction.z*impulse.recoilMeters*weight;shake=Math.max(shake,impulse.magnitude*weight);}
    const damped=criticallyDamped(1,0,0,this.config.decaySeconds,Math.max(0,finite(elapsedSeconds,0)));
    shake*=clamp(damped.value);
    yaw=Math.max(-this.config.maxYawDegrees,Math.min(this.config.maxYawDegrees,yaw));pitch=Math.max(-this.config.maxPitchDegrees,Math.min(this.config.maxPitchDegrees,pitch));
    const recoilLength=Math.hypot(rx,ry,rz)||1;const maxRecoil=this.config.maxRecoilMeters;const recoilScale=Math.min(1,maxRecoil/recoilLength);
    const digest=deterministicHash([this.#tick,Math.round(yaw*1000),Math.round(pitch*1000),Math.round(rx*10000),Math.round(ry*10000),Math.round(rz*10000),this.#impulses.length]);
    return Object.freeze({version:1 as const,tick:Math.max(0,this.#tick),yawDegrees:Number(yaw.toFixed(4)),pitchDegrees:Number(pitch.toFixed(4)),recoil:Object.freeze({x:Number((rx*recoilScale).toFixed(4)),y:Number((ry*recoilScale).toFixed(4)),z:Number((rz*recoilScale).toFixed(4))}),shake:Number(clamp(shake).toFixed(4)),impulseCount:this.#impulses.length,digest});
  }
  reset():void{this.#impulses=[];this.#tick=-1;}
  snapshot():readonly CombatImpulse[]{return Object.freeze([...this.#impulses]);}
  count():number{return this.#impulses.length;}
}

export function createCombatImpulseStack(config:Partial<CombatImpulseConfig>={}):CombatImpulseStack{return new CombatImpulseStack(config);}
export function validateCombatImpulseState(state:CombatImpulseState):boolean{return state.version===1&&state.tick>=0&&Number.isFinite(state.yawDegrees)&&Math.abs(state.yawDegrees)<=10&&Number.isFinite(state.pitchDegrees)&&Math.abs(state.pitchDegrees)<=8&&[state.recoil.x,state.recoil.y,state.recoil.z].every(Number.isFinite)&&Number.isFinite(state.shake)&&state.shake>=0&&state.shake<=1&&state.impulseCount>=0;}