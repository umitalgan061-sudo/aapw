import type { AssetRequest, InputIntent, RawInputSample, RenderCapabilities, Result, Vec3 } from './liveCoreTypes.ts';
import type { AssetAdmission } from './assetRuntime.ts';
import type { LegacyGamepadLike, LegacyInputApi, LegacyRuntimeContext, LegacyVectorLike } from './bridgeTypes.ts';
import { entityId, err, ok, radialDeadzone, tickId, vec3 } from './liveCoreTypes.ts';
import { StrictInputRuntime } from './inputRuntime.ts';
import { StrictRenderBackendRuntime, probeRenderCapabilities, type RendererPreference } from './renderBackendRuntime.ts';
import { StrictAssetRuntime } from './assetRuntime.ts';

export interface BridgePolicy {
  readonly maxInputAgeSeconds:number;
  readonly maxCollisionCandidates:number;
  readonly maxAssetRequestsPerBatch:number;
  readonly defaultSource:'synthetic'|'keyboard'|'gamepad'|'touch';
}
export const DEFAULT_BRIDGE_POLICY:BridgePolicy=Object.freeze({maxInputAgeSeconds:.25,maxCollisionCandidates:256,maxAssetRequestsPerBatch:64,defaultSource:'synthetic'});

export interface BridgeDiagnostics {
  readonly convertedInputs:number;
  readonly rejectedInputs:number;
  readonly convertedAssets:number;
  readonly rejectedAssets:number;
  readonly collisionCandidates:number;
  readonly backend:'webgpu'|'webgl2'|'headless';
  readonly digest:string;
}
const finite=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;
const backendOf=(value:string|undefined):'webgpu'|'webgl2'|'headless'=>value==='webgpu'?'webgpu':value==='webgl2'?'webgl2':'headless';

export const legacyVectorToVec3=(value:LegacyVectorLike|undefined):Vec3=>vec3(finite(value?.x),finite(value?.y),finite(value?.z));
export const vec3ToLegacyVector=(value:Vec3):{x:number;y:number;z:number}=>({x:value.x,y:value.y,z:value.z});

export const legacyAxesToSample=(axes:ReturnType<NonNullable<LegacyInputApi['getAxes']>>,timestampSeconds:number,source:BridgePolicy['defaultSource']='synthetic'):RawInputSample=>{
  const held:Array<'guard'|'sprint'>=[]; const pressed:Array<'jump'|'lock-on'>=[];
  if(axes.guarding)held.push('guard'); if(axes.running)held.push('sprint'); if(axes.jumpRequested)pressed.push('jump'); if(axes.lockOnRequested)pressed.push('lock-on');
  return Object.freeze({source,moveX:finite(axes.strafe),moveY:finite(axes.forward),lookX:finite(axes.lookX),lookY:finite(axes.lookY),zoom:finite(axes.cameraZoom),held,pressed,timestampSeconds});
};

export const gamepadToSample=(pad:LegacyGamepadLike,timestampSeconds:number):RawInputSample=>{
  const axes=pad.axes??[]; const buttons=pad.buttons??[]; const pressedButton=(index:number)=>Boolean(buttons[index]?.pressed);
  const held:Array<'jump'|'dodge'|'light'|'heavy'|'guard'|'parry'|'sprint'|'lock-on'>=[]; const buttonMap:readonly [number,typeof held[number]][]=[[0,'jump'],[1,'dodge'],[2,'light'],[3,'heavy'],[4,'guard'],[5,'parry'],[10,'sprint'],[11,'lock-on']];
  for(const [index,action] of buttonMap)if(pressedButton(index))held.push(action);
  const move=radialDeadzone(finite(axes[0]),finite(axes[1]),.16); const look=radialDeadzone(finite(axes[2]),finite(axes[3]),.16);
  return Object.freeze({source:'gamepad',moveX:move.x,moveY:move.y,lookX:look.x,lookY:look.y,zoom:finite(buttons[7]?.value)-finite(buttons[6]?.value),held,pressed:[...held],timestampSeconds});
};

export const capabilitiesFromLegacy=(context:LegacyRuntimeContext):RenderCapabilities=>{
  const backend=backendOf(context.render?.getRendererBackend?.());
  return probeRenderCapabilities({secureContext:true,gpuAdapterAvailable:backend==='webgpu',webgl2ContextAvailable:backend==='webgl2'||backend==='webgpu',offscreenCanvas:false,hardwareConcurrency:8,memoryGiB:8,devicePixelRatio:finite(context.render?.getPixelRatio?.(),1)});
};

export class StrictLegacyLiveCoreBridge {
  readonly input:StrictInputRuntime; readonly assets:StrictAssetRuntime; readonly renderer:StrictRenderBackendRuntime;
  #policy:BridgePolicy; #convertedInputs=0; #rejectedInputs=0; #convertedAssets=0; #rejectedAssets=0; #disposed=false;
  constructor(context:LegacyRuntimeContext,preference:RendererPreference={backend:'auto',quality:'auto'},policy:BridgePolicy=DEFAULT_BRIDGE_POLICY){this.#policy=Object.freeze({...policy});this.input=new StrictInputRuntime();this.assets=new StrictAssetRuntime();this.renderer=new StrictRenderBackendRuntime(capabilitiesFromLegacy(context),preference);}
  submitLegacyInput(context:LegacyRuntimeContext,timestampSeconds:number):Result<InputIntent>{
    if(this.#disposed)return err('RUNTIME_DISPOSED','Bridge is disposed.');
    const axes=context.input?.getAxes?.(); if(!axes)return err('INVALID_INPUT','Legacy input provider has no getAxes() adapter.',true);
    const sample=legacyAxesToSample(axes,timestampSeconds,this.#policy.defaultSource); const result=this.input.submit(sample); if(result.ok)this.#convertedInputs++;else this.#rejectedInputs++; return result.ok?ok(result.value.intent):result;
  }
  submitGamepad(pad:LegacyGamepadLike,timestampSeconds:number):Result<InputIntent>{if(this.#disposed)return err('RUNTIME_DISPOSED','Bridge is disposed.');if(pad.connected===false)return err('INVALID_INPUT','Gamepad is not connected.',true);const result=this.input.submit(gamepadToSample(pad,timestampSeconds));if(result.ok)this.#convertedInputs++;else this.#rejectedInputs++;return result.ok?ok(result.value.intent):result;}
  admitAsset(request:AssetRequest,tick:number):Result<AssetAdmission>{if(this.#disposed)return err('RUNTIME_DISPOSED','Bridge is disposed.');const result=this.assets.admit(request,tickId(tick));if(result.ok)this.#convertedAssets++;else this.#rejectedAssets++;return result;}
  normalizeVector(value:LegacyVectorLike|undefined):Vec3{return legacyVectorToVec3(value);}
  rendererPolicy(){return this.renderer.policy();}
  setRendererPreference(preference:RendererPreference){return this.#disposed?this.renderer.policy():this.renderer.requestPreference(preference);}
  deviceLost(){return this.renderer.markDeviceLost();}
  diagnostics():BridgeDiagnostics{return Object.freeze({convertedInputs:this.#convertedInputs,rejectedInputs:this.#rejectedInputs,convertedAssets:this.#convertedAssets,rejectedAssets:this.#rejectedAssets,collisionCandidates:0,backend:this.renderer.policy().backend,digest:JSON.stringify({i:this.#convertedInputs,r:this.#rejectedInputs,a:this.#convertedAssets})});}
  dispose(){if(this.#disposed)return;this.input.dispose();this.assets.dispose();this.renderer.dispose();this.#disposed=true;}
}

void entityId;