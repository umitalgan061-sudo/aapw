import type { RuntimeId, TickId, RuntimeHealthV4 } from './runtimeContractsV4';
import { tickId, runtimeId } from './runtimeContractsV4';
import { TypedInputRuntimeV6, installDefaultInputBindingsV6 } from './typedInputRuntimeV6';
import { TypedCameraRuntimeV6, DefaultCameraCollisionProbeV6 } from './typedCameraRuntimeV6';
import { TypedWorldRuntimeV6 } from './typedWorldRuntimeV6';
import { TypedPlayerRuntimeV6, type GroundProbeV6 } from './typedPlayerRuntimeV6';
import { TypedRenderLoopV6 } from './typedRenderLoopV6';
import { TypedLegacyAdapterV6, type LegacySceneLikeV6 } from './typedLegacyAdapterV6';
import { TypedMigrationGateV6, type MigrationGateReportV6 } from './typedMigrationGateV6';
import { type CameraIntentV6, type InputSnapshotV6, type SceneFrameV6, type FrameId, frameId, vec3FromMutableV6 } from './typedSceneContractsV6';

export interface TypedGameRuntimeOptionsV6 {
  readonly runtimeId?: string;
  readonly targetFrameMs?: number;
  readonly fixedStepMs?: number;
  readonly ground?: GroundProbeV6;
  readonly maxResidentChunks?: number;
  readonly maxResidentBytes?: number;
  readonly now?:()=>number;
}
export interface RuntimeFacadeMetricsV6 { readonly frames:number; readonly ticks:number; readonly errors:number; readonly handoffs:number; readonly inputEvents:number; readonly worldObjects:number; readonly residentChunks:number; readonly quality:string; readonly migrationReady:boolean; }
export interface RuntimeFacadeSnapshotV6 { readonly version:6;readonly runtime:RuntimeId;readonly frame:FrameId;readonly tick:TickId;readonly health:RuntimeHealthV4;readonly input:InputSnapshotV6;readonly camera:ReturnType<TypedCameraRuntimeV6['state']>;readonly player:ReturnType<TypedPlayerRuntimeV6['state']>;readonly world:ReturnType<TypedWorldRuntimeV6['metrics']>;readonly migration:MigrationGateReportV6;readonly metrics:RuntimeFacadeMetricsV6;readonly checksum:string; }

