import type { RuntimeId, TickId } from './runtimeContractsV4';
import { TypedGameRuntimeV6 } from './typedRuntimeFacadeV6';
import { type LegacySceneLikeV6 } from './typedLegacyAdapterV6';
import { type MigrationSurfaceV4 } from './migrationV4';
import { type SceneFrameV6, type InputSnapshotV6, type CameraStateV6, type PlayerStateV6 } from './typedSceneContractsV6';

export interface LegacyDigestProviderV6 { readonly read: (surface:MigrationSurfaceV4)=>unknown; }
export interface MigrationBridgeOptionsV6 { readonly runtimeId?:string; readonly sampleEveryFrames?:number; readonly strict?:boolean; readonly now?:()=>number; }
export interface MigrationBridgeMetricsV6 { readonly frames:number; readonly shadowFrames:number; readonly parityChecks:number; readonly mismatches:number; readonly promoted:number; readonly errors:number; }
export interface MigrationBridgeFrameV6 { readonly frame:number;readonly tick:TickId;readonly typed:SceneFrameV6|null;readonly typedInput:InputSnapshotV6;readonly camera:CameraStateV6;readonly player:PlayerStateV6;readonly health:ReturnType<TypedGameRuntimeV6['health']>;readonly mismatches:number; }

const digest=(value:unknown):string=>{const text=JSON.stringify(value);let hash=2166136261;for(let i=0;i<text.length;i+=1){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');};

export class TypedMigrationBridgeV6{
 readonly runtime:TypedGameRuntimeV6;readonly runtimeId:RuntimeId;readonly sampleEveryFrames:number;readonly strict:boolean;
 #legacy:LegacyDigestProviderV6|null=null;#frames=0;#shadowFrames=0;#parityChecks=0;#mismatches=0;#promoted=0;#errors=0;#scene:LegacySceneLikeV6|null=null;#now:()=>number;
 constructor(runtime:TypedGameRuntimeV6,options:MigrationBridgeOptionsV6={}){this.runtime=runtime;this.runtimeId=runtime.id;this.sampleEveryFrames=Math.max(1,Math.trunc(options.sampleEveryFrames??5));this.strict=options.strict??false;this.#now=options.now??(()=>performance.now());}
 attachLegacy(scene:LegacySceneLikeV6,digestProvider?:LegacyDigestProviderV6):void{this.#scene=scene;this.#legacy=digestProvider??null;this.runtime.attach(scene);}
 detachLegacy():void{this.#scene=null;this.#legacy=null;}
 start():void{this.runtime.start();}
 pause():void{this.runtime.pause();}
 resume():void{this.runtime.resume();}
 pushKeyboard(code:string,pressed=true):void{this.runtime.pushKey(code,pressed);}
 async frame(nowMs=this.#now()):Promise<MigrationBridgeFrameV6|null>{
   this.#frames+=1;
   try{
     const typed=await this.runtime.frame(nowMs);
     if(typed)this.#shadowFrames+=1;
     if(this.#legacy&&this.#frames%this.sampleEveryFrames===0){this.#parityChecks+=1;this.#compare('camera',this.runtime.camera.state());this.#compare('movement',this.runtime.player.state());this.#compare('render',typed?.visibleObjects??[]);}
     const input=this.runtime.input.history().at(-1)??this.#emptyInput();
     return Object.freeze({frame:this.#frames,tick:this.runtime.loop.tick(),typed,typedInput:input,camera:this.runtime.camera.state(),player:this.runtime.player.state(),health:this.runtime.health(),mismatches:this.#mismatches});
   }catch(cause){this.#errors+=1;if(this.strict)throw cause;return null;}
 }
 promote(surface:MigrationSurfaceV4):boolean{const ok=this.runtime.migration.promote(surface);if(ok)this.#promoted+=1;return ok;}
 migrationReport(){return this.runtime.migration.report();}
 metrics():MigrationBridgeMetricsV6{return Object.freeze({frames:this.#frames,shadowFrames:this.#shadowFrames,parityChecks:this.#parityChecks,mismatches:this.#mismatches,promoted:this.#promoted,errors:this.#errors});}
 assertHealthy():void{if(this.#errors>0)throw new Error(`migration bridge errors: ${this.#errors}`);if(this.#mismatches>0)throw new Error(`migration bridge mismatches: ${this.#mismatches}`);}
 diagnostics():Readonly<Record<string,unknown>>{return Object.freeze({runtime:String(this.runtimeId),frames:this.#frames,shadowFrames:this.#shadowFrames,parityChecks:this.#parityChecks,mismatches:this.#mismatches,promoted:this.#promoted,errors:this.#errors,migration:this.migrationReport()});}
 dispose():void{this.detachLegacy();this.runtime.dispose();}
 #compare(surface:MigrationSurfaceV4,modern:unknown):void{const legacy=this.#legacy?.read(surface);if(legacy===undefined)return;const a=digest(legacy);const b=digest(modern);this.runtime.migration.observe(surface,legacy,modern,this.#frames,this.#scene?0:1,this.#now());if(a!==b)this.#mismatches+=1;}
 #emptyInput():InputSnapshotV6{return Object.freeze({tick:this.runtime.loop.tick(),frame:this.runtime.loop.frame(),moveX:0,moveZ:0,cameraX:0,cameraY:0,sprint:false,jump:false,interact:false,pause:false,debug:false,source:'system'});}
}

export function createMigrationBridgeV6(options:MigrationBridgeOptionsV6={}):TypedMigrationBridgeV6{return new TypedMigrationBridgeV6(new TypedGameRuntimeV6({runtimeId:options.runtimeId,now:options.now}),options);}
