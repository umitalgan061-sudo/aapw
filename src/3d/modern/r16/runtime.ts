import { R16BudgetScheduler } from './budgetScheduler.js';
import { R16CommandBus } from './commandBus.js';
import { createClockSample,digestRuntime } from './deterministic.js';
import { R16EventLog } from './eventLog.js';
import { R16HealthSupervisor } from './health.js';
import { R16Telemetry } from './observability.js';
import { R16PersistenceJournal } from './persistence.js';
import { R16ReplicationLedger } from './replication.js';
import { R16SnapshotStore } from './snapshotStore.js';
import { R16StateGraph } from './stateGraph.js';
import { DEFAULT_R16_CONFIG,type R16CommandReceipt,R16Event,R16Result,R16RuntimeConfig,R16RuntimeDigest,R16StatePatch } from './types.js';

export interface R16FrameResult{readonly tick:number;readonly deltaMs:number;readonly commands:readonly R16CommandReceipt[];readonly statePatch:R16StatePatch|null;readonly runtimeDigest:string;}

export class R16RuntimePlatform{
  readonly config:R16RuntimeConfig;readonly commands:R16CommandBus;readonly events:R16EventLog;readonly state:R16StateGraph;readonly snapshots:R16SnapshotStore;
  readonly budgets:R16BudgetScheduler;readonly replication:R16ReplicationLedger;readonly persistence:R16PersistenceJournal;readonly telemetry:R16Telemetry;readonly health:R16HealthSupervisor;
  #tick=0;#monotonicMs=0;#started=false;

