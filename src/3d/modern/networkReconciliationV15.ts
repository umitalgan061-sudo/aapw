/** Deterministic client prediction/reconciliation primitives. */
export interface InputFrameV15<T=unknown>{readonly tick:number;readonly sequence:number;readonly payload:T;readonly predictedAtTick:number;}
export interface NetworkStateV15<T=unknown>{readonly tick:number;readonly sequence:number;readonly state:T;readonly digest:string;readonly receivedAtMs:number;readonly authoritative:boolean;}
export interface ReconciliationCorrectionV15<T=unknown>{readonly fromTick:number;readonly toTick:number;readonly state:T;readonly replayedInputs:readonly InputFrameV15[];readonly correctionDistance:number;readonly hardSnap:boolean;readonly reason:string;}
export interface ReconciliationMetricsV15{readonly bufferedInputs:number;readonly bufferedStates:number;readonly lastAuthoritativeTick:number;readonly lastPredictedTick:number;readonly corrections:number;readonly hardSnaps:number;readonly averageCorrection:number;readonly interpolationDelayTicks:number;}
export interface ReconciliationOptionsV15{readonly maxInputHistory?:number;readonly maxStateHistory?:number;readonly maxPredictionTicks?:number;readonly correctionThreshold?:number;readonly now?:()=>number;}
export interface StateCodecV15<T>{readonly digest:(state:T)=>string;readonly clone:(state:T)=>T;readonly distance?:(a:T,b:T)=>number;readonly apply:(state:T,input:InputFrameV15)=>T;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,finite(v,min)));

export class NetworkReconciliationV15<T=unknown>{
  readonly #codec:StateCodecV15<T>;
  readonly #maxInputs:number;
  readonly #maxStates:number;
  readonly #maxPredictionTicks:number;
  readonly #threshold:number;
  readonly #now:()=>number;
  readonly #inputs:InputFrameV15<T>[]=[];
  readonly #states:NetworkStateV15<T>[]=[];
  #predictedState:T;
  #lastAuthoritativeTick=0;
  #lastPredictedTick=0;
  #corrections=0;
  #hardSnaps=0;
  #distanceSum=0;
  #interpolationDelayTicks=2;

