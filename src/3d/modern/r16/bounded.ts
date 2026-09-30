export interface BoundedQueueOptions{readonly capacity:number;readonly dropOldest?:boolean;}
export interface QueuePushResult<T>{readonly accepted:boolean;readonly dropped:T|null;readonly size:number;}

export class BoundedQueue<T>{
  readonly capacity:number; readonly dropOldest:boolean; #items:T[]=[];
  constructor(options:BoundedQueueOptions){this.capacity=Math.max(1,Math.trunc(options.capacity));this.dropOldest=options.dropOldest??true;}
  get size(){return this.#items.length;} get empty(){return this.#items.length===0;}
  push(value:T):QueuePushResult<T>{
    if(this.#items.length>=this.capacity){
      if(!this.dropOldest)return Object.freeze({accepted:false,dropped:value,size:this.#items.length});
      const dropped=this.#items.shift()??null; this.#items.push(value); return Object.freeze({accepted:true,dropped,size:this.#items.length});
    }
    this.#items.push(value); return Object.freeze({accepted:true,dropped:null,size:this.#items.length});
  }
  unshift(value:T):QueuePushResult<T>{
    const dropped=this.#items.length>=this.capacity?(this.#items.pop()??null):null; this.#items.unshift(value);
    return Object.freeze({accepted:true,dropped,size:this.#items.length});
  }
  shift():T|null{return this.#items.shift()??null;} peek():T|null{return this.#items[0]??null;}
  clear():void{this.#items.length=0;} values():readonly T[]{return Object.freeze([...this.#items]);}
  removeWhere(predicate:(v:T)=>boolean):number{const before=this.#items.length;this.#items=this.#items.filter(v=>!predicate(v));return before-this.#items.length;}
}

export class SlidingWindow{
  readonly capacity:number; #values:number[]=[];
  constructor(capacity:number){this.capacity=Math.max(1,Math.trunc(capacity));}
  push(value:number):void{if(!Number.isFinite(value))return;if(this.#values.length>=this.capacity)this.#values.shift();this.#values.push(value);}
  reset():void{this.#values.length=0;}
  stats(){if(this.#values.length===0)return Object.freeze({count:0,minimum:0,maximum:0,average:0,p50:0,p95:0,p99:0});
    const v=[...this.#values].sort((a,b)=>a-b),pct=(f:number)=>v[Math.min(v.length-1,Math.floor(f*(v.length-1)))]??0,total=v.reduce((s,n)=>s+n,0);
    return Object.freeze({count:v.length,minimum:v[0]??0,maximum:v.at(-1)??0,average:total/v.length,p50:pct(.5),p95:pct(.95),p99:pct(.99)});
  }
}
