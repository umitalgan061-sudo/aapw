import type{RuntimeEvent}from'./contracts';
export class BoundedEventStream{
 #events:RuntimeEvent[]=[];#handlers=new Map<string,Set<(event:RuntimeEvent)=>void>>();#sequence=1;#dropped=0;readonly maxEvents:number;
 constructor(maxEvents=8192){this.maxEvents=Math.max(256,Math.trunc(maxEvents));}
 publish<T>(type:string,payload:T,options:{tick:number;source?:string;coalescible?:boolean}):RuntimeEvent<T>{const event=Object.freeze({sequence:this.#sequence++,tick:options.tick,type,source:options.source??'engine',payload,coalescible:options.coalescible??false});if(event.coalescible){const index=this.#events.findIndex(item=>item.type===type&&item.tick===event.tick);if(index>=0)this.#events.splice(index,1);}this.#events.push(event);while(this.#events.length>this.maxEvents){this.#events.shift();this.#dropped+=1;}for(const handler of this.#handlers.get(type)??[])handler(event);return event;}
 subscribe(type:string,handler:(event:RuntimeEvent)=>void):()=>void{const set=this.#handlers.get(type)??new Set<(event:RuntimeEvent)=>void>();set.add(handler);this.#handlers.set(type,set);return()=>{set.delete(handler);if(!set.size)this.#handlers.delete(type);};}
 since(sequence:number,type?:string):readonly RuntimeEvent[]{return Object.freeze(this.#events.filter(event=>event.sequence>sequence&&(!type||event.type===type)));}
 latest<T>(type:string):RuntimeEvent<T>|null{for(let i=this.#events.length-1;i>=0;i-=1)if(this.#events[i]!.type===type)return this.#events[i] as RuntimeEvent<T>;return null;}
 clear():void{this.#events=[];}get size(){return this.#events.length;}get dropped(){return this.#dropped;}
}
