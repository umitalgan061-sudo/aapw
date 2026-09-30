import type { FrameId, InputIntent, RawInputSample, RuntimeSnapshot, TickId } from './liveCoreTypes.ts';
import { deepFreeze, frameId, stableHash, tickId, vec3 } from './liveCoreTypes.ts';

export interface ReplayCommand { readonly sequence:number; readonly tick:TickId; readonly sample:RawInputSample; readonly digest:string; }
export interface ReplayCheckpoint { readonly frame:FrameId; readonly tick:TickId; readonly snapshot:RuntimeSnapshot; readonly journalDigest:string; }
export interface ReplayReport { readonly ok:boolean; readonly commands:number; readonly checkpoints:number; readonly firstMismatchSequence?:number; readonly expectedDigest?:string; readonly actualDigest?:string; readonly replayDigest:string; readonly errors:readonly string[]; }
export interface ReplayPolicy { readonly maxCommands:number; readonly maxCheckpoints:number; readonly checkpointIntervalTicks:number; readonly maxBranchDepth:number; }
export const DEFAULT_REPLAY_POLICY:ReplayPolicy=Object.freeze({maxCommands:8192,maxCheckpoints:128,checkpointIntervalTicks:60,maxBranchDepth:8});

const cloneSample=(sample:RawInputSample):RawInputSample=>deepFreeze({
  source:sample.source,
  ...(sample.moveX!==undefined?{moveX:sample.moveX}:{}),
  ...(sample.moveY!==undefined?{moveY:sample.moveY}:{}),
  ...(sample.lookX!==undefined?{lookX:sample.lookX}:{}),
  ...(sample.lookY!==undefined?{lookY:sample.lookY}:{}),
  ...(sample.zoom!==undefined?{zoom:sample.zoom}:{}),
  ...(sample.held?{held:[...sample.held]}:{}),
  ...(sample.pressed?{pressed:[...sample.pressed]}:{}),
  ...(sample.released?{released:[...sample.released]}:{}),
  ...(sample.timestampSeconds!==undefined?{timestampSeconds:sample.timestampSeconds}:{}),
});

export class StrictReplayRuntime {
  #policy:ReplayPolicy; #commands:ReplayCommand[]=[]; #checkpoints:ReplayCheckpoint[]=[]; #branches=new Map<string,ReplayCommand[]>(); #disposed=false;
  constructor(policy:ReplayPolicy=DEFAULT_REPLAY_POLICY){this.#policy=Object.freeze({...policy});}
  append(tick:number,sequence:number,sample:RawInputSample):ReplayCommand|null{if(this.#disposed)return null;const safeTick=tickId(tick);const safeSequence=Math.max(0,Math.floor(sequence));const safeSample=cloneSample(sample);const command=deepFreeze({sequence:safeSequence,tick:safeTick,sample:safeSample,digest:stableHash({sequence:safeSequence,tick:safeTick,sample:safeSample})});const last=this.#commands.at(-1);if(last&&command.sequence<=last.sequence)return null;this.#commands.push(command);if(this.#commands.length>this.#policy.maxCommands)this.#commands.shift();return command;}
  checkpoint(snapshot:RuntimeSnapshot):ReplayCheckpoint|null{if(this.#disposed)return null;const checkpoint=deepFreeze({frame:snapshot.frame,tick:snapshot.tick,snapshot,journalDigest:this.journalDigest()});this.#checkpoints.push(checkpoint);if(this.#checkpoints.length>this.#policy.maxCheckpoints)this.#checkpoints.shift();return checkpoint;}
  shouldCheckpoint(tick:number):boolean{return tick>0&&tick%Math.max(1,this.#policy.checkpointIntervalTicks)===0;}
  journalDigest():string{return stableHash(this.#commands.map(({sequence,tick,sample,digest})=>({sequence,tick,sample,digest})));}
  replayDigest():string{return stableHash({journal:this.journalDigest(),checkpoints:this.#checkpoints.map(c=>({frame:c.frame,tick:c.tick,digest:c.snapshot.digest,journal:c.journalDigest}))});}
  verify(commands:readonly ReplayCommand[]=this.#commands,checkpoints:readonly ReplayCheckpoint[]=this.#checkpoints):ReplayReport{const errors:string[]=[];let previous=-1;for(const command of commands){if(command.sequence<=previous)errors.push('command-sequence-not-monotonic');previous=command.sequence;const expected=stableHash({sequence:command.sequence,tick:command.tick,sample:command.sample});if(expected!==command.digest)errors.push('command-digest-mismatch:'+command.sequence);}for(const checkpoint of checkpoints){if(!checkpoint.snapshot?.digest)errors.push('checkpoint-missing-digest');if(checkpoint.journalDigest!==this.journalDigest()&&checkpoint!==this.#checkpoints.at(-1))errors.push('checkpoint-journal-mismatch:'+checkpoint.frame);}return Object.freeze({ok:errors.length===0,commands:commands.length,checkpoints:checkpoints.length,replayDigest:this.replayDigest(),errors:Object.freeze(errors)});}
  createBranch(id:string,fromSequence:number):readonly ReplayCommand[]{if(this.#disposed)return [];if(this.#branches.size>=this.#policy.maxBranchDepth)return [];const safeId=id.trim().slice(0,64);if(!safeId)return [];const commands=this.#commands.filter(c=>c.sequence<=fromSequence).map(c=>deepFreeze({...c,sample:cloneSample(c.sample)}));this.#branches.set(safeId,commands);return Object.freeze([...commands]);}
  branch(id:string):readonly ReplayCommand[]{return Object.freeze([...(this.#branches.get(id)||[])]);}
  branchAppend(id:string,tick:number,sequence:number,sample:RawInputSample):ReplayCommand|null{const branch=this.#branches.get(id);if(!branch||branch.length>=this.#policy.maxCommands)return null;const command=deepFreeze({sequence:Math.max(0,Math.floor(sequence)),tick:tickId(tick),sample:cloneSample(sample),digest:stableHash({sequence,tick:tickId(tick),sample})});const last=branch.at(-1);if(last&&command.sequence<=last.sequence)return null;branch.push(command);return command;}
  nearestCheckpoint(tick:number):ReplayCheckpoint|null{let best:ReplayCheckpoint|null=null;for(const checkpoint of this.#checkpoints)if(Number(checkpoint.tick)<=tick&&(!best||Number(checkpoint.tick)>Number(best.tick)))best=checkpoint;return best;}
  reset(){this.#commands=[];this.#checkpoints=[];this.#branches.clear();}
  dispose(){this.#disposed=true;this.reset();}
}

export const replayInputIntentDigest=(intent:InputIntent)=>stableHash({source:intent.source,move:intent.move,look:intent.look,held:[...intent.held].sort(),pressed:[...intent.pressed].sort(),released:[...intent.released].sort(),sequence:intent.sequence});
void frameId; void vec3;