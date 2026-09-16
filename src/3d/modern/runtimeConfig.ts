import type { PowerPreference, QualityTier, RendererBackend, RuntimeOptions } from './types';

export interface ModernRuntimeConfig {
  readonly seed:number;readonly quality:QualityTier;readonly preferredBackend:'auto'|RendererBackend;readonly powerPreference:PowerPreference;readonly adaptiveQuality:boolean;readonly workers:boolean;readonly persistence:boolean;readonly schedulerBudgetMs:number;readonly assetByteBudget:number;readonly assetEntryBudget:number;readonly maxEntities:number;readonly targetFps:number;
}
export interface ConfigSource { readonly get:(key:string)=>string|null; }

/** Single immutable configuration surface for browser, tests and future native hosts. */
export class RuntimeConfig {
 private value:ModernRuntimeConfig;
 constructor(options:Partial<ModernRuntimeConfig>={}){this.value=freezeConfig(normalize({...options}));}
 public snapshot():ModernRuntimeConfig{return this.value;}
 public with(patch:Partial<ModernRuntimeConfig>):RuntimeConfig{return new RuntimeConfig({...this.value,...patch});}
 public override(env:ConfigSource):RuntimeConfig{const patch:Partial<ModernRuntimeConfig>={};const backend=env.get('aapw.backend');if(backend==='webgpu'||backend==='webgl2'||backend==='auto')patch.preferredBackend=backend;const quality=env.get('aapw.quality');if(isQuality(quality))patch.quality=quality;const workers=env.get('aapw.workers');if(workers==='true'||workers==='false')patch.workers=workers==='true';const adaptive=env.get('aapw.adaptive');if(adaptive==='true'||adaptive==='false')patch.adaptiveQuality=adaptive==='true';return this.with(patch);}
 public serialize():string{return JSON.stringify(this.value);}
 public static parse(serialized:string):RuntimeConfig{const parsed=JSON.parse(serialized) as Partial<ModernRuntimeConfig>;return new RuntimeConfig(parsed);}
}

export const defaults:ModernRuntimeConfig=freezeConfig({seed:0x57455354,quality:'high',preferredBackend:'auto',powerPreference:'high-performance',adaptiveQuality:true,workers:true,persistence:true,schedulerBudgetMs:4,assetByteBudget:512*1024*1024,assetEntryBudget:2048,maxEntities:100_000,targetFps:60});
const normalize=(value:Partial<ModernRuntimeConfig>):ModernRuntimeConfig=>({seed:Number.isFinite(value.seed)?(value.seed as number)>>>0:defaults.seed,quality:isQuality(value.quality)?value.quality:defaults.quality,preferredBackend:value.preferredBackend==='webgpu'||value.preferredBackend==='webgl2'||value.preferredBackend==='auto'?value.preferredBackend:defaults.preferredBackend,powerPreference:value.powerPreference==='high-performance'||value.powerPreference==='low-power'||value.powerPreference==='default'?value.powerPreference:defaults.powerPreference,adaptiveQuality:value.adaptiveQuality??defaults.adaptiveQuality,workers:value.workers??defaults.workers,persistence:value.persistence??defaults.persistence,schedulerBudgetMs:clampNumber(value.schedulerBudgetMs,1,16,defaults.schedulerBudgetMs),assetByteBudget:clampInt(value.assetByteBudget,16*1024*1024,2*1024*1024*1024,defaults.assetByteBudget),assetEntryBudget:clampInt(value.assetEntryBudget,16,100_000,defaults.assetEntryBudget),maxEntities:clampInt(value.maxEntities,100,1_000_000,defaults.maxEntities),targetFps:clampNumber(value.targetFps,24,240,defaults.targetFps)});
const isQuality=(value:unknown):value is QualityTier=>value==='cinematic'||value==='ultra'||value==='high'||value==='medium'||value==='low'||value==='safe';
const clampNumber=(v:number|undefined,min:number,max,fallback:number):number=>Math.min(max,Math.max(min,Number.isFinite(v)?v!:fallback));const clampInt=(v:number|undefined,min:number,max,fallback:number):number=>Math.floor(clampNumber(v,min,max,fallback));const freezeConfig=(value:ModernRuntimeConfig):ModernRuntimeConfig=>Object.freeze({...value});

export const browserConfigSource=():ConfigSource=>({get:(key:string)=>{try{return typeof localStorage==='undefined'?null:localStorage.getItem(key);}catch{return null;}}});
export const environmentConfig=():RuntimeConfig=>new RuntimeConfig().override(browserConfigSource());
export const validateConfig=(config:ModernRuntimeConfig):readonly string[]=>{const errors:string[]=[];if(config.assetByteBudget<16*1024*1024)errors.push('assetByteBudget-too-small');if(config.maxEntities<100)errors.push('maxEntities-too-small');if(config.schedulerBudgetMs<=0)errors.push('schedulerBudgetMs-invalid');if(config.targetFps<24||config.targetFps>240)errors.push('targetFps-invalid');return errors;};
