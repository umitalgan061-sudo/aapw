/**
 * Strict browser/platform capability probe.
 *
 * Detection is conservative and injectable. It reports facts; renderer selection remains at the
 * composition boundary.
 */
import { clamp, integerOr, finiteOr, createRuntimeCapabilities } from './modernRuntimeContract.ts';

interface NavigatorExtras {
  readonly gpu?: { requestAdapter?: (options?: Readonly<Record<string, unknown>>) => Promise<unknown> };
  readonly connection?: NetworkConnection;
  readonly mozConnection?: NetworkConnection;
  readonly webkitConnection?: NetworkConnection;
  readonly standalone?: boolean;
  readonly maxTouchPoints?: number;
}
interface NetworkConnection {
  readonly effectiveType?: string;
  readonly saveData?: boolean;
  readonly downlink?: number;
  readonly rtt?: number;
}
export interface PlatformProbeOptions { readonly webgl?: boolean; readonly webgpu?: boolean; }
export interface CapabilityProbeResult {
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly input: Readonly<Record<string, boolean>>;
  readonly pwa: Readonly<{standalone:boolean;serviceWorker:boolean;online:boolean}>;
  readonly memory: Readonly<{deviceMemoryGb:number;heapLimitMb:number|null}>;
  readonly network: Readonly<{effectiveType:string;saveData:boolean;downlinkMbps:number|null;rttMs:number|null}>;
  readonly screen: Readonly<{width:number;height:number;colorDepth:number}>;
  readonly browser: Readonly<{userAgent:string;language:string;platform:string}>;
}