  constructor(overrides:Partial<R16RuntimeConfig>={}){
    this.config=Object.freeze({...DEFAULT_R16_CONFIG,...sanitizeConfig(overrides)});
    this.commands=new R16CommandBus(this.config);this.events=new R16EventLog(this.config);this.state=new R16StateGraph(this.config);
    this.snapshots=new R16SnapshotStore(this.config);this.budgets=new R16BudgetScheduler(this.config);this.replication=new R16ReplicationLedger(this.config);
    this.persistence=new R16PersistenceJournal(this.config);this.telemetry=new R16Telemetry(this.config);this.health=new R16HealthSupervisor(this.config);
  }
  start(){this.#started=true;this.events.emit('runtime.started',{version:16,seed:this.config.seed},this.#tick,'system','info');this.health.report('runtime',1,'info','started',this.#tick);}
  stop(){this.events.emit('runtime.stopped',{tick:this.#tick},this.#tick,'system','info');this.#started=false;}
  get started(){return this.#started;}get tick(){return this.#tick;}
  frame(monotonicMs=this.#monotonicMs+this.config.fixedStepMs):R16FrameResult{
    const sample=createClockSample(this.#tick-1,this.#tick+1,monotonicMs,this.config.fixedStepMs);this.#tick=sample.tick;this.#monotonicMs=sample.monotonicMs;
    const before=typeof performance!=='undefined'?performance.now():Date.now();const receipts=this.commands.tick(this.#tick);
    const commandMs=(typeof performance!=='undefined'?performance.now():Date.now())-before;
    this.telemetry.record('runtime.commands.ms',commandMs,this.#tick,'ms');this.telemetry.record('runtime.commands.count',receipts.length,this.#tick,'count');
    this.replication.beginTick(this.#tick);
    this.health.report('command-bus',receipts.some(r=>r.status==='rejected')?.7:1,'info','command tick complete',this.#tick);
    return Object.freeze({tick:this.#tick,deltaMs:sample.deltaMs,commands:receipts,statePatch:this.state.lastPatch(),runtimeDigest:this.digest().runtimeDigest});
  }
  transact(source:Parameters<R16StateGraph['begin']>[1],reason:string,apply:(tx:ReturnType<R16StateGraph['begin']>)=>void):R16Result<R16StatePatch>{
    const tx=this.state.begin(this.#tick,source,reason);try{apply(tx);}catch(error){tx.rollback();return{ok:false,error:{code:'STATE_TRANSACTION_THROW',message:error instanceof Error?error.message:String(error),retryable:false}};}
    const result=tx.commit();if(result.ok){this.events.emit('state.committed',result.value,this.#tick,source,'debug');this.telemetry.record('state.revision',result.value.revision,this.#tick);return result;}
    this.events.emit('state.rejected',result.error,this.#tick,source,'warn');this.health.report('state-graph',.4,'error',result.error.code,this.#tick);return result;
  }
  checkpoint(){const snapshot=this.snapshots.capture(this.state.exportState(),this.#tick,'checkpoint');const persisted=this.persistence.checkpoint(snapshot.snapshot);if(persisted.ok)this.events.emit('snapshot.checkpoint',{revision:snapshot.revision,digest:snapshot.digest},this.#tick,'save','info');return persisted;}
  emit<T>(topic:string,payload:T,source:Parameters<R16EventLog['emit']>[3],severity:Parameters<R16EventLog['emit']>[4]='info'):R16Event<T>{return this.events.emit(topic,payload,this.#tick,source,severity);}
  digest():R16RuntimeDigest&{readonly runtimeDigest:string}{
    const report=this.health.reportSnapshot();const value:R16RuntimeDigest={tick:this.#tick,stateRevision:this.state.revision(),eventDigest:this.events.digest(),snapshotDigest:this.snapshots.digest(),persistenceDigest:this.persistence.digest().digest,telemetryDigest:this.telemetry.digest().digest,healthDigest:report.digest,replicationDigest:this.replication.digest()};
    return Object.freeze({...value,runtimeDigest:digestRuntime(value)});
  }
  diagnostics():Readonly<Record<string,unknown>>{
    return Object.freeze({version:16,started:this.#started,tick:this.#tick,stateRevision:this.state.revision(),commandStats:this.commands.stats(),eventStats:this.events.stats(),persistence:this.persistence.digest(),telemetry:this.telemetry.digest(),health:this.health.reportSnapshot(),replicationEntities:this.replication.count(),budgetDigest:this.budgets.digest(),runtimeDigest:this.digest().runtimeDigest});
  }
  verifyDeterministicReplay(frames:number):R16Result<string>{
    const count=Math.max(1,Math.trunc(frames)),left=new R16RuntimePlatform(this.config),right=new R16RuntimePlatform(this.config);left.start();right.start();
    const register=(r:R16RuntimePlatform)=>r.commands.register({topic:'player.move',apply:cmd=>r.transact('replay','move',(tx)=>{const p=cmd.payload as {x?:number;z?:number};tx.set('player.x',p.x??0);tx.set('player.z',p.z??0);})});
    const a=register(left),b=register(right);if(!a.ok)return a;if(!b.ok)return b;
    for(let i=0;i<count;i++){const payload={x:Math.sin(i*.17),z:Math.cos(i*.11)};left.commands.enqueue('player.move',payload,left.tick+1,'replay',10);right.commands.enqueue('player.move',payload,right.tick+1,'replay',10);left.frame();right.frame();}
    const l=left.digest().runtimeDigest,r=right.digest().runtimeDigest;return l===r?{ok:true,value:l}:{ok:false,error:{code:'R16_NON_DETERMINISTIC',message:'Replay digest mismatch',retryable:false}};
  }
  reset(){this.commands.clear();this.events.clear();this.state.clear();this.snapshots.clear();this.budgets.clear();this.replication.clear();this.persistence.clear();this.telemetry.clear();this.health.clear();this.#tick=0;this.#monotonicMs=0;this.#started=false;}
}
function sanitizeConfig(overrides:Partial<R16RuntimeConfig>):Partial<R16RuntimeConfig>{
  const output:Partial<R16RuntimeConfig>={};for(const[key,value]of Object.entries(overrides)){if(typeof value!=='number'||!Number.isFinite(value))continue;(output as Record<string,unknown>)[key]=Math.max(1,Math.trunc(value));}return output;
}
export function createR16Runtime(overrides:Partial<R16RuntimeConfig>={}):R16RuntimePlatform{return new R16RuntimePlatform(overrides);}
export const R16_RUNTIME_POLICY=Object.freeze({version:16,fixedStep:DEFAULT_R16_CONFIG.fixedStepMs,deterministic:true,bounded:true,transactionalState:true,replayable:true,observable:true,recoverable:true,replication:true});
