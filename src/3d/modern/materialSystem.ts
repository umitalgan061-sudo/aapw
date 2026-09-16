import type { Disposable, RendererBackend } from './types';

export type MaterialTextureRole='baseColor'|'normal'|'metallicRoughness'|'occlusion'|'emissive'|'height'|'detail';
export type MaterialFeature='normalMap'|'clearcoat'|'transmission'|'emissive'|'alphaTest'|'alphaBlend'|'skinning'|'morphTargets'|'instancing'|'vertexColors'|'fog'|'shadow'|'ao'|'parallax';
export interface TextureRef{readonly id:string;readonly role:MaterialTextureRole;readonly colorSpace:'srgb'|'linear';readonly compression:'none'|'basisu'|'astc'|'etc2'|'bc7';readonly maxAnisotropy:number;}
export interface MaterialDescriptor{readonly id:string;readonly backend:RendererBackend;readonly features:readonly MaterialFeature[];readonly textures:readonly TextureRef[];readonly alphaCutoff:number;readonly roughness:number;readonly metalness:number;readonly transmission:number;readonly clearcoat:number;readonly defines:Readonly<Record<string,string|number|boolean>>;}
export interface CompiledMaterial<T=unknown>{readonly descriptor:MaterialDescriptor;readonly program:T;readonly key:string;readonly estimatedGpuBytes:number;readonly createdAt:number;}
export interface MaterialCompiler<T>{compile(descriptor:MaterialDescriptor):Promise<CompiledMaterial<T>>|CompiledMaterial<T>;dispose?(material:CompiledMaterial<T>):void|Promise<void>;}
export interface MaterialBudget{readonly maxMaterials:number;readonly maxGpuBytes:number;}

/**
 * Feature-aware material registry for modern WebGPU/WebGL2 renderers.
 * Variants are canonicalized so equivalent feature sets never create duplicate programs.
 */
