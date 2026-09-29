import type { AssetId, AssetIntegrity, AssetKind, AssetRequest, Result } from './liveCoreTypes.ts';
import { assetId, clamp, err, ok, stableHash } from './liveCoreTypes.ts';

export interface ManifestAsset {
  readonly id: AssetId;
  readonly url: string;
  readonly kind: AssetKind;
  readonly priority: number;
  readonly bytes: number;
  readonly integrity?: AssetIntegrity;
  readonly dependencies: readonly AssetId[];
  readonly tags: readonly string[];
  readonly optional: boolean;
  readonly critical: boolean;
}

export interface AssetManifest {
  readonly version: number;
  readonly generatedAt?: string;
  readonly assets: readonly ManifestAsset[];
  readonly digest: string;
}

export interface ManifestValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface LoadOrder {
  readonly ordered: readonly AssetId[];
  readonly cycles: readonly AssetId[][];
  readonly missingDependencies: readonly { readonly asset: AssetId; readonly dependency: AssetId }[];
}

export interface AssetFamilySummary {
  readonly family: string;
  readonly count: number;
  readonly bytes: number;
  readonly criticalCount: number;
  readonly optionalCount: number;
}

const SAFE_MIME = Object.freeze(['model/gltf-binary','model/gltf+json','application/json','application/octet-stream','image/png','image/jpeg','image/webp','audio/mpeg','audio/ogg','audio/wav']);
const SAFE_PROTOCOLS = new Set(['https:']);
const normalizeTag = (value:string)=>value.trim().slice(0,48).toLowerCase().replace(/[^a-z0-9._:-]/g,'-');
const normalizeTags = (values:readonly string[])=>Object.freeze([...new Set(values.map(normalizeTag).filter(Boolean))].sort());
const normalizeUrl=(value:string)=>{try{const parsed=new URL(value,'https://aapw.invalid/');if(parsed.hostname==='aapw.invalid')return parsed.pathname.startsWith('/')?parsed.pathname:'';if(!SAFE_PROTOCOLS.has(parsed.protocol))return '';return parsed.href;}catch{return '';}};
const normalizeIntegrity=(value?:AssetIntegrity):AssetIntegrity|undefined=>{if(!value)return undefined;const result:{byteLength?:number;mimeType?:string;sha256?:string}={};if(value.byteLength!==undefined)result.byteLength=Math.max(0,Math.floor(value.byteLength));if(value.mimeType!==undefined)result.mimeType=value.mimeType.toLowerCase();if(value.sha256!==undefined)result.sha256=value.sha256.toLowerCase();return Object.keys(result).length?Object.freeze(result):undefined;};

export const manifestAsset=(input:{readonly id?:string;readonly url:string;readonly kind:AssetKind;readonly priority?:number;readonly bytes?:number;readonly integrity?:AssetIntegrity;readonly dependencies?:readonly string[];readonly tags?:readonly string[];readonly optional?:boolean;readonly critical?:boolean;}):Result<ManifestAsset>=>{
  const url=normalizeUrl(input.url);if(!url)return err('INVALID_FRAME','Asset manifest URL is invalid or unsafe.',true);
  const normalizedId=assetId((input.id??stableHash({url,kind:input.kind})).slice(0,96));const bytes=Math.max(0,Math.floor(input.bytes??input.integrity?.byteLength??0));
  const integrity=normalizeIntegrity(input.integrity);if(integrity?.mimeType&&!SAFE_MIME.includes(integrity.mimeType))return err('INVALID_FRAME','Asset MIME type is not permitted.',true,{mime:integrity.mimeType});
  if(integrity?.sha256&&!/^[a-f0-9]{64}$/.test(integrity.sha256))return err('INVALID_FRAME','Asset SHA-256 must be a 64-character hex digest.',true);
  return ok(Object.freeze({id:normalizedId,url,kind:input.kind,priority:clamp(input.priority??0,-100,100),bytes, ...(integrity?{integrity}:{}), dependencies:Object.freeze([...(input.dependencies??[])].map(String).map(v=>assetId(v.trim())).filter(v=>v.length>0)),tags:normalizeTags(input.tags??[]),optional:Boolean(input.optional),critical:Boolean(input.critical)}));
};

