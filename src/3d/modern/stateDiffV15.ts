/** Generic immutable state diff/apply helpers for snapshots, replay and rollback diagnostics. */
export type DiffPathV15=readonly (string|number)[];
export type DiffOperationV15<T=unknown>={readonly op:'add'|'remove'|'replace';readonly path:DiffPathV15;readonly value?:T;readonly previous?:T;};
export interface StateDiffV15<T=unknown>{readonly revision:number;readonly fromDigest:string;readonly toDigest:string;readonly operations:readonly DiffOperationV15<T>[];}

const stable=(value:unknown):string=>{if(value===null||typeof value!=='object')return JSON.stringify(value)??'undefined';if(Array.isArray(value))return'['+value.map(stable).join(',')+']';const object=value as Record<string,unknown>;return'{'+Object.keys(object).sort().map(k=>JSON.stringify(k)+':'+stable(object[k])).join(',')+'}';};
const digest=(value:unknown):string=>{const source=stable(value);let h=2166136261;for(let i=0;i<source.length;i+=1){h^=source.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const equal=(a:unknown,b:unknown):boolean=>stable(a)===stable(b);

export const diffStateV15=<T>(from:T,to:T):readonly DiffOperationV15[]=>{
  const operations:DiffOperationV15[]=[];
  const visit=(a:unknown,b:unknown,path:DiffPathV15):void=>{
    if(equal(a,b))return;
    if(a===undefined){operations.push(Object.freeze({op:'add',path,value:b}));return;}
    if(b===undefined){operations.push(Object.freeze({op:'remove',path,previous:a}));return;}
    if(Array.isArray(a)&&Array.isArray(b)){const length=Math.max(a.length,b.length);for(let i=0;i<length;i+=1)visit(a[i],b[i],[...path,i]);return;}
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){const keys=new Set([...Object.keys(a as object),...Object.keys(b as object)]);for(const key of [...keys].sort())visit((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key],[...path,key]);return;}
    operations.push(Object.freeze({op:'replace',path,value:b,previous:a}));
  };
  visit(from,to,[]);return Object.freeze(operations);
};

export const applyDiffV15=<T>(state:T,operations:readonly DiffOperationV15[]):T=>{
  let result=JSON.parse(JSON.stringify(state)) as unknown;
  const setAt=(root:unknown,path:DiffPathV15,value:unknown):unknown=>{if(path.length===0)return JSON.parse(JSON.stringify(value));const [head,...rest]=path;const container=Array.isArray(root)?[...(root as unknown[])]:{...root as Record<string,unknown>};if(rest.length===0){if(value===undefined&&Array.isArray(container))container.splice(Number(head),1);else if(value===undefined)delete(container as Record<string,unknown>)[String(head)];else(container as Record<string,unknown>)[String(head)]=JSON.parse(JSON.stringify(value));return container;}const child=Array.isArray(container)?container[Number(head)]: (container as Record<string,unknown>)[String(head)];const next=setAt(child,rest,value);if(Array.isArray(container))(container as unknown[])[Number(head)]=next;else(container as Record<string,unknown>)[String(head)]=next;return container;};
  for(const operation of operations){if(operation.op==='remove')result=setAt(result,operation.path,undefined);else result=setAt(result,operation.path,operation.value);}return result as T;
};

export const createStateDiffV15=<T>(from:T,to:T,revision:number):StateDiffV15=>Object.freeze({revision:Math.max(0,Math.trunc(revision)),fromDigest:digest(from),toDigest:digest(to),operations:diffStateV15(from,to)});
export const verifyStateDiffV15=<T>(from:T,diff:StateDiffV15,to:T):boolean=>digest(applyDiffV15(from,diff.operations))===digest(to);
export const invertDiffV15=<T>(operations:readonly DiffOperationV15<T>[]):readonly DiffOperationV15<T>[]=>Object.freeze([...operations].reverse().map((operation)=>operation.op==='add'?Object.freeze({op:'remove',path:operation.path,previous:operation.value}):operation.op==='remove'?Object.freeze({op:'add',path:operation.path,value:operation.previous}):Object.freeze({op:'replace',path:operation.path,value:operation.previous,previous:operation.value})));

export const stateDigestV15=digest;
