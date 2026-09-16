import type { DeviceCapabilities, Disposable, PowerPreference } from './types';

export interface NetworkState {
  readonly online:boolean;
  readonly effectiveType:string|null;
  readonly downlinkMbps:number|null;
  readonly rttMs:number|null;
  readonly saveData:boolean;
}
export interface BatteryState {
  readonly supported:boolean;
  readonly level:number|null;
  readonly charging:boolean|null;
  readonly chargingTimeSeconds:number|null;
  readonly dischargingTimeSeconds:number|null;
}
export interface ViewportState {
  readonly width:number;
  readonly height:number;
  readonly dpr:number;
  readonly orientation:'portrait'|'landscape';
}
export interface PlatformSnapshot {
  readonly capabilities:DeviceCapabilities;
  readonly network:NetworkState;
  readonly battery:BatteryState;
  readonly viewport:ViewportState;
  readonly visibility:'visible'|'hidden';
  readonly focused:boolean;
  readonly timestamp:number;
}
export interface PlatformEvents {
  onChange?(snapshot:PlatformSnapshot):void;
}

interface NavigatorConnection { effectiveType?:string;downlink?:number;rtt?:number;saveData?:boolean;addEventListener?:(type:string,listener:()=>void)=>void;removeEventListener?:(type:string,listener:()=>void)=>void; }
interface BatteryLike { level:number;charging:boolean;chargingTime:number;dischargingTime:number;addEventListener:(type:string,listener:()=>void)=>void;removeEventListener:(type:string,listener:()=>void)=>void; }

/** Browser lifecycle/capability adapter for power, network, visibility and viewport changes. */
export class BrowserPlatformAdapter implements Disposable {
 private readonly listeners:PlatformEvents;
 private readonly cleanups:Array<()=>void>=[];
 private disposed=false;
 private snapshotValue:PlatformSnapshot;
 private battery:BatteryLike|null=null;
 constructor(listeners:PlatformEvents={}){this.listeners=listeners;this.snapshotValue=this.readSnapshot();this.attach();}
 public snapshot():PlatformSnapshot{return this.snapshotValue;}
 public refresh():PlatformSnapshot{this.ensure();this.snapshotValue=this.readSnapshot();this.listeners.onChange?.(this.snapshotValue);return this.snapshotValue;}
 private attach():void{
  if(typeof window==='undefined')return;
  const add=(target:EventTarget,type:string,handler:EventListener)=>{target.addEventListener(type,handler);this.cleanups.push(()=>target.removeEventListener(type,handler));};
  add(window,'online',()=>this.refresh());
  add(window,'offline',()=>this.refresh());
  add(window,'resize',()=>this.refresh());
  add(window,'orientationchange',()=>this.refresh());
  add(window,'focus',()=>this.refresh());
  add(window,'blur',()=>this.refresh());
  if(typeof document!=='undefined')add(document,'visibilitychange',()=>this.refresh());
  const connection=(navigator as Navigator&{connection?:NavigatorConnection}).connection;
  if(connection?.addEventListener){const listener=()=>this.refresh();connection.addEventListener('change',listener);this.cleanups.push(()=>connection.removeEventListener?.('change',listener));}
  const batteryFn=(navigator as Navigator&{getBattery?:()=>Promise<BatteryLike>}).getBattery;
  if(batteryFn)void batteryFn.call(navigator).then(battery=>{if(this.disposed)return;this.battery=battery;for(const event of ['chargingchange','levelchange','chargingtimechange','dischargingtimechange']){const listener=()=>this.refresh();battery.addEventListener(event,listener);this.cleanups.push(()=>battery.removeEventListener(event,listener));}this.refresh();}).catch(()=>undefined);
 }
 private readSnapshot():PlatformSnapshot{
  const capabilities=this.detectCapabilities();
  const connection=(typeof navigator!=='undefined'?(navigator as Navigator&{connection?:NavigatorConnection}).connection:undefined);
  const network:NetworkState={online:typeof navigator==='undefined'?true:navigator.onLine,effectiveType:connection?.effectiveType??null,downlinkMbps:typeof connection?.downlink==='number'?connection.downlink:null,rttMs:typeof connection?.rtt==='number'?connection.rtt:null,saveData:Boolean(connection?.saveData)};
  const battery:BatteryState={supported:Boolean(this.battery),level:this.battery?.level??null,charging:this.battery?.charging??null,chargingTimeSeconds:this.battery?.chargingTime??null,dischargingTimeSeconds:this.battery?.dischargingTime??null};
  const width=typeof window==='undefined'?1:Math.max(1,window.innerWidth);const height=typeof window==='undefined'?1:Math.max(1,window.innerHeight);const dpr=typeof devicePixelRatio==='number'?Math.min(2,Math.max(.5,devicePixelRatio)):1;
  return{capabilities,network,battery,viewport:{width,height,dpr,orientation:width>=height?'landscape':'portrait'},visibility:typeof document==='undefined'||document.visibilityState==='visible'?'visible':'hidden',focused:typeof document==='undefined'?true:document.hasFocus(),timestamp:Date.now()};
 }
 private detectCapabilities():DeviceCapabilities{
  const nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{deviceMemory?:number;gpu?:unknown};let webgl2=false;
  try{if(typeof document!=='undefined'){const canvas=document.createElement('canvas');webgl2=Boolean(canvas.getContext('webgl2'));}}catch{webgl2=false;}
  return{webgpu:Boolean(nav?.gpu),webgl2,offscreenCanvas:typeof OffscreenCanvas!=='undefined',sharedArrayBuffer:typeof SharedArrayBuffer!=='undefined',crossOriginIsolated:Boolean(globalThis.crossOriginIsolated),deviceMemoryGb:typeof nav?.deviceMemory==='number'?nav.deviceMemory:null,hardwareConcurrency:Math.max(1,nav?.hardwareConcurrency??4),maxTextureSize:null,maxSamples:null,powerPreference:this.powerPreference()};
 }
 private powerPreference():PowerPreference{const nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{hardwareConcurrency?:number};return nav?'high-performance':'default';}
 public preferredQualityHints():{quality:'safe'|'low'|'medium'|'high'|'ultra';resolutionScale:number;networkConstrained:boolean;powerConstrained:boolean}{const s=this.snapshotValue;const memory=s.capabilities.deviceMemoryGb??4;const cores=s.capabilities.hardwareConcurrency;let quality:'safe'|'low'|'medium'|'high'|'ultra'=s.capabilities.webgpu&&memory>=8&&cores>=6?'high':memory>=6?'medium':'low';if(memory<3)quality='safe';const networkConstrained=s.network.saveData===true||(s.network.rttMs!==null&&s.network.rttMs>300);const powerConstrained=s.battery.charging===false&&(s.battery.level!==null&&s.battery.level<.2);let resolutionScale=quality==='safe'?.65:quality==='low'?.8:1;if(networkConstrained)resolutionScale=Math.min(resolutionScale,.85);if(powerConstrained)resolutionScale=Math.min(resolutionScale,.75);return{quality,resolutionScale,networkConstrained,powerConstrained};}
 private ensure():void{if(this.disposed)throw new Error('PLATFORM_ADAPTER_DISPOSED');}
 public dispose():void{if(this.disposed)return;for(const cleanup of this.cleanups.splice(0))cleanup();this.disposed=true;}
}

