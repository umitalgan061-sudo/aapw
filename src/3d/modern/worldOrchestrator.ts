import type { AssetDescriptor, EntityId, FrameMetrics, RuntimeSystem, SystemContext, TimestampMs, WorldSnapshot } from './types';
import { AdaptiveQualityController } from './adaptiveQuality';
import { AssetRegistry } from './assetRegistry';
import { EntityQueryPlanner } from './entityQueryPlanner';
import { FrameProfiler } from './frameProfiler';
import { RuntimeDiagnostics } from './runtimeDiagnostics';
import { SceneGraph } from './sceneGraph';
import { SpatialHashGrid } from './spatialIndex';
import { DeterministicSimulation, InputTimeline } from './deterministicSimulation';
import { WorldStreamingCoordinator, type StreamManifestEntry, type StreamObserver } from './worldStreaming';
import { RuntimeTelemetry } from './telemetry';

export interface WorldOrchestratorOptions { readonly seed:number;readonly assetByteBudget?:number;readonly assetEntryBudget?:number;readonly targetFps?:number;readonly maxEntities?:number;readonly simulationHz?:number;readonly maxSimulationSteps?:number; }
export interface WorldOrchestratorFrame { readonly timestamp:TimestampMs;readonly metrics:FrameMetrics;readonly quality:ReturnType<AdaptiveQualityController['state']>;readonly streamed:{readonly load:readonly string[];readonly unload:readonly string[];readonly retain:readonly string[]};readonly diagnostics:ReturnType<RuntimeDiagnostics['snapshot']>;readonly telemetry:Readonly<Record<string,number|object>>; }
export interface WorldOrchestratorSnapshot extends WorldSnapshot { readonly orchestratorVersion:1;readonly simulationTick:number;readonly inputHash:number; }

