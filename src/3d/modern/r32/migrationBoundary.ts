import {RuntimeError,TaskPriority,stableHash} from './contracts.ts';
export type LegacyCapability='scene'|'camera'|'terrain'|'water'|'vegetation'|'settlement'|'player'|'physics'|'audio'|'ui'|'network'|'persistence';
export interface LegacyModuleDescriptor{readonly id:string;readonly path:string;readonly capability:LegacyCapability;readonly priority:TaskPriority;readonly ownership:'legacy'|'bridge'|'modern';readonly migrationState:'unmigrated'|'wrapped'|'dual'|'modern';}
export interface LegacyAdapter<TArgs,TResult>{readonly descriptor:LegacyModuleDescriptor;readonly invoke:(args:TArgs)=>TResult|Promise<TResult>;}
export interface BoundaryPolicy{readonly maxInvocationMilliseconds:number;readonly blockedCapabilities:ReadonlySet<LegacyCapability>;readonly requireModernOwnerFor:ReadonlySet<string>;}
export interface BoundaryInvocation<T>{readonly operationId:string;readonly adapterId:string;readonly durationMilliseconds:number;readonly result:T;}
export const DEFAULT_BOUNDARY_POLICY:BoundaryPolicy={maxInvocationMilliseconds:1000,blockedCapabilities:new Set(),requireModernOwnerFor:new Set()};
export class LegacyBoundaryRegistry{
  readonly #adapters=new Map<string,LegacyAdapter<unknown,unknown>>();readonly #policy:BoundaryPolicy;readonly #clock:()=>number;
  constructor(policy:BoundaryPolicy=DEFAULT_BOUNDARY_POLICY,clock:()=>number=()=>performance.now()){this.#policy=policy;this.#clock=clock;}
  register<A,R>(adapter:LegacyAdapter<A,R>):()=>void{const d=adapter.descriptor;if(this.#policy.blockedCapabilities.has(d.capability))throw new RuntimeError({code:'R32_LEGACY_BLOCKED',message:'Legacy capability is blocked: '+d.capability});if(this.#policy.requireModernOwnerFor.has(d.id)&&d.ownership!=='modern')throw new RuntimeError({code:'R32_LEGACY_OWNER',message:'Modern owner required: '+d.id});if(this.#adapters.has(d.id))throw new RuntimeError({code:'R32_LEGACY_DUP',message:'Adapter already registered: '+d.id});this.#adapters.set(d.id,adapter as LegacyAdapter<unknown,unknown>);return()=>this.#adapters.delete(d.id);}
  async invoke<A,R>(id:string,args:A):Promise<BoundaryInvocation<R>>{const adapter=this.#adapters.get(id);if(!adapter)throw new RuntimeError({code:'R32_LEGACY_MISSING',message:'Legacy adapter missing: '+id});const start=this.#clock();try{const result=await adapter.invoke(args);const duration=Math.max(0,this.#clock()-start);if(duration>this.#policy.maxInvocationMilliseconds)throw new RuntimeError({code:'R32_LEGACY_TIMEOUT',message:'Legacy boundary exceeded budget',metadata:{adapterId:id,durationMilliseconds:duration}});return{operationId:stableHash({id,args}),adapterId:id,durationMilliseconds:duration,result:result as R};}catch(error){if(error instanceof RuntimeError)throw error;throw new RuntimeError({code:'R32_LEGACY_FAILURE',message:'Legacy boundary invocation failed: '+id,cause:error});}}
  list():readonly LegacyModuleDescriptor[]{return[...this.#adapters.values()].map(v=>v.descriptor).sort((a,b)=>a.id.localeCompare(b.id));}
}
export const R32_LEGACY_BOUNDARY_MANIFEST:readonly LegacyModuleDescriptor[]=[
{id:'scene-manager',path:'src/3d/sceneManager.js',capability:'scene',priority:'critical',ownership:'bridge',migrationState:'dual'},
{id:'player-authority',path:'src/3d/gameplay/player.js',capability:'player',priority:'critical',ownership:'bridge',migrationState:'dual'},
{id:'physics-authority',path:'src/3d/physics.js',capability:'physics',priority:'high',ownership:'bridge',migrationState:'wrapped'},
{id:'terrain-authority',path:'src/3d/world/terrain.js',capability:'terrain',priority:'high',ownership:'bridge',migrationState:'wrapped'},
{id:'water-authority',path:'src/3d/world/water.js',capability:'water',priority:'normal',ownership:'legacy',migrationState:'unmigrated'},
{id:'settlement-authority',path:'src/3d/world/settlements.js',capability:'settlement',priority:'normal',ownership:'legacy',migrationState:'unmigrated'},
{id:'vegetation-authority',path:'src/3d/world/vegetation.js',capability:'vegetation',priority:'normal',ownership:'legacy',migrationState:'unmigrated'},
{id:'audio-authority',path:'src/3d/audio.js',capability:'audio',priority:'low',ownership:'legacy',migrationState:'unmigrated'},
{id:'ui-authority',path:'src/ui',capability:'ui',priority:'high',ownership:'bridge',migrationState:'dual'},
];
