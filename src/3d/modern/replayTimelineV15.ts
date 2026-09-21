/** Deterministic replay timeline for input, checkpoints, hashes and divergence detection. */
export interface ReplayInputV15<T=unknown>{readonly tick:number;readonly sequence:number;readonly payload:T;}
export interface ReplayCheckpointV15<T=unknown>{readonly tick:number;readonly digest:string;readonly state:T;}
export interface ReplayFrameV15{readonly tick:number;readonly digest:string;readonly inputCount:number;readonly checkpoint:boolean;}
export interface ReplayDivergenceV15{readonly tick:number;readonly expectedDigest:string;readonly actualDigest:string;readonly distance:number;readonly reason:string;}
export interface ReplaySnapshotV15<T=unknown>{readonly version:15;readonly inputs:readonly ReplayInputV15<T>[];readonly checkpoints:readonly ReplayCheckpointV15<T>[];readonly frames:readonly ReplayFrameV15[];readonly cursorTick:number;}

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const stable=(value:unknown):string=>{if(value===null||typeof value!=='object')return JSON.stringify(value)??'undefined';if(Array.isArray(value))return'['+value.map(stable).join(',')+']';const o=value as Record<string,unknown>;return'{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+stable(o[k])).join(',')+'}';};
const digest=(value:unknown):string=>{const s=stable(value);let h=2166136261;for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};

export class ReplayTimelineV15<T=unknown>{
  readonly #maxInputs:number;readonly #maxCheckpoints:number;readonly #maxFrames:number;
  readonly #inputs:ReplayInputV15<T>[]=[];readonly #checkpoints:ReplayCheckpointV15<T>[]=[];readonly #frames:ReplayFrameV15[]=[];
  #cursorTick=0;#sequence=0;
  constructor(options:{maxInputs?:number;maxCheckpoints?:number;maxFrames?:number}={}){this.#maxInputs=Math.max(64,Math.trunc(options.maxInputs??10000));this.#maxCheckpoints=Math.max(4,Math.trunc(options.maxCheckpoints??256));this.#maxFrames=Math.max(64,Math.trunc(options.maxFrames??10000));}

  recordInput(tick:number,payload:T,sequence=this.#sequence+1):ReplayInputV15<T>{const input=Object.freeze({tick:Math.max(0,Math.trunc(tick)),sequence:Math.max(0,Math.trunc(sequence)),payload:clone(payload)});this.#sequence=Math.max(this.#sequence,input.sequence);this.#inputs.push(input);while(this.#inputs.length>this.#maxInputs)this.#inputs.shift();return input;}
  recordFrame(tick:number,state:unknown,inputCount:number,checkpoint=false):ReplayFrameV15{const frame=Object.freeze({tick:Math.max(0,Math.trunc(tick)),digest:digest(state),inputCount:Math.max(0,Math.trunc(inputCount)),checkpoint});this.#frames.push(frame);while(this.#frames.length>this.#maxFrames)this.#frames.shift();this.#cursorTick=Math.max(this.#cursorTick,frame.tick);return frame;}
  checkpoint(tick:number,state:T):ReplayCheckpointV15<T>{const checkpoint=Object.freeze({tick:Math.max(0,Math.trunc(tick)),digest:digest(state),state:clone(state)});this.#checkpoints.push(checkpoint);while(this.#checkpoints.length>this.#maxCheckpoints)this.#checkpoints.shift();return checkpoint;}

  verifyFrame(tick:number,state:unknown):ReplayDivergenceV15|undefined{const expected=this.#frames.find((frame)=>frame.tick===Math.trunc(tick));if(!expected)return undefined;const actual=digest(state);if(actual===expected.digest)return undefined;const matchingInputs=this.#inputs.filter((input)=>input.tick<=tick).length;return Object.freeze({tick:Math.trunc(tick),expectedDigest:expected.digest,actualDigest:actual,distance:1,reason:'Replay state digest diverged after '+matchingInputs+' recorded inputs.'});}

  nearestCheckpoint(tick:number):ReplayCheckpointV15<T>|undefined{const target=Math.max(0,Math.trunc(tick));const checkpoint=[...this.#checkpoints].reverse().find((item)=>item.tick<=target);return checkpoint?Object.freeze({...checkpoint,state:clone(checkpoint.state)}):undefined;}
  inputsBetween(fromTick:number,toTick:number):readonly ReplayInputV15<T>[]{const from=Math.min(fromTick,toTick),to=Math.max(fromTick,toTick);return Object.freeze(this.#inputs.filter((input)=>input.tick>=from&&input.tick<=to).sort((a,b)=>a.tick-b.tick||a.sequence-b.sequence).map((input)=>Object.freeze({...input,payload:clone(input.payload)})));}
  framesBetween(fromTick:number,toTick:number):readonly ReplayFrameV15[]{const from=Math.min(fromTick,toTick),to=Math.max(fromTick,toTick);return Object.freeze(this.#frames.filter((frame)=>frame.tick>=from&&frame.tick<=to));}
  checkpointsBetween(fromTick:number,toTick:number):readonly ReplayCheckpointV15<T>[]{const from=Math.min(fromTick,toTick),to=Math.max(fromTick,toTick);return Object.freeze(this.#checkpoints.filter((item)=>item.tick>=from&&item.tick<=to).map((item)=>Object.freeze({...item,state:clone(item.state)})));}

  rewind(tick:number):void{this.#cursorTick=Math.max(0,Math.trunc(tick));}
  cursor():number{return this.#cursorTick;}
  inputCount():number{return this.#inputs.length;}
  frameCount():number{return this.#frames.length;}
  checkpointCount():number{return this.#checkpoints.length;}
  snapshot():ReplaySnapshotV15<T>{return Object.freeze({version:15,inputs:Object.freeze(this.#inputs.map((input)=>Object.freeze({...input,payload:clone(input.payload)})),),checkpoints:Object.freeze(this.#checkpoints.map((checkpoint)=>Object.freeze({...checkpoint,state:clone(checkpoint.state)})),),frames:Object.freeze([...this.#frames]),cursorTick:this.#cursorTick});}
  restore(snapshot:ReplaySnapshotV15<T>):void{if(snapshot.version!==15)throw new Error('Unsupported replay snapshot version.');this.#inputs.length=0;this.#inputs.push(...snapshot.inputs.map((input)=>Object.freeze({...input,payload:clone(input.payload)})));this.#checkpoints.length=0;this.#checkpoints.push(...snapshot.checkpoints.map((item)=>Object.freeze({...item,state:clone(item.state)})));this.#frames.length=0;this.#frames.push(...snapshot.frames);this.#cursorTick=Math.max(0,Math.trunc(snapshot.cursorTick));this.#sequence=Math.max(0,...this.#inputs.map((input)=>input.sequence));}
  clear():void{this.#inputs.length=0;this.#checkpoints.length=0;this.#frames.length=0;this.#cursorTick=0;this.#sequence=0;}
}

export const replayDigestV15=(value:unknown):string=>digest(value);
