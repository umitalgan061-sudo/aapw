import { digestValue, normalizeTick, safeJsonSize } from './deterministic.js';
import type { R16Result, R16Source } from './types.js';

export type R16EnvelopeKind = 'command' | 'event' | 'replication' | 'rpc';
export interface R16NetworkEnvelope<T=unknown>{readonly version:16;readonly kind:R16EnvelopeKind;readonly peerId:string;readonly sequence:number;readonly tick:number;readonly source:R16Source;readonly topic:string;readonly payload:T;readonly sentAtMs:number;readonly expiresAtTick:number;readonly checksum:string;}
export interface R16PeerSecurityPolicy{readonly peerId:string;readonly maxBytesPerTick:number;readonly maxMessagesPerTick:number;readonly maxPayloadBytes:number;readonly maxFutureTicks:number;readonly replayWindowTicks:number;readonly allowKinds:readonly R16EnvelopeKind[];}
export interface R16NetworkSecurityStats{readonly accepted:number;readonly rejected:number;readonly replayRejected:number;readonly rateRejected:number;readonly byteRejected:number;readonly invalidRejected:number;readonly digest:string;}
interface PeerState{readonly policy:R16PeerSecurityPolicy;messages:number;bytes:number;tick:number;lastSequence:number;recent:Map<number,number>;accepted:number;rejected:number;}
const DEFAULT_POLICY:R16PeerSecurityPolicy=Object.freeze({peerId:'default',maxBytesPerTick:262144,maxMessagesPerTick:256,maxPayloadBytes:65536,maxFutureTicks:4,replayWindowTicks:120,allowKinds:Object.freeze(['command','event','replication','rpc'])});

