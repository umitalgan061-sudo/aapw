/** Content manifest validation and deterministic lookup for world/runtime assets. */
export interface ContentEntryV15{readonly id:string;readonly path:string;readonly kind:'model'|'texture'|'audio'|'shader'|'data'|'script';readonly version:string;readonly bytes:number;readonly digest?:string;readonly tags:readonly string[];readonly critical:boolean;readonly region?:string;}
export interface ContentManifestV15{readonly schema:1;readonly build:string;readonly generatedAt:string;readonly entries:readonly ContentEntryV15[];readonly digest:string;}
export interface ManifestIssueV15{readonly code:'DUPLICATE_ID'|'INVALID_PATH'|'INVALID_BYTES'|'INVALID_DIGEST'|'MISSING_CRITICAL'|'UNSUPPORTED_KIND';readonly id?:string;readonly message:string;}

const validKinds=new Set(['model','texture','audio','shader','data','script']);
const pathPattern=/^(?:\.?\/)?[a-zA-Z0-9_./-]+$/;
const digestPattern=/^[a-f0-9]{8,128}$/i;

export const stableManifestStringV15=(entries:readonly ContentEntryV15[]):string=>JSON.stringify(entries.map((entry)=>({id:entry.id,path:entry.path,kind:entry.kind,version:entry.version,bytes:entry.bytes,digest:entry.digest??'',tags:[...entry.tags].sort(),critical:entry.critical,region:entry.region??''})).sort((a,b)=>a.id.localeCompare(b.id)));
export const manifestDigestV15=(manifestEntries:readonly ContentEntryV15[]):string=>{const source=stableManifestStringV15(manifestEntries);let hash=2166136261;for(let i=0;i<source.length;i+=1){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');};

export class ContentManifestV15{
  readonly #entries=new Map<string,ContentEntryV15>();
  readonly #build:string;
  #digest='';
  constructor(build='dev'){this.#build=build.trim()||'dev';}
  add(entry:ContentEntryV15):ContentEntryV15{const normalized=this.#normalize(entry);if(this.#entries.has(normalized.id))throw new Error('Duplicate content id: '+normalized.id);this.#entries.set(normalized.id,normalized);this.#digest=manifestDigestV15([...this.#entries.values()]);return normalized;}
  upsert(entry:ContentEntryV15):ContentEntryV15{const normalized=this.#normalize(entry);this.#entries.set(normalized.id,normalized);this.#digest=manifestDigestV15([...this.#entries.values()]);return normalized;}
  remove(id:string):boolean{const removed=this.#entries.delete(id);if(removed)this.#digest=manifestDigestV15([...this.#entries.values()]);return removed;}
  get(id:string):ContentEntryV15|undefined{return this.#entries.get(id);}
  entries():readonly ContentEntryV15[]{return Object.freeze([...this.#entries.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  digest():string{return this.#digest||manifestDigestV15(this.entries());}
  size():number{return this.#entries.size;}
  byKind(kind:ContentEntryV15['kind']):readonly ContentEntryV15[]{return Object.freeze(this.entries().filter((entry)=>entry.kind===kind));}
  byRegion(region:string):readonly ContentEntryV15[]{return Object.freeze(this.entries().filter((entry)=>entry.region===region));}
  findTag(tag:string):readonly ContentEntryV15[]{return Object.freeze(this.entries().filter((entry)=>entry.tags.includes(tag)));}

  validate(requiredCriticalIds:readonly string[]=[]):readonly ManifestIssueV15[]{
    const issues:ManifestIssueV15[]=[];const ids=new Set<string>();
    for(const entry of this.entries()){
      if(ids.has(entry.id))issues.push({code:'DUPLICATE_ID',id:entry.id,message:'Duplicate content id.'});ids.add(entry.id);
      if(!pathPattern.test(entry.path)||entry.path.includes('..'))issues.push({code:'INVALID_PATH',id:entry.id,message:'Content path is not normalized.'});
      if(!Number.isFinite(entry.bytes)||entry.bytes<0)issues.push({code:'INVALID_BYTES',id:entry.id,message:'Content byte size is invalid.'});
      if(entry.digest&&!digestPattern.test(entry.digest))issues.push({code:'INVALID_DIGEST',id:entry.id,message:'Content digest is not hexadecimal.'});
      if(!validKinds.has(entry.kind))issues.push({code:'UNSUPPORTED_KIND',id:entry.id,message:'Content kind is not supported.'});
    }
    for(const id of requiredCriticalIds)if(!this.#entries.get(id)?.critical)issues.push({code:'MISSING_CRITICAL',id,message:'Required critical content entry is absent or noncritical.'});
    return Object.freeze(issues);
  }

  serialize():ContentManifestV15{const entries=this.entries();return Object.freeze({schema:1,build:this.#build,generatedAt:new Date(0).toISOString(),entries,digest:manifestDigestV15(entries)});}
  reset():void{this.#entries.clear();this.#digest='';}
  #normalize(entry:ContentEntryV15):ContentEntryV15{return Object.freeze({id:entry.id.trim().slice(0,128),path:entry.path.replaceAll('\\\\','/').trim(),kind:entry.kind,version:entry.version.trim().slice(0,64),bytes:Math.max(0,Math.trunc(entry.bytes)),...(entry.digest?{digest:entry.digest.toLowerCase()}:{}),tags:Object.freeze([...new Set(entry.tags.map((tag)=>tag.trim()).filter(Boolean))].sort()),critical:Boolean(entry.critical),...(entry.region?{region:entry.region.trim().slice(0,64)}:{})});}
}

export const manifestFromEntriesV15=(entries:readonly ContentEntryV15[],build='dev'):ContentManifestV15=>{const manifest=new ContentManifestV15(build);for(const entry of entries)manifest.upsert(entry);return manifest;};
