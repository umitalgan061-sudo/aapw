import type{Tick}from'./contracts';
export interface ClockOptions{readonly stepMs?:number;readonly maxCatchUpSteps?:number;readonly maxFrameDeltaMs?:number;}
export class DeterministicClock{
 readonly stepMs:number;readonly maxCatchUpSteps:number;readonly maxFrameDeltaMs:number;
 #tick=0;#simulationMs=0;#wallMs=0;#accumulator=0;
 constructor(options:ClockOptions={}){this.stepMs=clamp(options.stepMs??16.6666666667,4,1000);this.maxCatchUpSteps=Math.max(1,Math.trunc(options.maxCatchUpSteps??5));this.maxFrameDeltaMs=Math.max(this.stepMs,Math.trunc(options.maxFrameDeltaMs??250));}
 advance(frameDeltaMs:number,consume:(tick:Tick)=>void):Tick{const delta=clamp(frameDeltaMs,0,this.maxFrameDeltaMs);this.#wallMs+=delta;this.#accumulator+=delta;let steps=0;while(this.#accumulator>=this.stepMs&&steps<this.maxCatchUpSteps){this.#tick+=1;this.#simulationMs+=this.stepMs;this.#accumulator-=this.stepMs;steps+=1;consume(Object.freeze({index:this.#tick,simulationMs:this.#simulationMs,wallMs:this.#wallMs,deltaMs:this.stepMs,alpha:0}));}if(steps===this.maxCatchUpSteps)this.#accumulator=Math.min(this.#accumulator,this.stepMs);return this.tick();}
 tick():Tick{return Object.freeze({index:this.#tick,simulationMs:this.#simulationMs,wallMs:this.#wallMs,deltaMs:this.stepMs,alpha:this.#accumulator/this.stepMs});}
 capture(){return Object.freeze({tick:this.#tick,simulationMs:this.#simulationMs,wallMs:this.#wallMs,accumulator:this.#accumulator});}
 restore(value:Readonly<{tick:number;simulationMs:number;wallMs:number;accumulator:number}>):void{if(!Number.isInteger(value.tick)||value.tick<0)throw new Error('CLOCK_TICK_INVALID');this.#tick=value.tick;this.#simulationMs=Math.max(0,value.simulationMs);this.#wallMs=Math.max(0,value.wallMs);this.#accumulator=Math.max(0,value.accumulator);}
 reset():void{this.#tick=0;this.#simulationMs=0;this.#wallMs=0;this.#accumulator=0;}
 fastForward(count:number,consume:(tick:Tick)=>void):void{for(let i=0;i<Math.max(0,Math.min(100000,Math.trunc(count)));i+=1){this.#tick+=1;this.#simulationMs+=this.stepMs;consume(Object.freeze({index:this.#tick,simulationMs:this.#simulationMs,wallMs:this.#wallMs,deltaMs:this.stepMs,alpha:0}));}}
}
function clamp(value:number,min:number,max:number){return Number.isFinite(value)?Math.max(min,Math.min(max,value)):min;}