function asNavigator(value: Navigator): Navigator & NavigatorExtras { return value as Navigator & NavigatorExtras; }
function safeMatchMedia(media:string,fallback=false):boolean { try{return Boolean(globalThis.matchMedia?.(media)?.matches);}catch{return fallback;} }
function safeStorageAvailable(storage: Storage|null|undefined):boolean {
  try { if(!storage)return false; const key='__aapw_probe__'; storage.setItem(key,'1'); storage.removeItem(key); return true; } catch { return false; }
}
async function probeWebGPU():Promise<boolean>{
  try { const nav=asNavigator(globalThis.navigator); const request=nav.gpu?.requestAdapter; if(typeof request!=='function')return false; return Boolean(await request({powerPreference:'high-performance'})); } catch { return false; }
}
function probeWebGL():boolean{
  try{
    const canvas=globalThis.document?.createElement?.('canvas'); if(!canvas?.getContext)return false;
    const context=canvas.getContext('webgl2',{powerPreference:'high-performance'})||canvas.getContext('webgl');
    const available=Boolean(context); context?.getExtension?.('WEBGL_lose_context')?.loseContext?.(); return available;
  }catch{return false;}
}
function detectInput():Readonly<Record<string,boolean>>{
  const nav=asNavigator(globalThis.navigator);
  return Object.freeze({
    touch:integerOr(nav.maxTouchPoints,0)>0,
    gamepad:typeof nav.getGamepads==='function',
    pointerLock:Boolean(globalThis.document?.body?.requestPointerLock),
    pointerEvents:typeof globalThis.PointerEvent==='function',
    keyboard:typeof globalThis.KeyboardEvent==='function',
  });
}
function detectPwa():CapabilityProbeResult['pwa']{
  const nav=asNavigator(globalThis.navigator);
  return Object.freeze({standalone:safeMatchMedia('(display-mode: standalone)')||Boolean(nav.standalone),serviceWorker:Boolean(nav.serviceWorker),online:nav.onLine!==false});
}
function detectMemory():CapabilityProbeResult['memory']{
  const nav=asNavigator(globalThis.navigator); const memory=(nav as Navigator & {readonly deviceMemory?:number}).deviceMemory; const jsHeap=(globalThis.performance as Performance & {readonly memory?:{readonly jsHeapSizeLimit?:number}})?.memory?.jsHeapSizeLimit;
  return Object.freeze({deviceMemoryGb:clamp(finiteOr(memory,4),0.25,64),heapLimitMb:jsHeap?clamp(Number(jsHeap)/(1024*1024),32,32768):null});
}
function detectNetwork():CapabilityProbeResult['network']{
  const nav=asNavigator(globalThis.navigator); const connection=nav.connection||nav.mozConnection||nav.webkitConnection;
  return Object.freeze({effectiveType:String(connection?.effectiveType||'unknown'),saveData:Boolean(connection?.saveData),downlinkMbps:connection?.downlink==null?null:clamp(finiteOr(connection.downlink,0),0,10000),rttMs:connection?.rtt==null?null:clamp(finiteOr(connection.rtt,0),0,10000)});
}
export async function probePlatformCapabilities(options:PlatformProbeOptions = {}):Promise<CapabilityProbeResult>{
  const webgl=typeof options.webgl==='boolean'?options.webgl:probeWebGL(); const webgpu=typeof options.webgpu==='boolean'?options.webgpu:await probeWebGPU();
  const nav=asNavigator(globalThis.navigator);
  const capabilities=createRuntimeCapabilities({
    webgl,webgpu,offscreenCanvas:Boolean(globalThis.OffscreenCanvas),sharedArrayBuffer:Boolean(globalThis.SharedArrayBuffer),
    indexedDb:Boolean(globalThis.indexedDB),serviceWorker:Boolean(nav.serviceWorker),broadcastChannel:Boolean(globalThis.BroadcastChannel),
    gamepad:typeof nav.getGamepads==='function',pointerLock:Boolean(globalThis.document?.body?.requestPointerLock),
    prefersReducedMotion:safeMatchMedia('(prefers-reduced-motion: reduce)'),hardwareConcurrency:integerOr(nav.hardwareConcurrency,4),
    devicePixelRatio:finiteOr(globalThis.devicePixelRatio,1),
  });
  return Object.freeze({
    capabilities,input:detectInput(),pwa:detectPwa(),memory:detectMemory(),network:detectNetwork(),
    screen:Object.freeze({width:integerOr(globalThis.screen?.width,0),height:integerOr(globalThis.screen?.height,0),colorDepth:integerOr(globalThis.screen?.colorDepth,0)}),
    browser:Object.freeze({userAgent:String(nav.userAgent||'unknown'),language:String(nav.language||'unknown'),platform:String(nav.platform||'unknown')}),
  });
}
export function classifyPlatformProfile(probe:Partial<CapabilityProbeResult> = {}):'compatibility'|'constrained'|'balanced'|'performance'{
  const c=probe.capabilities||{}; const memoryGb=finiteOr((probe.memory as {deviceMemoryGb?:unknown}|undefined)?.deviceMemoryGb,4);
  const cores=integerOr((c.hardwareConcurrency as unknown),4); const dpr=finiteOr(c.devicePixelRatio,1);
  const saveData=Boolean((probe.network as {saveData?:unknown}|undefined)?.saveData); const reducedMotion=Boolean(c.prefersReducedMotion);
  if(!Boolean(c.webgl)&&!Boolean(c.webgpu))return 'compatibility';
  if(saveData||memoryGb<=1||cores<=2)return 'constrained';
  if(reducedMotion||dpr>=3||memoryGb<=2||cores<=4)return 'balanced';
  if(Boolean(c.webgpu)&&memoryGb>=8&&cores>=8)return 'performance';
  return 'balanced';
}
export function capabilityWarnings(probe:Partial<CapabilityProbeResult> = {}):readonly string[]{
  const warnings:string[]=[]; const c=probe.capabilities||{};
  if(!c.webgl&&!c.webgpu)warnings.push('No supported 3D graphics context was detected.');
  if(!c.indexedDb)warnings.push('IndexedDB is unavailable; persistence should use a fallback adapter.');
  if(!c.serviceWorker)warnings.push('Service worker is unavailable; offline shell support may be reduced.');
  if(c.prefersReducedMotion)warnings.push('Reduced-motion preference is active.');
  if((probe.network as {saveData?:unknown}|undefined)?.saveData)warnings.push('Data-saver preference is active.');
  return Object.freeze(warnings);
}
export function createCapabilityMatrix(probe:Partial<CapabilityProbeResult> = {}):readonly Readonly<{capability:string;available:boolean;impact:string}>[]{
  const c=probe.capabilities||{};
  return Object.freeze([
    Object.freeze({capability:'webgpu',available:Boolean(c.webgpu),impact:'renderer'}),
    Object.freeze({capability:'webgl',available:Boolean(c.webgl),impact:'renderer-fallback'}),
    Object.freeze({capability:'offscreenCanvas',available:Boolean(c.offscreenCanvas),impact:'worker-presentation'}),
    Object.freeze({capability:'indexedDb',available:Boolean(c.indexedDb),impact:'persistence'}),
    Object.freeze({capability:'serviceWorker',available:Boolean(c.serviceWorker),impact:'offline'}),
    Object.freeze({capability:'gamepad',available:Boolean(c.gamepad),impact:'input'}),
    Object.freeze({capability:'pointerLock',available:Boolean(c.pointerLock),impact:'look-input'}),
    Object.freeze({capability:'reducedMotion',available:Boolean(c.prefersReducedMotion),impact:'accessibility'}),
  ]);
}
export function canPersistSafely({indexedDb=false,localStorage=false}:{readonly indexedDb?:boolean;readonly localStorage?:boolean}={}):boolean{return Boolean(indexedDb||localStorage);}
export function probeStorageAvailability():Readonly<{localStorage:boolean;sessionStorage:boolean;indexedDb:boolean}>{return Object.freeze({localStorage:safeStorageAvailable(globalThis.localStorage),sessionStorage:safeStorageAvailable(globalThis.sessionStorage),indexedDb:Boolean(globalThis.indexedDB)});}