  constructor(initialState:T,codec:StateCodecV15<T>,options:ReconciliationOptionsV15={}){this.#predictedState=codec.clone(initialState);this.#codec=codec;this.#maxInputs=Math.max(32,Math.trunc(options.maxInputHistory??512));this.#maxStates=Math.max(16,Math.trunc(options.maxStateHistory??128));this.#maxPredictionTicks=Math.max(1,Math.trunc(options.maxPredictionTicks??12));this.#threshold=Math.max(0,finite(options.correctionThreshold??0.25));this.#now=options.now??(()=>Date.now());}

  get predictedState():T{return this.#codec.clone(this.#predictedState);}
  get lastAuthoritativeTick():number{return this.#lastAuthoritativeTick;}
  get lastPredictedTick():number{return this.#lastPredictedTick;}

  recordInput(payload:T,tick:number,sequence:number):InputFrameV15<T>{
    const input=Object.freeze({tick:Math.max(0,Math.trunc(tick)),sequence:Math.max(0,Math.trunc(sequence)),payload:this.#codec.clone(payload),predictedAtTick:this.#lastPredictedTick});
    this.#inputs.push(input);
    while(this.#inputs.length>this.#maxInputs)this.#inputs.shift();
    return input;
  }

  predict(input:InputFrameV15<T>):T{
    this.#predictedState=this.#codec.apply(this.#predictedState,input);
    this.#lastPredictedTick=Math.max(this.#lastPredictedTick,input.tick);
    return this.#codec.clone(this.#predictedState);
  }

  receiveAuthoritative(state:T,tick:number,sequence:number,digest?:string):ReconciliationCorrectionV15<T>{
    const normalizedTick=Math.max(0,Math.trunc(tick));
    const authoritative:NetworkStateV15<T>=Object.freeze({tick:normalizedTick,sequence:Math.max(0,Math.trunc(sequence)),state:this.#codec.clone(state),digest:digest??this.#codec.digest(state),receivedAtMs:this.#now(),authoritative:true});
    this.#states.push(authoritative);
    while(this.#states.length>this.#maxStates)this.#states.shift();
    this.#lastAuthoritativeTick=Math.max(this.#lastAuthoritativeTick,normalizedTick);
    const distance=this.#codec.distance?Math.max(0,this.#codec.distance(this.#predictedState,state)):this.#codec.digest(this.#predictedState)===authoritative.digest?0:1;
    const hardSnap=distance>=this.#threshold||normalizedTick+this.#maxPredictionTicks<this.#lastPredictedTick;
    const replayed=this.#inputs.filter((input)=>input.tick>normalizedTick).sort((a,b)=>a.tick-b.tick||a.sequence-b.sequence);
    let corrected=this.#codec.clone(state);
    if(!hardSnap){for(const input of replayed)corrected=this.#codec.apply(corrected,input);}
    this.#predictedState=this.#codec.clone(corrected);
    this.#lastPredictedTick=Math.max(this.#lastPredictedTick,normalizedTick);
    this.#corrections+=1;this.#distanceSum+=distance;if(hardSnap)this.#hardSnaps+=1;
    this.#trimInputs(normalizedTick);
    return Object.freeze({fromTick:normalizedTick,toTick:this.#lastPredictedTick,state:this.#codec.clone(corrected),replayedInputs:Object.freeze(replayed.map((input)=>Object.freeze({...input,payload:this.#codec.clone(input.payload)}))),correctionDistance:distance,hardSnap,reason:hardSnap?'authoritative state exceeded correction threshold':'authoritative state replayed through pending inputs'});
  }

  rollbackTo(tick:number):boolean{
    const target=Math.max(0,Math.trunc(tick));
    const state=[...this.#states].reverse().find((candidate)=>candidate.tick<=target);
    if(!state)return false;
    let next=this.#codec.clone(state.state);
    for(const input of this.#inputs.filter((item)=>item.tick>state.tick&&item.tick<=target).sort((a,b)=>a.tick-b.tick||a.sequence-b.sequence))next=this.#codec.apply(next,input);
    this.#predictedState=next;this.#lastPredictedTick=target;return true;
  }

  setInterpolationDelay(ticks:number):void{this.#interpolationDelayTicks=Math.max(0,Math.min(12,Math.trunc(ticks)));}
  interpolationPair(targetTick:number):{readonly older?:NetworkStateV15<T>;readonly newer?:NetworkStateV15<T>} {
    const target=Math.max(0,Math.trunc(targetTick))-this.#interpolationDelayTicks;
    const ordered=[...this.#states].sort((a,b)=>a.tick-b.tick||a.sequence-b.sequence);
    let older:NetworkStateV15<T>|undefined;let newer:NetworkStateV15<T>|undefined;
    for(const state of ordered){if(state.tick<=target)older=state;else{newer=state;break;}}
    return Object.freeze({older,newer});
  }

  inputs(fromTick=0):readonly InputFrameV15<T>[] {return Object.freeze(this.#inputs.filter((input)=>input.tick>=fromTick).map((input)=>Object.freeze({...input,payload:this.#codec.clone(input.payload)})));}
  states():readonly NetworkStateV15<T>[] {return Object.freeze(this.#states.map((state)=>Object.freeze({...state,state:this.#codec.clone(state.state)})));}
  metrics():ReconciliationMetricsV15{return Object.freeze({bufferedInputs:this.#inputs.length,bufferedStates:this.#states.length,lastAuthoritativeTick:this.#lastAuthoritativeTick,lastPredictedTick:this.#lastPredictedTick,corrections:this.#corrections,hardSnaps:this.#hardSnaps,averageCorrection:this.#corrections?this.#distanceSum/this.#corrections:0,interpolationDelayTicks:this.#interpolationDelayTicks});}
  reset(state:T):void{this.#inputs.length=0;this.#states.length=0;this.#predictedState=this.#codec.clone(state);this.#lastAuthoritativeTick=0;this.#lastPredictedTick=0;this.#corrections=0;this.#hardSnaps=0;this.#distanceSum=0;}

  #trimInputs(authoritativeTick:number):void{while(this.#inputs.length&&this.#inputs[0]!.tick<authoritativeTick-2)this.#inputs.shift();}
}

export const numericStateCodecV15:StateCodecV15<number>={digest:(state)=>{const n=Number.isFinite(state)?state:0;return n.toFixed(6);},clone:(state)=>Number.isFinite(state)?state:0,distance:(a,b)=>Math.abs(a-b),apply:(state,input)=>state+Number(input.payload??0)};

export const objectStateCodecV15:<T extends Record<string,unknown>>(applyFn:(state:T,input:InputFrameV15<T>)=>T):StateCodecV15<T>=>({digest:(state)=>JSON.stringify(Object.keys(state).sort().map((key)=>[key,state[key]])),clone:(state)=>JSON.parse(JSON.stringify(state)) as T,apply:applyFn});