export class MaterialSystem<T=unknown> implements Disposable{
 private readonly compiler:MaterialCompiler<T>;private readonly budget:MaterialBudget;private readonly materials=new Map<string,CompiledMaterial<T>>();private readonly usage=new Map<string,number>();private gpuBytes=0;private disposed=false;
 constructor(compiler:MaterialCompiler<T>,budget:Partial<MaterialBudget>={}){this.compiler=compiler;this.budget={maxMaterials:budget.maxMaterials??256,maxGpuBytes:budget.maxGpuBytes??256*1024*1024};}
 public async resolve(descriptor:MaterialDescriptor):Promise<CompiledMaterial<T>>{this.ensure();const normalized=normalizeDescriptor(descriptor),key=materialKey(normalized);const cached=this.materials.get(key);if(cached){this.usage.set(key,(this.usage.get(key)??0)+1);return cached;}const compiled=await this.compiler.compile(normalized);if(compiled.descriptor!==normalized){throw new Error('MATERIAL_COMPILER_DESCRIPTOR_MISMATCH');}if(compiled.estimatedGpuBytes>this.budget.maxGpuBytes)throw new Error('MATERIAL_PROGRAM_TOO_LARGE');this.materials.set(key,compiled);this.usage.set(key,1);this.gpuBytes+=Math.max(0,compiled.estimatedGpuBytes);await this.trim();return compiled;}
 public retain(descriptor:MaterialDescriptor):boolean{this.ensure();const key=materialKey(normalizeDescriptor(descriptor));if(!this.materials.has(key))return false;this.usage.set(key,(this.usage.get(key)??0)+1);return true;}
 public release(descriptor:MaterialDescriptor):boolean{this.ensure();const key=materialKey(normalizeDescriptor(descriptor));const current=this.usage.get(key)??0;if(current<=0)return false;this.usage.set(key,current-1);return true;}
 public async invalidate(predicate:(material:CompiledMaterial<T>)=>boolean):Promise<number>{this.ensure();let removed=0;for(const[key,material]of this.materials){if(!predicate(material))continue;await this.destroy(key,material);removed+=1;}return removed;}
 public async clear():Promise<void>{this.ensure();for(const[key,material]of [...this.materials])await this.destroy(key,material);}
 public stats():{readonly materials:number;readonly gpuBytes:number;readonly maxGpuBytes:number;readonly pinned:number}{let pinned=0;for(const count of this.usage.values())if(count>0)pinned+=1;return{materials:this.materials.size,gpuBytes:this.gpuBytes,maxGpuBytes:this.budget.maxGpuBytes,pinned};}
 public keys():readonly string[]{return[...this.materials.keys()].sort();}
 private async trim():Promise<void>{while(this.materials.size>this.budget.maxMaterials||this.gpuBytes>this.budget.maxGpuBytes){const candidates=[...this.materials.entries()].filter(([key])=>(this.usage.get(key)??0)===0).sort((a,b)=>a[1].createdAt-b[1].createdAt||a[0].localeCompare(b[0]));const oldest=candidates[0];if(!oldest)throw new Error('MATERIAL_BUDGET_PINNED');await this.destroy(oldest[0],oldest[1]);}}
 private async destroy(key:string,material:CompiledMaterial<T>):Promise<void>{this.materials.delete(key);this.usage.delete(key);this.gpuBytes=Math.max(0,this.gpuBytes-material.estimatedGpuBytes);await this.compiler.dispose?.(material);}
 private ensure():void{if(this.disposed)throw new Error('MATERIAL_SYSTEM_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.materials.clear();this.usage.clear();this.gpuBytes=0;this.disposed=true;}
}

export interface PipelineFeatureSet{readonly backend:RendererBackend;readonly features:readonly MaterialFeature[];readonly defines:Readonly<Record<string,number|boolean>>;}
export const resolveFeatureSet=(input:{backend:RendererBackend;features?:readonly MaterialFeature[];skinned?:boolean;instanced?:boolean;vertexColors?:boolean;fog?:boolean;shadow?:boolean;ao?:boolean}):PipelineFeatureSet=>{const features=new Set(input.features??[]);if(input.skinned)features.add('skinning');if(input.instanced)features.add('instancing');if(input.vertexColors)features.add('vertexColors');if(input.fog)features.add('fog');if(input.shadow)features.add('shadow');if(input.ao)features.add('ao');const ordered=[...features].sort();const defines:Record<string,number|boolean>={};for(const feature of ordered)defines[`FEATURE_${feature.replace(/([A-Z])/g,'_$1').toUpperCase()}`]=true;return{backend:input.backend,features:ordered,defines};};

export const normalizeDescriptor=(descriptor:MaterialDescriptor):MaterialDescriptor=>{const textures=[...descriptor.textures].sort((a,b)=>a.role.localeCompare(b.role)||a.id.localeCompare(b.id)).map(texture=>({...texture,maxAnisotropy:clampInt(texture.maxAnisotropy,1,16)}));const features=[...new Set(descriptor.features)].sort();const defines=Object.keys(descriptor.defines).sort().reduce<Record<string,string|number|boolean>>((acc,key)=>{acc[key]=descriptor.defines[key]!;return acc;},{});return{...descriptor,features,textures,defines,alphaCutoff:clamp(descriptor.alphaCutoff),roughness:clamp(descriptor.roughness),metalness:clamp(descriptor.metalness),transmission:clamp(descriptor.transmission),clearcoat:clamp(descriptor.clearcoat)};};
export const materialKey=(descriptor:MaterialDescriptor):string=>JSON.stringify({backend:descriptor.backend,id:descriptor.id,features:[...descriptor.features].sort(),textures:descriptor.textures.map(texture=>[texture.id,texture.role,texture.colorSpace,texture.compression,texture.maxAnisotropy]),alphaCutoff:descriptor.alphaCutoff,roughness:descriptor.roughness,metalness:descriptor.metalness,transmission:descriptor.transmission,clearcoat:descriptor.clearcoat,defines:Object.keys(descriptor.defines).sort().map(key=>[key,descriptor.defines[key]])});
export const estimateMaterialGpuBytes=(descriptor:MaterialDescriptor,baseProgramBytes=64*1024):number=>baseProgramBytes+descriptor.textures.reduce((sum,texture)=>sum+Math.max(4,texture.maxAnisotropy*4*1024),0)+descriptor.features.length*4096;
export const chooseTextureFormat=(backend:RendererBackend,supported:readonly string[]):TextureRef['compression']=>{const set=new Set(supported.map(value=>value.toLowerCase()));if(set.has('astc'))return'astc';if(set.has('bc7'))return'bc7';if(set.has('etc2'))return'etc2';if(backend==='webgpu'&&set.has('basisu'))return'basisu';return'none';};

export interface ShaderChunk{readonly id:string;readonly stage:'vertex'|'fragment'|'compute';readonly source:string;readonly dependencies?:readonly string[];}
export interface ShaderModuleGraph{readonly chunks:readonly ShaderChunk[];readonly entry:string;}
export class ShaderChunkRegistry implements Disposable{
 private readonly chunks=new Map<string,ShaderChunk>();private disposed=false;
 public register(chunk:ShaderChunk):void{this.ensure();if(this.chunks.has(chunk.id))throw new Error(`SHADER_CHUNK_REDEFINED:${chunk.id}`);this.chunks.set(chunk.id,{...chunk,dependencies:[...(chunk.dependencies??[])]});}
 public resolve(entry:string):ShaderChunk[]{this.ensure();if(!this.chunks.has(entry))throw new Error(`SHADER_ENTRY_MISSING:${entry}`);const visiting=new Set<string>(),visited=new Set<string>(),result:ShaderChunk[]=[];const visit=(id:string):void=>{if(visited.has(id))return;if(visiting.has(id))throw new Error(`SHADER_DEPENDENCY_CYCLE:${id}`);const chunk=this.chunks.get(id);if(!chunk)throw new Error(`SHADER_DEPENDENCY_MISSING:${id}`);visiting.add(id);for(const dependency of [...chunk.dependencies??[]].sort())visit(dependency);visiting.delete(id);visited.add(id);result.push(chunk);};visit(entry);return result;}
 public source(entry:string):string{return this.resolve(entry).map(chunk=>`// ${chunk.id}\n${chunk.source}`).join('\n');}
 public size():number{return this.chunks.size;}private ensure():void{if(this.disposed)throw new Error('SHADER_REGISTRY_DISPOSED');}public dispose():void{if(this.disposed)return;this.chunks.clear();this.disposed=true;}
}

const clamp=(value:number):number=>Math.min(1,Math.max(0,Number.isFinite(value)?value:0));const clampInt=(value:number,min:number,max):number=>Math.floor(Math.min(max,Math.max(min,Number.isFinite(value)?value:min)));
