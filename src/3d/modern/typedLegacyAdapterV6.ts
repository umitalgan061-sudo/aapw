import type { RuntimeHealthV4, RuntimeId, TickId } from './runtimeContractsV4';
import { type TypedCameraRuntimeV6 } from './typedCameraRuntimeV6';
import { type TypedInputRuntimeV6 } from './typedInputRuntimeV6';
import { type TypedPlayerRuntimeV6 } from './typedPlayerRuntimeV6';
import { type TypedRenderLoopV6 } from './typedRenderLoopV6';
import { type TypedWorldRuntimeV6 } from './typedWorldRuntimeV6';
import { type CameraIntentV6, type FrameId, type SceneFrameV6, frameId } from './typedSceneContractsV6';

export interface LegacyVectorLike { x:number; y:number; z:number; set?: (x:number,y:number,z:number)=>void; }
export interface LegacyObjectLike { position:LegacyVectorLike; rotation?:{x?:number;y?:number;z?:number}; scale?:LegacyVectorLike; visible?:boolean; userData?:Record<string,unknown>; }
export interface LegacyControlsLike { target:LegacyVectorLike; enablePan?:boolean; update?:()=>void; }
export interface LegacyRendererLike { render?: (scene:unknown,camera:unknown)=>void; setPixelRatio?: (ratio:number)=>void; info?:{render?:{calls?:number;triangles?:number}}; }
export interface LegacySceneLikeV6 { scene:unknown; camera:LegacyObjectLike; renderer:LegacyRendererLike; controls?:LegacyControlsLike; player?:LegacyObjectLike|null; chunkManager?:{loadedCount?:number}; }
export interface LegacyAdapterOptionsV6 { readonly maxSyncObjects?:number; readonly syncVisibility?:boolean; readonly now?:()=>number; }
export interface LegacyAdapterMetricsV6 { readonly frames:number; readonly cameraSyncs:number; readonly playerSyncs:number; readonly chunkSyncs:number; readonly renderCalls:number; readonly rendererErrors:number; readonly objectWrites:number; readonly droppedSyncs:number; }

const finite=(v:unknown,f=0):number=>typeof v==='number'&&Number.isFinite(v)?v:f;
const clamp=(v:number,min:number,max:number):number=>Math.max(min,Math.min(max,v));