export class R16NetworkSecurityBoundary{
  readonly #peers=new Map<string,PeerState>();#accepted=0;#rejected=0;#replayRejected=0;#rateRejected=0;#byteRejected=0;#invalidRejected=0;
  registerPolicy(policy:R16PeerSecurityPolicy):R16Result<void>{
    if(!policy.peerId||policy.peerId.length>96)return this.invalid('NET_PEER_ID','Peer id is invalid');
    if(!Number.isInteger(policy.maxMessagesPerTick)||policy.maxMessagesPerTick<1||policy.maxMessagesPerTick>10000)return this.invalid('NET_MESSAGE_CAP','Message rate limit is invalid');
    if(!Number.isInteger(policy.maxBytesPerTick)||policy.maxBytesPerTick<1024||policy.maxBytesPerTick>16*1024*1024)return this.invalid('NET_BYTE_CAP','Byte rate limit is invalid');
    if(!Number.isInteger(policy.maxPayloadBytes)||policy.maxPayloadBytes<256||policy.maxPayloadBytes>4*1024*1024)return this.invalid('NET_PAYLOAD_CAP','Payload limit is invalid');
    const normalized=Object.freeze({...policy,peerId:policy.peerId.slice(0,96),maxMessagesPerTick:Math.trunc(policy.maxMessagesPerTick),maxBytesPerTick:Math.trunc(policy.maxBytesPerTick),maxPayloadBytes:Math.trunc(policy.maxPayloadBytes),maxFutureTicks:Math.max(0,Math.trunc(policy.maxFutureTicks)),replayWindowTicks:Math.max(1,Math.trunc(policy.replayWindowTicks)),allowKinds:Object.freeze([...new Set(policy.allowKinds)])});
    this.#peers.set(normalized.peerId,{policy:normalized,messages:0,bytes:0,tick:-1,lastSequence:-1,recent:new Map(),accepted:0,rejected:0});return{ok:true,value:undefined};
  }
  validate<T>(envelope:R16NetworkEnvelope<T>,currentTick:number):R16Result<R16NetworkEnvelope<T>>{
    const state=this.getState(envelope.peerId);const p=state.policy;const tick=normalizeTick(currentTick);
    if(envelope.version!==16||!envelope.peerId||!envelope.topic||envelope.topic.length>96||!Number.isInteger(envelope.sequence)||envelope.sequence<0)return this.reject(state,'NET_ENVELOPE_INVALID','Envelope shape is invalid','invalid');
    if(!p.allowKinds.includes(envelope.kind))return this.reject(state,'NET_KIND_DENIED','Envelope kind is denied','invalid');
    if(envelope.tick>tick+p.maxFutureTicks)return this.reject(state,'NET_FUTURE_TICK','Envelope is too far ahead','invalid');
    if(envelope.expiresAtTick<tick||envelope.expiresAtTick<envelope.tick)return this.reject(state,'NET_EXPIRED','Envelope is expired','invalid');
    if(!Number.isFinite(envelope.sentAtMs)||envelope.sentAtMs<0)return this.reject(state,'NET_TIME_INVALID','Envelope timestamp is invalid','invalid');
    const payloadBytes=safeJsonSize(envelope.payload);
    if(payloadBytes>p.maxPayloadBytes)return this.reject(state,'NET_PAYLOAD_TOO_LARGE','Envelope payload exceeds limit','byte');
    if(envelope.sequence<=state.lastSequence)return this.reject(state,'NET_SEQUENCE_REPLAY','Envelope sequence is not monotonic','replay');
    if(state.recent.has(envelope.sequence))return this.reject(state,'NET_DUPLICATE','Envelope was already observed','replay');
    const expected=digestValue({version:envelope.version,kind:envelope.kind,peerId:envelope.peerId,sequence:envelope.sequence,tick:envelope.tick,source:envelope.source,topic:envelope.topic,payload:envelope.payload,sentAtMs:envelope.sentAtMs,expiresAtTick:envelope.expiresAtTick});
    if(expected!==envelope.checksum)return this.reject(state,'NET_CHECKSUM','Envelope checksum mismatch','invalid');
    if(state.tick!==tick){state.tick=tick;state.messages=0;state.bytes=0;}
    if(state.messages+1>p.maxMessagesPerTick)return this.reject(state,'NET_RATE_LIMIT','Message rate limit exceeded','rate');
    if(state.bytes+payloadBytes>p.maxBytesPerTick)return this.reject(state,'NET_BYTE_RATE_LIMIT','Per-tick byte rate limit exceeded','byte');
    state.messages++;state.bytes+=payloadBytes;state.lastSequence=envelope.sequence;state.recent.set(envelope.sequence,tick);this.prune(state,tick);state.accepted++;this.#accepted++;
    return{ok:true,value:Object.freeze(envelope)};
  }
  createEnvelope<T>(kind:R16EnvelopeKind,peerId:string,sequence:number,tick:number,source:R16Source,topic:string,payload:T,sentAtMs:number,expiresAtTick=tick+120):R16NetworkEnvelope<T>{
    const body={version:16 as const,kind,peerId:peerId.slice(0,96),sequence:Math.max(0,Math.trunc(sequence)),tick:normalizeTick(tick),source,topic:topic.slice(0,96),payload,sentAtMs:Math.max(0,Number.isFinite(sentAtMs)?sentAtMs:0),expiresAtTick:Math.max(normalizeTick(tick),Math.trunc(expiresAtTick))};
    return Object.freeze({...body,checksum:digestValue(body)});
  }
  peerStats(peerId:string){const s=this.getState(peerId);return Object.freeze({peerId:s.policy.peerId,messages:s.messages,bytes:s.bytes,accepted:s.accepted,rejected:s.rejected,lastSequence:s.lastSequence,digest:digestValue({messages:s.messages,bytes:s.bytes,accepted:s.accepted,rejected:s.rejected,lastSequence:s.lastSequence})});}
  stats():R16NetworkSecurityStats{return Object.freeze({accepted:this.#accepted,rejected:this.#rejected,replayRejected:this.#replayRejected,rateRejected:this.#rateRejected,byteRejected:this.#byteRejected,invalidRejected:this.#invalidRejected,digest:digestValue({accepted:this.#accepted,rejected:this.#rejected,replayRejected:this.#replayRejected,rateRejected:this.#rateRejected,byteRejected:this.#byteRejected,invalidRejected:this.#invalidRejected})});}
  clear(){this.#peers.clear();this.#accepted=0;this.#rejected=0;this.#replayRejected=0;this.#rateRejected=0;this.#byteRejected=0;this.#invalidRejected=0;}
  private getState(peerId:string):PeerState{
    if(!this.#peers.has(peerId)){this.registerPolicy({...DEFAULT_POLICY,peerId:peerId||DEFAULT_POLICY.peerId});}
    return this.#peers.get(peerId)??this.#peers.get(DEFAULT_POLICY.peerId)!;
  }
  private invalid(code:string,message:string):R16Result<void>{this.#invalidRejected++;return{ok:false,error:{code,message,retryable:false}};}
  private reject(state:PeerState,code:string,message:string,className:'replay'|'rate'|'byte'|'invalid'):R16Result<never>{
    state.rejected++;this.#rejected++;if(className==='replay')this.#replayRejected++;else if(className==='rate')this.#rateRejected++;else if(className==='byte')this.#byteRejected++;else this.#invalidRejected++;
    return{ok:false,error:{code,message,retryable:className==='rate'||className==='byte'}};
  }
  private prune(state:PeerState,tick:number){const min=tick-state.policy.replayWindowTicks;for(const[sequence,seen]of state.recent)if(seen<min)state.recent.delete(sequence);}
}