export interface ContextLossEvent { readonly reason:string;readonly timestamp:number; }
export class GraphicsLifecycleGuard implements Disposable {
 private lost=false;private disposed=false;private readonly handlers=new Set<(event:ContextLossEvent)=>void>();
 public markLost(reason='unknown'):void{this.ensure();if(this.lost)return;this.lost=true;const event={reason,timestamp:Date.now()};for(const handler of [...this.handlers])handler(event);}
 public markRestored():void{this.ensure();this.lost=false;}
 public isLost():boolean{return this.lost;}
 public onLoss(handler:(event:ContextLossEvent)=>void):Disposable{this.ensure();this.handlers.add(handler);return{dispose:()=>this.handlers.delete(handler)&&undefined};}
 private ensure():void{if(this.disposed)throw new Error('GRAPHICS_GUARD_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.handlers.clear();this.disposed=true;}
}

export interface ResizeTarget {readonly width:number;readonly height:number;readonly dpr:number;}
export class ResizePolicy {
 private value:ResizeTarget={width:1,height:1,dpr:1};
 public measure(width:number,height:number,dpr:number,maxDpr=2):ResizeTarget{const next={width:Math.max(1,Math.floor(width)),height:Math.max(1,Math.floor(height)),dpr:Math.min(maxDpr,Math.max(.5,Number.isFinite(dpr)?dpr:1))};if(next.width!==this.value.width||next.height!==this.value.height||next.dpr!==this.value.dpr)this.value=next;return this.value;}
 public current():ResizeTarget{return this.value;}
}
