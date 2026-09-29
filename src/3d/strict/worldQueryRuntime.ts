import type { Aabb2, Circle2, Collider, EntityId, Vec3 } from './liveCoreTypes.ts';
import { clamp, stableHash } from './liveCoreTypes.ts';

export type QueryShape={readonly type:'circle';readonly center:Circle2}|{readonly type:'aabb';readonly bounds:Aabb2};
export interface WorldQueryFilter{readonly layerMask?:number;readonly maxResults?:number;readonly includeDisabled?:boolean;}
export interface WorldQueryHit{readonly id:EntityId;readonly distance:number;readonly position:Vec3;readonly collider:Collider;}
export interface WorldQueryDiagnostics{readonly queries:number;readonly candidates:number;readonly hits:number;readonly digest:string;}

const distanceToAabb=(x:number,z:number,b:Aabb2)=>{const dx=x<b.minX?b.minX-x:x>b.maxX?x-b.maxX:0;const dz=z<b.minZ?b.minZ-z:z>b.maxZ?z-b.maxZ:0;return Math.hypot(dx,dz);};
const distanceToSegment=(x:number,z:number,s:{readonly ax:number;readonly az:number;readonly bx:number;readonly bz:number})=>{const dx=s.bx-s.ax,dz=s.bz-s.az,len2=dx*dx+dz*dz;if(len2<=1e-9)return Math.hypot(x-s.ax,z-s.az);const t=clamp(((x-s.ax)*dx+(z-s.az)*dz)/len2,0,1);return Math.hypot(x-(s.ax+dx*t),z-(s.az+dz*t));};
const centerOf=(c:Collider)=>c.shape.type==='circle'?{x:c.shape.value.x,z:c.shape.value.z}:c.shape.type==='aabb'?{x:(c.shape.value.minX+c.shape.value.maxX)/2,z:(c.shape.value.minZ+c.shape.value.maxZ)/2}:{x:(c.shape.value.ax+c.shape.value.bx)/2,z:(c.shape.value.az+c.shape.value.bz)/2};
const intersects=(shape:QueryShape,c:Collider)=>{if(c.shape.type==='circle'&&shape.type==='circle')return Math.hypot(c.shape.value.x-shape.center.x,c.shape.value.z-shape.center.z)<=c.shape.value.radius+shape.center.radius;if(c.shape.type==='aabb'&&shape.type==='aabb')return !(c.shape.value.maxX<shape.bounds.minX||c.shape.value.minX>shape.bounds.maxX||c.shape.value.maxZ<shape.bounds.minZ||c.shape.value.minZ>shape.bounds.maxZ);
const circle=c.shape.type==='circle'?c.shape.value:shape.type==='circle'?shape.center:null;
const box=c.shape.type==='aabb'?c.shape.value:shape.type==='aabb'?shape.bounds:null;
if(circle&&box)return distanceToAabb(circle.x,circle.z,box)<=circle.radius;
if(c.shape.type==='segment'&&shape.type==='circle')return distanceToSegment(shape.center.x,shape.center.z,c.shape.value)<=shape.center.radius;
if(c.shape.type==='circle'&&shape.type==='aabb')return distanceToAabb(c.shape.value.x,c.shape.value.z,shape.bounds)<=c.shape.value.radius;
return false;};

export class StrictWorldQueryRuntime{
 #colliders:Collider[]=[];#queries=0;#candidates=0;#hits=0;#disposed=false;
 constructor(colliders:readonly Collider[]=[]){this.#colliders=[...colliders].sort((a,b)=>a.id.localeCompare(b.id));}
 add(collider:Collider){if(this.#disposed)return false;if(this.#colliders.some(c=>c.id===collider.id))return false;this.#colliders.push(collider);this.#colliders.sort((a,b)=>a.id.localeCompare(b.id));return true;}
 remove(id:EntityId){this.#colliders=this.#colliders.filter(c=>c.id!==id);}
 query(shape:QueryShape,filter:WorldQueryFilter={}):readonly WorldQueryHit[]{if(this.#disposed)return [];this.#queries++;const layerMask=filter.layerMask??0xffff;const candidates=this.#colliders.filter(c=>(filter.includeDisabled||c.enabled)&&(c.layer&layerMask)!==0);this.#candidates+=candidates.length;const hits:WorldQueryHit[]=[];for(const collider of candidates){if(!intersects(shape,collider))continue;const center=centerOf(collider);const x=shape.type==='circle'?shape.center.x:Math.max(shape.bounds.minX,Math.min(center.x,shape.bounds.maxX));const z=shape.type==='circle'?shape.center.z:Math.max(shape.bounds.minZ,Math.min(center.z,shape.bounds.maxZ));hits.push(Object.freeze({id:collider.id,distance:Math.hypot(center.x-x,center.z-z),position:Object.freeze({x, y:0, z}),collider}));}hits.sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));this.#hits+=hits.length;return Object.freeze(hits.slice(0,Math.max(0,Math.floor(filter.maxResults??512))));}
 nearest(point:Vec3,maxDistance=Infinity,filter:WorldQueryFilter={}):WorldQueryHit|null{const hits=this.query({type:'circle',center:{x:point.x,z:point.z,radius:Math.max(0,maxDistance)}},filter);return hits[0]??null;}
 diagnostics():WorldQueryDiagnostics{return Object.freeze({queries:this.#queries,candidates:this.#candidates,hits:this.#hits,digest:stableHash({queries:this.#queries,candidates:this.#candidates,hits:this.#hits,colliders:this.#colliders.map(c=>c.id)})});}
 snapshot():readonly Collider[]{return Object.freeze([...this.#colliders]);}
 dispose(){this.#disposed=true;this.#colliders=[];}
}
void clamp;