export class TypedLegacyAdapterV6 {
  readonly world:TypedWorldRuntimeV6; readonly player:TypedPlayerRuntimeV6; readonly camera:TypedCameraRuntimeV6; readonly input:TypedInputRuntimeV6; readonly loop:TypedRenderLoopV6;
  readonly maxSyncObjects:number; readonly syncVisibility:boolean;
  #now:()=>number; #scene:LegacySceneLikeV6|null=null;
  #metrics:LegacyAdapterMetricsV6=Object.freeze({frames:0,cameraSyncs:0,playerSyncs:0,chunkSyncs:0,renderCalls:0,rendererErrors:0,objectWrites:0,droppedSyncs:0});
  constructor(deps:{world:TypedWorldRuntimeV6;player:TypedPlayerRuntimeV6;camera:TypedCameraRuntimeV6;input:TypedInputRuntimeV6;loop:TypedRenderLoopV6},options:LegacyAdapterOptionsV6={}) { this.world=deps.world;this.player=deps.player;this.camera=deps.camera;this.input=deps.input;this.loop=deps.loop;this.maxSyncObjects=Math.max(16,Math.trunc(options.maxSyncObjects??2000));this.syncVisibility=options.syncVisibility??true;this.#now=options.now??(()=>performance.now()); }
  attach(scene:LegacySceneLikeV6):void{this.#scene=scene;this.syncCamera();this.syncPlayer();}
  detach():void{this.#scene=null;}
  scene():LegacySceneLikeV6|null{return this.#scene;}
  metrics():LegacyAdapterMetricsV6{return this.#metrics;}
  setCameraIntent(intent:CameraIntentV6):void{this.camera.applyIntent(intent);}
  inputPress(device:Parameters<TypedInputRuntimeV6['press']>[0],code:string):void{this.input.press(device,code,this.#now());}
  inputRelease(device:Parameters<TypedInputRuntimeV6['release']>[0],code:string):void{this.input.release(device,code,this.#now());}
  inputAxis(device:Parameters<TypedInputRuntimeV6['axis']>[0],code:string,value:number):void{this.input.axis(device,code,value,this.#now());}
  async frame(tick:TickId,deltaSeconds:number):Promise<SceneFrameV6|null>{
    const scene=this.#scene;if(!scene){this.#metrics=Object.freeze({...this.#metrics,droppedSyncs:this.#metrics.droppedSyncs+1});return null;}
    const frameNumber=this.#metrics.frames+1;
    const input=this.input.consume(tick,frameNumber);
    this.player.tick(input,deltaSeconds,tick);
    this.camera.update(deltaSeconds*1000);
    this.world.setPlayerPosition(this.player.state().position);this.world.updateStreaming();
    const visibility=this.world.nearest(this.player.state().position,this.camera.state().distance*2,Math.min(this.maxSyncObjects, this.world.metrics().objects));
    this.syncCamera();this.syncPlayer();this.syncChunks();this.syncObjects(visibility.map((object)=>object.id));
    const renderResult=await this.loop.step(async(context)=>this.#render(context),async()=>undefined,this.#now());
    this.#metrics=Object.freeze({...this.#metrics,frames:this.#metrics.frames+1,renderCalls:this.#metrics.renderCalls+(renderResult?.submitted?1:0)});
    if(!renderResult)return null;
    return this.loop.createSceneFrame('legacy-adapter' as RuntimeId,this.camera.state(),this.player.state(),this.world.chunks(),visibility.map((object)=>object.id),this.#health());
  }
  diagnostics():Readonly<{runtime:string;frame:FrameId;tick:TickId;health:RuntimeHealthV4;adapter:LegacyAdapterMetricsV6}> { return Object.freeze({runtime:'typed-v6-legacy-adapter',frame:frameId(this.#metrics.frames),tick:this.loop.tick(),health:this.#health(),adapter:this.#metrics}); }
  dispose():void{this.#scene=null;this.input.clear();this.loop.pause();}
  private #health():RuntimeHealthV4{const errors=this.#metrics.rendererErrors;const score=clamp(100-errors*10-this.#metrics.droppedSyncs*2,0,100);return Object.freeze({phase:'running',score,errors,warnings:this.#metrics.droppedSyncs,stalled:false,memoryPressure:0,networkPressure:0,renderPressure:errors>0?1:0,simulationDrift:0});}
  private async #render(context:{frame:FrameId;budget:{readonly renderScale:number}}):Promise<{frame:FrameId;submitted:boolean;drawCalls:number;triangles:number;visible:number;culled:number;cpuMs:number;budgetMs:number;quality:any}>{
    const scene=this.#scene!; const started=this.#now(); const calls=finite(scene.renderer.info?.render?.calls); const triangles=finite(scene.renderer.info?.render?.triangles);
    try{scene.renderer.setPixelRatio?.(clamp(context.budget.renderScale,0.5,1.2));scene.renderer.render?.(scene.scene,scene.camera);return Object.freeze({frame:context.frame,submitted:true,drawCalls:calls,triangles,visible:this.world.metrics().objects,culled:0,cpuMs:Math.max(0,this.#now()-started),budgetMs:16.67,quality:'high'});}
    catch(cause){this.#metrics=Object.freeze({...this.#metrics,rendererErrors:this.#metrics.rendererErrors+1});return Object.freeze({frame:context.frame,submitted:false,drawCalls:0,triangles:0,visible:0,culled:0,cpuMs:Math.max(0,this.#now()-started),budgetMs:16.67,quality:'safe'});}
  }
  private syncCamera():void{const scene=this.#scene;if(!scene)return;const state=this.camera.state();writeVec(scene.camera.position,state.position);if(scene.controls){writeVec(scene.controls.target,state.target);scene.controls.enablePan=state.enablePan;scene.controls.update?.();}this.#metrics=Object.freeze({...this.#metrics,cameraSyncs:this.#metrics.cameraSyncs+1,objectWrites:this.#metrics.objectWrites+2});}
  private syncPlayer():void{const scene=this.#scene;const player=this.player.state();if(!scene?.player)return;writeVec(scene.player.position,player.position);if(scene.player.rotation)scene.player.rotation.y=player.yaw;this.#metrics=Object.freeze({...this.#metrics,playerSyncs:this.#metrics.playerSyncs+1,objectWrites:this.#metrics.objectWrites+2});}
  private syncChunks():void{const scene=this.#scene;if(!scene)return;void scene.chunkManager?.loadedCount;this.#metrics=Object.freeze({...this.#metrics,chunkSyncs:this.#metrics.chunkSyncs+1});}
  private syncObjects(ids:readonly string[]):void{const scene=this.#scene;if(!scene)return;for(const id of ids.slice(0,this.maxSyncObjects)){const object=this.world.object(id as never);if(!object)continue;void object.visible;this.#metrics=Object.freeze({...this.#metrics,objectWrites:this.#metrics.objectWrites+1});}if(!this.syncVisibility) return;}
}
function writeVec(target:LegacyVectorLike,value:{x:number;y:number;z:number}):void{if(typeof target.set==='function')target.set(value.x,value.y,value.z);else{target.x=value.x;target.y=value.y;target.z=value.z;}}
