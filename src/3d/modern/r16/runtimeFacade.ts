import { R16AssetResidency } from './assetResidency.js';
import { R16CacheCoordinator } from './cacheCoordinator.js';
import { R16BudgetScheduler } from './budgetScheduler.js';
import { R16CommandBus } from './commandBus.js';
import { R16EventLog } from './eventLog.js';
import { R16FrameScheduler, R16FixedStepClock } from './frameScheduler.js';
import { R16HealthSupervisor } from './health.js';
import { R16InputRuntime } from './inputRuntime.js';
import { R16MigrationLedger } from './migrationAudit.js';
import { R16NetworkSecurityBoundary } from './networkSecurity.js';
import { R16PersistenceJournal } from './persistence.js';
import { R16PerformanceGovernor } from './performanceGovernor.js';
import { R16RecoveryCoordinator } from './recovery.js';
import { R16ReplayJournal } from './replayJournal.js';
import { R16ReplicationLedger } from './replication.js';
import { R16SnapshotCodec } from './snapshotCodec.js';
import { R16SnapshotStore } from './snapshotStore.js';
import { R16StateGraph } from './stateGraph.js';
import { R16Telemetry } from './observability.js';
import { R16WorkerScheduler } from './workerScheduler.js';
import { R16WorldInterest } from './worldInterest.js';
import { DEFAULT_R16_CONFIG, type R16RuntimeConfig } from './types.js';
import { R16RuntimePlatform } from './runtime.js';

export interface R16RuntimeFacadeConfig {
  readonly runtime?: Partial<R16RuntimeConfig>;
  readonly cache?: { readonly maxBytes:number; readonly maxItems:number; readonly maxPinnedBytes:number };
  readonly assetResidency?: { readonly maxBytes:number; readonly maxAssets:number; readonly maxCriticalBytes:number };
  readonly interest?: { readonly near:number; readonly mid:number; readonly far:number; readonly sleeping:number };
  readonly input?: ConstructorParameters<typeof R16InputRuntime>[0];
  readonly recoveryAttempts?: number;
}

export class R16RuntimeFacade {
  readonly runtime: R16RuntimePlatform;
  readonly input: R16InputRuntime;
  readonly frameClock: R16FixedStepClock;
  readonly frames: R16FrameScheduler;
  readonly cache: import('./cacheCoordinator.js').R16CacheCoordinator;
  readonly assets: R16AssetResidency;
  readonly workers: R16WorkerScheduler;
  readonly network: R16NetworkSecurityBoundary;
  readonly replay: R16ReplayJournal;
  readonly codec: R16SnapshotCodec;
  readonly performance: R16PerformanceGovernor;
  readonly recovery: R16RecoveryCoordinator;
  readonly interest: R16WorldInterest;
  readonly migrations: R16MigrationLedger;

  constructor(config:R16RuntimeFacadeConfig={}){
    const runtimeConfig=Object.freeze({...DEFAULT_R16_CONFIG,...sanitizeRuntimeConfig(config.runtime??{})});
    this.runtime=new R16RuntimePlatform(runtimeConfig);
    this.input=new R16InputRuntime(config.input??{});
    this.frameClock=new R16FixedStepClock(runtimeConfig.fixedStepMs);
    this.frames=new R16FrameScheduler();
    const cacheConfig=config.cache??{maxBytes:256*1024*1024,maxItems:8192,maxPinnedBytes:64*1024*1024};
    const assetConfig=config.assetResidency??{maxBytes:256*1024*1024,maxAssets:8192,maxCriticalBytes:64*1024*1024};
    this.cache=new R16CacheCoordinator(cacheConfig);
    this.assets=new R16AssetResidency(assetConfig);
    this.workers=new R16WorkerScheduler(runtimeConfig);
    this.network=new R16NetworkSecurityBoundary();
    this.replay=new R16ReplayJournal(runtimeConfig);
    this.codec=new R16SnapshotCodec();
    this.performance=new R16PerformanceGovernor();
    this.recovery=new R16RecoveryCoordinator(config.recoveryAttempts??3);
    this.interest=new R16WorldInterest(config.interest??{near:512,mid:2048,far:4096,sleeping:8192});
    this.migrations=new R16MigrationLedger();
  }

  start(){this.runtime.start();}
  stop(){this.runtime.stop();}
  get tick(){return this.runtime.tick;}
  get started(){return this.runtime.started;}

  step(realDeltaMs:number):readonly import('./frameScheduler.js').R16FrameScheduleResult[]{
    const steps=this.frameClock.advance(realDeltaMs);
    const results:import('./frameScheduler.js').R16FrameScheduleResult[]=[];
    for(const step of steps){
      this.input.beginTick(step.tick);
      results.push(...this.frames.runTick(step.tick,step.deltaMs));
      this.runtime.frame(this.runtime.tick+this.runtime.config.fixedStepMs);
    }
    return Object.freeze(results);
  }

  diagnostics():Readonly<Record<string,unknown>>{
    return Object.freeze({
      runtime:this.runtime.diagnostics(),
      input:this.input.stats(),
      clock:this.frameClock.stats(),
      pendingFrames:this.frames.pending().length,
      workers:this.workers.allStats(),
      network:this.network.stats(),
      replayDigest:this.replay.digest(),
      performance:{tier:this.performance.tier(),stableTicks:this.performance.stableTicks()},
      recovery:this.recovery.all(),
      interestEntities:this.interest.count(),
      migrations:this.migrations.audit(),
    });
  }

  reset(){
    this.runtime.reset();this.input.clear();this.frameClock.reset();this.frames.clear();this.cache.clear();this.assets.clear();this.workers.clear();this.network.clear();
    this.replay.clear();this.performance.reset();this.recovery.clear();this.interest.clear();this.migrations.clear();
  }
}

function sanitizeRuntimeConfig(config:Partial<R16RuntimeConfig>):Partial<R16RuntimeConfig>{
  const result:Partial<R16RuntimeConfig>={};
  for(const[key,value]of Object.entries(config)){if(typeof value!=='number'||!Number.isFinite(value))continue;(result as Record<string,unknown>)[key]=Math.max(1,Math.trunc(value));}
  return result;
}