export const validateManifest=(manifest:AssetManifest):ManifestValidation=>{
  const errors:string[]=[];const warnings:string[]=[];const ids=new Set<string>();
  if(!Number.isSafeInteger(manifest.version)||manifest.version<1)errors.push('version');
  for(const asset of manifest.assets){
    if(ids.has(asset.id))errors.push('duplicate:'+asset.id);ids.add(asset.id);
    if(!normalizeUrl(asset.url))errors.push('url:'+asset.id);
    if(asset.bytes<0)errors.push('bytes:'+asset.id);
    if(asset.critical&&asset.optional)warnings.push('critical-optional:'+asset.id);
    const integrity=normalizeIntegrity(asset.integrity);
    if(integrity?.mimeType&&!SAFE_MIME.includes(integrity.mimeType))errors.push('mime:'+asset.id);
    if(integrity?.sha256&&!/^[a-f0-9]{64}$/.test(integrity.sha256))errors.push('sha256:'+asset.id);
  }
  return Object.freeze({ok:errors.length===0,errors:Object.freeze(errors),warnings:Object.freeze(warnings)});
};

export const createManifest=(version:number,assets:readonly ManifestAsset[],generatedAt?:string):AssetManifest=>{
  const normalized=Object.freeze([...assets].sort((a,b)=>a.id.localeCompare(b.id)));return Object.freeze({version:Math.max(1,Math.floor(version)),...(generatedAt?{generatedAt}:{}),assets:normalized,digest:stableHash(normalized)});
};

export const planManifestLoadOrder=(manifest:AssetManifest):LoadOrder=>{
  const map=new Map<string,ManifestAsset>(manifest.assets.map(a=>[String(a.id),a]));const ordered:AssetId[]=[];const visiting=new Set<string>();const visited=new Set<string>();const cycles:AssetId[][]=[];const missing:{asset:AssetId;dependency:AssetId}[]=[];
  const visit=(id:string,stack:string[])=>{if(visited.has(id))return;if(visiting.has(id)){const index=stack.indexOf(id);cycles.push(Object.freeze(stack.slice(index).map(assetId)));return;}const asset=map.get(id);if(!asset){return;}visiting.add(id);for(const dep of asset.dependencies){const key=String(dep);if(!map.has(key))missing.push(Object.freeze({asset:asset.id,dependency:dep}));else visit(key,[...stack,id]);}visiting.delete(id);visited.add(id);ordered.push(asset.id);};
  for(const asset of [...manifest.assets].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id)))visit(String(asset.id),[]);
  return Object.freeze({ordered:Object.freeze([...ordered]),cycles:Object.freeze(cycles),missingDependencies:Object.freeze(missing)});
};

export const manifestFamilies=(manifest:AssetManifest):readonly AssetFamilySummary[]=>{
  const map=new Map<string,{count:number;bytes:number;criticalCount:number;optionalCount:number}>();for(const asset of manifest.assets){const family=asset.tags.find(t=>t.startsWith('family:'))?.slice(7)??asset.kind;const current=map.get(family)??{count:0,bytes:0,criticalCount:0,optionalCount:0};current.count++;current.bytes+=asset.bytes;if(asset.critical)current.criticalCount++;if(asset.optional)current.optionalCount++;map.set(family,current);}
  return Object.freeze([...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([family,summary])=>Object.freeze({family,...summary})));
};

export const manifestToRequests=(manifest:AssetManifest):readonly AssetRequest[]=>Object.freeze(manifest.assets.map(asset=>Object.freeze({id:asset.id,url:asset.url,kind:asset.kind,priority:asset.priority,estimatedBytes:asset.bytes,...(asset.integrity?{integrity:asset.integrity}:{}),maxRetries:asset.critical?4:2})));
export const isMimeAllowed=(mime:string)=>SAFE_MIME.includes(String(mime).toLowerCase());