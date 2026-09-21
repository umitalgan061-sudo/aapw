/** Deterministic spatial hash with bounded broadphase queries. */
export interface SpatialPointV15{readonly x:number;readonly y:number;readonly z:number;}
export interface SpatialEntityV15<T=unknown>{readonly id:string;readonly position:SpatialPointV15;readonly radius:number;readonly layer:number;readonly value:T;readonly active:boolean;}
export interface SpatialQueryV15{readonly center:SpatialPointV15;readonly radius:number;readonly layer?:number;readonly limit?:number;}
export interface SpatialMetricsV15{readonly entities:number;readonly buckets:number;readonly queries:number;readonly visitedCells:number;readonly returnedEntities:number;readonly averageVisitedCells:number;}

const cellKey=(x:number,z:number)=>x+':'+z;
const cellCoord=(value:number,size:number)=>Math.floor(value/size);
const distanceSq=(a:SpatialPointV15,b:SpatialPointV15)=>{const x=a.x-b.x,y=a.y-b.y,z=a.z-b.z;return x*x+y*y+z*z;};

export class SpatialRuntimeV15<T=unknown>{
  readonly #cellSize:number;readonly #buckets=new Map<string,Set<string>>();readonly #entities=new Map<string,SpatialEntityV15<T>>();
  #queries=0;#visitedCells=0;#returned=0;
  constructor(cellSize=32){this.#cellSize=Math.max(1,Number.isFinite(cellSize)?cellSize:32);}
  get cellSize():number{return this.#cellSize;}
  set(entity:SpatialEntityV15<T>):void{this.remove(entity.id);const normalized=Object.freeze({...entity,radius:Math.max(0,entity.radius),layer:Math.trunc(entity.layer),position:Object.freeze({...entity.position})});this.#entities.set(entity.id,normalized);const cells=this.#coveredCells(normalized);for(const cell of cells){const bucket=this.#buckets.get(cell)??new Set<string>();bucket.add(entity.id);this.#buckets.set(cell,bucket);}}
  remove(id:string):boolean{const entity=this.#entities.get(id);if(!entity)return false;for(const cell of this.#coveredCells(entity)){const bucket=this.#buckets.get(cell);bucket?.delete(id);if(bucket&&bucket.size===0)this.#buckets.delete(cell);}return this.#entities.delete(id);}
  get(id:string):SpatialEntityV15<T>|undefined{return this.#entities.get(id);}
  clear():void{this.#entities.clear();this.#buckets.clear();this.#queries=0;this.#visitedCells=0;this.#returned=0;}
  size():number{return this.#entities.size;}

  querySphere(query:SpatialQueryV15):readonly SpatialEntityV15<T>[]{
    const radius=Math.max(0,query.radius);const minX=cellCoord(query.center.x-radius,this.#cellSize),maxX=cellCoord(query.center.x+radius,this.#cellSize),minZ=cellCoord(query.center.z-radius,this.#cellSize),maxZ=cellCoord(query.center.z+radius,this.#cellSize);
    const candidates=new Set<string>();this.#queries+=1;for(let x=minX;x<=maxX;x+=1)for(let z=minZ;z<=maxZ;z+=1){this.#visitedCells+=1;for(const id of this.#buckets.get(cellKey(x,z))??[])candidates.add(id);}
    const radiusSq=radius*radius;const result:[SpatialEntityV15<T>,number][]=[];
    for(const id of candidates){const entity=this.#entities.get(id);if(!entity||!entity.active)continue;if(query.layer!==undefined&&entity.layer!==query.layer)continue;const range=radius+entity.radius;const d2=distanceSq(entity.position,query.center);if(d2<=range*range)result.push([entity,d2]);}
    result.sort((a,b)=>a[1]-b[1]||a[0].id.localeCompare(b[0].id));const limited=result.slice(0,Math.max(0,Math.trunc(query.limit??result.length)));this.#returned+=limited.length;return Object.freeze(limited.map(([entity])=>entity));
  }

  queryAabb(min:SpatialPointV15,max:SpatialPointV15,limit=Infinity):readonly SpatialEntityV15<T>[]{const radius=Math.max(Math.abs(max.x-min.x),Math.abs(max.z-min.z));const center={x:(min.x+max.x)/2,y:(min.y+max.y)/2,z:(min.z+max.z)/2};return this.querySphere({center,radius,limit}).filter(e=>e.position.x+e.radius>=min.x&&e.position.x-e.radius<=max.x&&e.position.z+e.radius>=min.z&&e.position.z-e.radius<=max.z);}
  nearest(point:SpatialPointV15,maxDistance=Infinity,layer?:number):SpatialEntityV15<T>|undefined{return this.querySphere({center:point,radius:maxDistance,layer,limit:1})[0];}

  metrics():SpatialMetricsV15{return Object.freeze({entities:this.#entities.size,buckets:this.#buckets.size,queries:this.#queries,visitedCells:this.#visitedCells,returnedEntities:this.#returned,averageVisitedCells:this.#queries?this.#visitedCells/this.#queries:0});}
  entities():readonly SpatialEntityV15<T>[]{return Object.freeze([...this.#entities.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  buckets():readonly string[]{return Object.freeze([...this.#buckets.keys()].sort());}
  rebuild():void{const entities=this.entities();this.#buckets.clear();for(const entity of entities)for(const cell of this.#coveredCells(entity)){const bucket=this.#buckets.get(cell)??new Set<string>();bucket.add(entity.id);this.#buckets.set(cell,bucket);}}

  #coveredCells(entity:SpatialEntityV15<T>):readonly string[]{const minX=cellCoord(entity.position.x-entity.radius,this.#cellSize),maxX=cellCoord(entity.position.x+entity.radius,this.#cellSize),minZ=cellCoord(entity.position.z-entity.radius,this.#cellSize),maxZ=cellCoord(entity.position.z+entity.radius,this.#cellSize);const out:string[]=[];for(let x=minX;x<=maxX;x+=1)for(let z=minZ;z<=maxZ;z+=1)out.push(cellKey(x,z));return out;}
}

export const spatialDistanceV15=(a:SpatialPointV15,b:SpatialPointV15):number=>Math.sqrt(distanceSq(a,b));