const digest=(value:unknown):string=>{const text=JSON.stringify(value);let hash=2166136261;for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');};
const defaultGround:GroundProbeV6={heightAt:()=>0,normalAt:()=>({x:0,y:1,z:0})};

export class TypedGameRuntimeV6{
 readonly id:RuntimeId;readonly input:TypedInputRuntimeV6;readonly camera:TypedCameraRuntimeV6;readonly world:TypedWorldRuntimeV6;readonly player:TypedPlayerRuntimeV6;readonly loop:TypedRenderLoopV6;readonly migration:TypedMigrationGateV6;readonly adapter:TypedLegacyAdapterV6;
 #scene:LegacySceneLikeV6|null=null;#running=false;#errors=0;#handoffs=0;#lastInput:InputSnapshotV6=this.#emptyInput();#lastFrame:SceneFrameV6|null=null;#now:()=>number;#startedAt=0;
 constructor(options:TypedGameRuntimeOptionsV6={}){this.id=runtimeId(options.runtimeId??`typed-v6-${Date.now()}`);this.#now=options.now??(()=>performance.now());this.input=new TypedInputRuntimeV6({now:this.#now});installDefaultInputBindingsV6(this.input);this.camera=new TypedCameraRuntimeV6();this.world=new TypedWorldRuntimeV6({maxResidentChunks:options.maxResidentChunks,maxResidentBytes:options.maxResidentBytes});this.player=new TypedPlayerRuntimeV6(options.ground??defaultGround);this.loop=new TypedRenderLoopV6({now:this.#now},{fixedStepMs:options.fixedStepMs,targetFrameMs:options.targetFrameMs});this.migration=new TypedMigrationGateV6(this.id);this.adapter=new TypedLegacyAdapterV6({world:this.world,player:this.player,camera:this.camera,input:this.input,loop:this.loop},{now:this.#now});}
 attach(scene:LegacySceneLikeV6):void{this.#scene=scene;this.adapter.attach(scene);this.#handoffs+=1;this.migration.observe('render',{attached:true},{attached:true},0,0,this.#now());}
 start():void{if(this.#running)return;this.#running=true;this.#startedAt=this.#now();this.loop.start(this.#startedAt);}
 pause():void{this.#running=false;this.loop.pause();}
 resume():void{if(this.#running)return;this.start();}
 stop():void{this.#running=false;this.loop.pause();}
 running():boolean{return this.#running;}
 pushKey(code:string,pressed=true):void{pressed?this.input.press('keyboard',code,this.#now()):this.input.release('keyboard',code,this.#now());}
 pushAxis(device:'gamepad'|'touch'|'virtual',code:string,value:number):void{this.input.axis(device,code,value,this.#now());}
 cameraIntent(intent:CameraIntentV6):void{this.camera.applyIntent(intent);}
 async frame(nowMs=this.#now()):Promise<SceneFrameV6|null>{if(!this.#running)return null;const tick=tickId(Number(this.loop.tick())+1);const scene=this.#scene;if(!scene)return null;const result=await this.adapter.frame(tick,Math.max(0,nowMs-this.#startedAt)/1000);this.#lastInput=this.input.history().at(-1)??this.#emptyInput();this.#lastFrame=result;return result;}
 snapshot():RuntimeFacadeSnapshotV6{const state=this.#lastFrame;const input=this.#lastInput;const health=state?.health??this.#health();const metrics:RuntimeFacadeMetricsV6={frames:Number(this.loop.frame()),ticks:Number(this.loop.tick()),errors:this.#errors,handoffs:this.#handoffs,inputEvents:this.input.metrics().consumed,worldObjects:this.world.metrics().objects,residentChunks:this.world.metrics().residentChunks,quality:this.loop.quality(),migrationReady:this.migration.report().ready};const body={version:6,runtime:this.id,frame:this.loop.frame(),tick:this.loop.tick(),health,input,camera:this.camera.state(),player:this.player.state(),world:this.world.metrics(),migration:this.migration.report(),metrics};return Object.freeze({...body,checksum:digest(body)});}
 restore(snapshot:RuntimeFacadeSnapshotV6):boolean{const body={version:snapshot.version,runtime:snapshot.runtime,frame:snapshot.frame,tick:snapshot.tick,health:snapshot.health,input:snapshot.input,camera:snapshot.camera,player:snapshot.player,world:snapshot.world,migration:snapshot.migration,metrics:snapshot.metrics};if(digest(body)!==snapshot.checksum||snapshot.version!==6||snapshot.runtime!==this.id)return false;this.camera.focus({target:snapshot.camera.target,distance:snapshot.camera.distance,yaw:snapshot.camera.yaw,pitch:snapshot.camera.pitch});this.player.spawn(vec3FromMutableV6(snapshot.player.position));this.player.heal(snapshot.player.maxHealth);return true;}
 diagnostics():RuntimeFacadeSnapshotV6{return this.snapshot();}
 health():RuntimeHealthV4{return this.#health();}
 migrationReport():MigrationGateReportV6{return this.migration.report();}
 dispose():void{this.stop();this.adapter.dispose();this.#scene=null;}
 #health():RuntimeHealthV4{const input=this.input.metrics();const world=this.world.metrics();const render=this.loop.metrics();const score=Math.max(0,100-render.renderErrors*12-render.droppedFrames*4-world.failed*2-input.dropped*0.5);return Object.freeze({phase:this.#running?'running':'paused',score,errors:render.renderErrors+this.#errors,warnings:input.dropped+world.failed,stalled:render.maxCpuMs>50,memoryPressure:0,networkPressure:0,renderPressure:Math.min(1,render.maxCpuMs/33),simulationDrift:0});}
 #emptyInput():InputSnapshotV6{return Object.freeze({tick:0 as TickId,frame:frameId(0),moveX:0,moveZ:0,cameraX:0,cameraY:0,sprint:false,jump:false,interact:false,pause:false,debug:false,source:'system'});}
}

export function createTypedGameRuntimeV6(options:TypedGameRuntimeOptionsV6={}):TypedGameRuntimeV6{return new TypedGameRuntimeV6(options);}