/** High-level typed coordinator binding simulation, streaming, scene, spatial and diagnostics subsystems. */
export class WorldOrchestrator implements RuntimeSystem {
 public readonly name='world-orchestrator';public readonly priority=50;
 private readonly seed:number;private readonly quality:AdaptiveQualityController;private readonly diagnostics:RuntimeDiagnostics;private readonly telemetry:RuntimeTelemetry;private readonly profiler:FrameProfiler;private readonly simulation:DeterministicSimulation;private readonly inputs:InputTimeline;private readonly queries:EntityQueryPlanner;private readonly scene:SceneGraph;private readonly spatial:SpatialHashGrid;private readonly assets:AssetRegistry;private readonly streaming:WorldStreamingCoordinator;private disposed=false;
 public constructor(options:WorldOrchestratorOptions,dependencies:{readonly assets?:AssetRegistry}={}){this.seed=options.seed>>>0;this.quality=new AdaptiveQualityController('high',{targetFps:options.targetFps??60});this.diagnostics=new RuntimeDiagnostics();this.telemetry=new RuntimeTelemetry();this.profiler=new FrameProfiler(240);this.simulation=new DeterministicSimulation(1/Math.max(1,options.simulationHz??60),options.maxSimulationSteps??5);this.inputs=new InputTimeline(720);this.queries=new EntityQueryPlanner(256);this.scene=new SceneGraph();this.spatial=new SpatialHashGrid(32);this.assets=dependencies.assets??new AssetRegistry({byteBudget:options.assetByteBudget??512*1024*1024,entryBudget:options.assetEntryBudget??2048});this.streaming=new WorldStreamingCoordinator(this.assets);}
 public configureAssets(entries:readonly StreamManifestEntry[]):void{this.ensure();this.streaming.register(entries);}
 public registerAssetLoader<T>(kind:AssetDescriptor['kind'],loader:(descriptor:AssetDescriptor,context:any)=>Promise<T>):void{this.ensure();this.assets.register(kind,loader as any);}
 public beginInputFrame(tick:number,actions:Readonly<Record<string,boolean>>,axes:Readonly<Record<string,number>>):void{this.ensure();this.inputs.push({tick,actions:{...actions},axes:{...axes}});}
 public addSimulationTask(task:Parameters<DeterministicSimulation['register']>[0]):void{this.ensure();this.simulation.register(task);}
 public addSpatialEntity(item:Parameters<SpatialHashGrid['insert']>[0]):void{this.ensure();this.spatial.insert(item);}
 public removeSpatialEntity(id:EntityId):boolean{this.ensure();return this.spatial.remove(id);}
 public createSceneNode(id:EntityId,local:Parameters<SceneGraph['create']>[1]={}):void{this.ensure();this.scene.create(id,local);}
 public attachSceneNode(childId:EntityId,parentId:EntityId|null):boolean{this.ensure();return this.scene.attach(childId,parentId);}
 public setSceneTransform(id:EntityId,patch:Parameters<SceneGraph['setLocal']>[1]):boolean{this.ensure();return this.scene.setLocal(id,patch);}
 public updateScene():void{this.ensure();this.scene.update();}
 public stream(observer:StreamObserver):ReturnType<WorldStreamingCoordinator['update']>{this.ensure();return this.streaming.update(observer);}
 public query(filter:Parameters<EntityQueryPlanner['makePlan']>[0],source:Parameters<EntityQueryPlanner['execute']>[1]){this.ensure();return this.queries.execute(this.queries.makePlan(filter),source);}
 public async update(timestampMs:number,metrics:FrameMetrics,observer?:StreamObserver):Promise<WorldOrchestratorFrame>{this.ensure();this.profiler.begin(metrics.frameId,metrics.timestamp,metrics.cpuMs,metrics.gpuMs);this.telemetry.gauge('frame.cpu_ms',metrics.cpuMs);if(metrics.gpuMs!==null)this.telemetry.gauge('frame.gpu_ms',metrics.gpuMs);this.diagnostics.recordFrame(metrics,this.quality.state(),this.assets.stats().residentBytes);const started=performance.now();await this.simulation.advance(timestampMs);this.profiler.sample('simulation.tick','simulation',started,Math.max(0,performance.now()-started));this.scene.update();const qualityPlan=this.quality.observe({cpuMs:metrics.cpuMs,gpuMs:metrics.gpuMs,timestampMs});const streamed=observer?await this.streaming.update(observer):{load:[],unload:[],retain:[],timestamp:metrics.timestamp};this.telemetry.increment('stream.load_count',streamed.load.length);this.telemetry.increment('stream.unload_count',streamed.unload.length);this.telemetry.gauge('world.spatial_cells',this.spatial.cellCount());this.telemetry.gauge('assets.resident_bytes',this.assets.stats().residentBytes);const frameProfile=this.profiler.end();if(!frameProfile)return this.frameOutput(metrics,qualityPlan.quality,streamed);return this.frameOutput(metrics,qualityPlan.quality,streamed);}
 private frameOutput(metrics:FrameMetrics,quality:ReturnType<AdaptiveQualityController['state']>,streamed:{readonly load:readonly string[];readonly unload:readonly string[];readonly retain:readonly string[]}):WorldOrchestratorFrame{return{timestamp:metrics.timestamp,metrics,quality,streamed,diagnostics:this.diagnostics.snapshot(),telemetry:this.telemetry.snapshot() as Readonly<Record<string,number|object>>};}
 public updateSystem(context:SystemContext):void{this.ensure();this.telemetry.gauge('world.revision',Number(context.worldRevision));this.telemetry.gauge('world.visible_entities',context.frame.visibleObjects);}
 public update(context:SystemContext):void{this.updateSystem(context);}
 public capture(world:WorldSnapshot):WorldOrchestratorSnapshot{this.ensure();return{...world,orchestratorVersion:1,simulationTick:this.simulation.tickIdValue(),inputHash:this.inputs.hash()};}
 public restore(snapshot:WorldOrchestratorSnapshot):void{this.ensure();if(snapshot.orchestratorVersion!==1)throw new Error('ORCHESTRATOR_VERSION_UNSUPPORTED');this.simulation.reset();this.inputs.clear();this.queries.invalidateAll();}
 public status(){this.ensure();return{seed:this.seed,simulation:this.simulation.metrics(),assets:this.assets.stats(),spatial:{size:this.spatial.size(),cells:this.spatial.cellCount()},sceneNodes:this.scene.size(),quality:this.quality.state()};}
 public dispose():void{if(this.disposed)return;this.simulation.dispose();this.scene.dispose();this.spatial.clear();this.streaming.dispose();this.profiler.dispose();this.diagnostics.dispose();this.telemetry.dispose();this.queries.dispose();this.disposed=true;}
 private ensure():void{if(this.disposed)throw new Error('WORLD_ORCHESTRATOR_DISPOSED');}
}
