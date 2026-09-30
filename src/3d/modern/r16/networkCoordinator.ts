import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';
import { R16NetworkSecurityBoundary, type R16EnvelopeKind, type R16NetworkEnvelope } from './networkSecurity.js';

export interface R16PeerSession{readonly peerId:string;readonly connected:boolean;readonly lastTick:number;readonly sent:number;readonly received:number;readonly rejected:number;readonly digest:string;}
export interface R16NetworkAdapter{readonly send:(envelope:R16NetworkEnvelope)=>R16Result<void>;readonly now:()=>number;}

interface SessionMutable{peerId:string;connected:boolean;lastTick:number;sent:number;received:number;rejected:number;}

export class R16NetworkCoordinator{
  readonly security:R16NetworkSecurityBoundary;readonly #sessions=new Map<string,SessionMutable>();#sequence=0;
  constructor(security=new R16NetworkSecurityBoundary()){this.security=security;}
  connect(peerId:string,tick=0):R16Result<R16PeerSession>{
    if(!peerId||peerId.length>96)return{ok:false,error:{code:'NET_PEER_ID',message:'Peer id invalid',retryable:false}};
    const session={peerId:peerId.slice(0,96),connected:true,lastTick:Math.max(0,Math.trunc(tick)),sent:0,received:0,rejected:0};this.#sessions.set(session.peerId,session);
    return{ok:true,value:this.snapshot(session)};
  }
  disconnect(peerId:string,tick=0):boolean{const s=this.#sessions.get(peerId);if(!s)return false;s.connected=false;s.lastTick=Math.max(0,Math.trunc(tick));return true;}
  send<T>(peerId:string,kind:R16EnvelopeKind,topic:string,payload:T,tick:number,source:'engine'|'ui'|'network'|'save'|'replay'|'system'|'worker',adapter:R16NetworkAdapter):R16Result<R16NetworkEnvelope<T>>{
    const s=this.#sessions.get(peerId);if(!s?.connected)return{ok:false,error:{code:'NET_DISCONNECTED',message:'Peer is disconnected',retryable:true}};
    const envelope=this.security.createEnvelope(kind,peerId,++this.#sequence,tick,source,topic,payload,adapter.now());const result=adapter.send(envelope);
    if(result.ok){s.sent++;s.lastTick=Math.max(s.lastTick,tick);}else{s.rejected++;}return result.ok?{ok:true,value:envelope}:result as R16Result<R16NetworkEnvelope<T>>;
  }
  receive<T>(envelope:R16NetworkEnvelope<T>,tick:number):R16Result<R16NetworkEnvelope<T>>{
    const s=this.#sessions.get(envelope.peerId);if(!s?.connected)return{ok:false,error:{code:'NET_DISCONNECTED',message:'Peer is disconnected',retryable:true}};
    const result=this.security.validate(envelope,tick);if(result.ok){s.received++;s.lastTick=tick;}else s.rejected++;return result;
  }
  sessions(){return Object.freeze([...this.#sessions.values()].map(s=>this.snapshot(s)).sort((a,b)=>a.peerId.localeCompare(b.peerId)));}
  digest(){return digestValue(this.sessions());}
  clear(){this.#sessions.clear();this.#sequence=0;}
  private snapshot(s:SessionMutable):R16PeerSession{return Object.freeze({...s,digest:digestValue(s)});}
}
