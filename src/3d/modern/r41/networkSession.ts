import{encodeFrame}from'./binaryCodec';import type{NetworkHealth}from'./contracts';
interface Pending{readonly sequence:number;readonly bytes:Uint8Array;createdTick:number;lastSentTick:number;attempts:number;}
export class ReliableBinarySession{
 connected=false;#sequence=1;#receive=0;#pending=new Map<number,Pending>();#retransmits=0;readonly resendAfterTicks:number;readonly windowSize:number;readonly maxRetransmits:number;
 constructor(options:{readonly resendAfterTicks?:number;readonly windowSize?:number;readonly maxRetransmits?:number}={}){this.resendAfterTicks=Math.max(1,Math.trunc(options.resendAfterTicks??12));this.windowSize=Math.max(1,Math.trunc(options.windowSize??64));this.maxRetransmits=Math.max(1,Math.trunc(options.maxRetransmits??5));}
 open(){this.connected=true;}close(){this.connected=false;this.#pending.clear();}
 send(payload:Uint8Array,tick:number,flags=0){if(!this.connected||!payload.length||this.#pending.size>=this.windowSize)return null;const sequence=this.#sequence++;const bytes=encodeFrame(sequence,this.#receive,payload,flags);this.#pending.set(sequence,{sequence,bytes,createdTick:tick,lastSentTick:tick,attempts:1});return bytes;}
 acknowledge(ack:number,tick:number){let removed=0;for(const sequence of[...this.#pending.keys()])if(sequence<=ack){this.#pending.delete(sequence);removed+=1;}void tick;return removed;}
 receive(frame:{sequence:number;ack:number;payload:Uint8Array},tick:number){this.acknowledge(frame.ack,tick);if(frame.sequence<=this.#receive)return{accepted:false,duplicate:true,payload:new Uint8Array()};this.#receive=frame.sequence;return{accepted:true,duplicate:false,payload:frame.payload.slice()};}
 retransmit(tick:number){const out:Uint8Array[]=[];for(const item of this.#pending.values()){if(tick-item.lastSentTick<this.resendAfterTicks)continue;if(item.attempts>=this.maxRetransmits){this.#pending.delete(item.sequence);continue;}item.attempts+=1;item.lastSentTick=tick;out.push(item.bytes);this.#retransmits+=1;}return out;}
 health():NetworkHealth{return Object.freeze({connected:this.connected,pending:this.#pending.size,retransmits:this.#retransmits,lastAckTick:0,congestion:Math.min(1,this.#pending.size/this.windowSize)});}
}
