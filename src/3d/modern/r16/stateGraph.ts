import { digestValue,nextRevision,normalizeTick } from './deterministic.js';
import type { R16Result,R16RuntimeConfig,R16Source,R16StateMutation,R16StatePatch } from './types.js';

interface Node{value:unknown;children:Map<string,Node>;}
export interface R16StateTransaction{
  readonly id:string;readonly tick:number;readonly source:R16Source;readonly reason:string;
  set(path:string,value:unknown):R16Result<void>;delete(path:string):R16Result<void>;commit():R16Result<R16StatePatch>;rollback():void;
}
export class R16StateGraph{
  readonly #maxNodes:number;readonly #root:Node={value:undefined,children:new Map()};#nodeCount=1;#revision=0;#lastPatch:R16StatePatch|null=null;
  constructor(config:Pick<R16RuntimeConfig,'maxStateNodes'>){this.#maxNodes=Math.max(16,Math.trunc(config.maxStateNodes));}
  begin(tick:number,source:R16Source,reason='unspecified'):R16StateTransaction{
    const mutations:R16StateMutation[]=[];const t=normalizeTick(tick);const id=digestValue({t,source,reason,revision:this.#revision});let active=true;
    const set=(path:string,value:unknown):R16Result<void>=>{
      if(!active)return{ok:false,error:{code:'STATE_TRANSACTION_CLOSED',message:'Transaction is closed',retryable:false}};
      const p=normalizePath(path);if(!p)return{ok:false,error:{code:'STATE_PATH_INVALID',message:'State path is empty',retryable:false}};
      if(p.split('.').length>24)return{ok:false,error:{code:'STATE_PATH_DEPTH',message:'State path exceeds depth limit',retryable:false}};
      mutations.push(Object.freeze({path:p,value:sanitize(value,0),source,tick:t,mutationId:digestValue({id,p,value,index:mutations.length}),reason:reason.slice(0,256)}));return{ok:true,value:undefined};
    };
    const remove=(path:string)=>set(path,undefined);
    const commit=():R16Result<R16StatePatch>=>{
      if(!active)return{ok:false,error:{code:'STATE_TRANSACTION_CLOSED',message:'Transaction is closed',retryable:false}};
      const ordered=[...mutations].sort((a,b)=>a.path.localeCompare(b.path)||a.mutationId.localeCompare(b.mutationId));
      const estimate=estimateNodes(this.#root,ordered);
      if(this.#nodeCount+estimate>this.#maxNodes){active=false;return{ok:false,error:{code:'STATE_NODE_BUDGET',message:'State node budget exceeded',retryable:true}};}
      for(const mutation of ordered)apply(this.#root,mutation);this.#nodeCount=count(this.#root);this.#revision=nextRevision(this.#revision);active=false;
      const patch:R16StatePatch=Object.freeze({revision:this.#revision,tick:t,source,mutations:Object.freeze(ordered),digest:digestValue({revision:this.#revision,tick:t,source,mutations:ordered})});this.#lastPatch=patch;return{ok:true,value:patch};
    };
    const rollback=()=>{active=false;mutations.length=0;};
    return Object.freeze({id,tick:t,source,reason:reason.slice(0,256),set,delete:remove,commit,rollback});
  }
  get(path:string):unknown{return find(this.#root,normalizePath(path))?.value;}
  revision(){return this.#revision;}
  lastPatch(){return this.#lastPatch;}
  exportState(){return Object.freeze(exportNode(this.#root) as Record<string,unknown>);}
  digest(){return digestValue({revision:this.#revision,state:this.exportState()});}
  clear(){this.#root.value=undefined;this.#root.children.clear();this.#nodeCount=1;this.#revision=0;this.#lastPatch=null;}
}
function normalizePath(path:string){return String(path??'').trim().replace(/^\/+|\/+$/g,'').replace(/\/+/g,'.').slice(0,512);}
function sanitize(v:unknown,d:number):unknown{
  if(d>24)return null;if(Array.isArray(v))return Object.freeze(v.slice(0,512).map(x=>sanitize(x,d+1)));
  if(typeof v==='object'&&v!==null){const out:Record<string,unknown>={};for(const[k,c]of Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).slice(0,512))out[k.slice(0,96)]=sanitize(c,d+1);return Object.freeze(out);}
  if(typeof v==='number')return Number.isFinite(v)?v:0;if(typeof v==='bigint')return v.toString();if(typeof v==='function'||typeof v==='symbol')return null;return v;
}
function child(n:Node,k:string){let c=n.children.get(k);if(!c){c={value:undefined,children:new Map()};n.children.set(k,c);}return c;}
function apply(root:Node,m:R16StateMutation){const parts=m.path.split('.');let n=root;for(let i=0;i<parts.length-1;i++)n=child(n,parts[i]??'');const leaf=parts.at(-1)??'';if(m.value===undefined)n.children.delete(leaf);else child(n,leaf).value=m.value;}
function find(root:Node,path:string){if(!path)return root;let n:Node|undefined=root;for(const part of path.split('.')){if(!n)return undefined;n=n.children.get(part);}return n;}
function exportNode(n:Node):unknown{const out:Record<string,unknown>={};if(n.value!==undefined)out.value=n.value;for(const[k,c]of [...n.children.entries()].sort(([a],[b])=>a.localeCompare(b)))out[k]=exportNode(c);return Object.freeze(out);}
function count(n:Node){let total=1;for(const c of n.children.values())total+=count(c);return total;}
function estimateNodes(root:Node,mutations:readonly R16StateMutation[]){let estimate=0;for(const m of mutations){let n:Node|undefined=root;for(const p of m.path.split('.')){const next=n.children.get(p);if(next)n=next;else{estimate+=1;n=undefined;break;}}if(!n)estimate+=Math.max(0,m.path.split('.').length-1);}return estimate;}
