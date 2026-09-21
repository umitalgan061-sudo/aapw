/** Stable snapshot codec with quantization, bounds checks and deterministic checksums. */
export interface SnapshotEntityV15{readonly id:number;readonly x:number;readonly y:number;readonly z:number;readonly yaw:number;readonly vx:number;readonly vy:number;readonly vz:number;readonly health:number;readonly flags:number;}
export interface SnapshotFrameV15{readonly version:15;readonly tick:number;readonly sequence:number;readonly serverTimeMs:number;readonly entities:readonly SnapshotEntityV15[];readonly checksum:string;}
export interface SnapshotCodecOptionsV15{readonly maxEntities?:number;readonly coordinateScale?:number;readonly velocityScale?:number;readonly healthScale?:number;readonly maxBytes?:number;}
export interface SnapshotDecodeResultV15{readonly ok:true;readonly snapshot:SnapshotFrameV15}|{readonly ok:false;readonly error:string;readonly offset?:number;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,finite(v,a)));
const hash=(values:readonly number[]):string=>{let h=2166136261;for(const value of values){h^=value|0;h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};

export class NetworkSnapshotCodecV15{
  readonly #maxEntities:number;readonly #coordinateScale:number;readonly #velocityScale:number;readonly #healthScale:number;readonly #maxBytes:number;
  constructor(options:SnapshotCodecOptionsV15={}){this.#maxEntities=Math.max(1,Math.trunc(options.maxEntities??8192));this.#coordinateScale=Math.max(1,Math.trunc(options.coordinateScale??100));this.#velocityScale=Math.max(1,Math.trunc(options.velocityScale??100));this.#healthScale=Math.max(1,Math.trunc(options.healthScale??10));this.#maxBytes=Math.max(1024,Math.trunc(options.maxBytes??1024*1024));}

  encode(input:Omit<SnapshotFrameV15,'version'|'checksum'>):Uint8Array{
    if(input.entities.length>this.#maxEntities)throw new Error('Snapshot entity limit exceeded.');
    const values:number[]=[15,Math.max(0,Math.trunc(input.tick)),Math.max(0,Math.trunc(input.sequence)),Math.max(0,Math.trunc(input.serverTimeMs)),input.entities.length];
    for(const entity of input.entities){values.push(Math.max(0,Math.trunc(entity.id)));values.push(Math.round(clamp(entity.x,-21474836,21474836)*this.#coordinateScale));values.push(Math.round(clamp(entity.y,-21474836,21474836)*this.#coordinateScale));values.push(Math.round(clamp(entity.z,-21474836,21474836)*this.#coordinateScale));values.push(Math.round(clamp(entity.yaw,-100000,100000)*this.#coordinateScale));values.push(Math.round(clamp(entity.vx,-100000,100000)*this.#velocityScale));values.push(Math.round(clamp(entity.vy,-100000,100000)*this.#velocityScale));values.push(Math.round(clamp(entity.vz,-100000,100000)*this.#velocityScale));values.push(Math.round(clamp(entity.health,0,100000)*this.#healthScale));values.push(Math.trunc(entity.flags));}
    const checksum=hash(values);const json=JSON.stringify({v:15,t:values[1],s:values[2],m:values[3],c:checksum,e:input.entities.map((entity)=>[Math.trunc(entity.id),Math.round(clamp(entity.x,-21474836,21474836)*this.#coordinateScale),Math.round(clamp(entity.y,-21474836,21474836)*this.#coordinateScale),Math.round(clamp(entity.z,-21474836,21474836)*this.#coordinateScale),Math.round(clamp(entity.yaw,-100000,100000)*this.#coordinateScale),Math.round(clamp(entity.vx,-100000,100000)*this.#velocityScale),Math.round(clamp(entity.vy,-100000,100000)*this.#velocityScale),Math.round(clamp(entity.vz,-100000,100000)*this.#velocityScale),Math.round(clamp(entity.health,0,100000)*this.#healthScale),Math.trunc(entity.flags)])});
    const encoded=new TextEncoder().encode(json);if(encoded.byteLength>this.#maxBytes)throw new Error('Snapshot exceeds byte limit.');return encoded;
  }

  decode(data:Uint8Array):SnapshotDecodeResultV15{
    if(data.byteLength>this.#maxBytes)return{ok:false,error:'SNAPSHOT_TOO_LARGE'};
    let parsed:unknown;try{parsed=JSON.parse(new TextDecoder().decode(data));}catch{return{ok:false,error:'INVALID_SNAPSHOT_JSON'};}
    if(!parsed||typeof parsed!=='object')return{ok:false,error:'INVALID_SNAPSHOT'};const value=parsed as Record<string,unknown>;
    if(value.v!==15||typeof value.t!=='number'||typeof value.s!=='number'||typeof value.m!=='number'||typeof value.c!=='string'||!Array.isArray(value.e))return{ok:false,error:'INVALID_SNAPSHOT_FIELDS'};
    if(value.e.length>this.#maxEntities)return{ok:false,error:'ENTITY_LIMIT_EXCEEDED'};
    const entities:SnapshotEntityV15[]=[];const values:number[]=[15,Math.trunc(value.t),Math.trunc(value.s),Math.trunc(value.m),value.e.length];
    for(let index=0;index<value.e.length;index+=1){const row=value.e[index];if(!Array.isArray(row)||row.length!==10)return{ok:false,error:'INVALID_ENTITY',offset:index};const nums=row.map((entry)=>Number(entry));if(nums.some((entry)=>!Number.isFinite(entry)))return{ok:false,error:'NONFINITE_ENTITY',offset:index};const [id,x,y,z,yaw,vx,vy,vz,health,flags]=nums;values.push(Math.trunc(id!),Math.trunc(x!),Math.trunc(y!),Math.trunc(z!),Math.trunc(yaw!),Math.trunc(vx!),Math.trunc(vy!),Math.trunc(vz!),Math.trunc(health!),Math.trunc(flags!));entities.push(Object.freeze({id:Math.trunc(id!),x:x!/this.#coordinateScale,y:y!/this.#coordinateScale,z:z!/this.#coordinateScale,yaw:yaw!/this.#coordinateScale,vx:vx!/this.#velocityScale,vy:vy!/this.#velocityScale,vz:vz!/this.#velocityScale,health:health!/this.#healthScale,flags:Math.trunc(flags!)}));}
    if(hash(values)!==value.c)return{ok:false,error:'CHECKSUM_MISMATCH'};
    return{ok:true,snapshot:Object.freeze({version:15,tick:Math.max(0,Math.trunc(value.t)),sequence:Math.max(0,Math.trunc(value.s)),serverTimeMs:Math.max(0,Math.trunc(value.m)),entities:Object.freeze(entities),checksum:value.c})};
  }

  quantizeEntity(entity:SnapshotEntityV15):SnapshotEntityV15{return Object.freeze({id:Math.trunc(entity.id),x:Math.round(entity.x*this.#coordinateScale)/this.#coordinateScale,y:Math.round(entity.y*this.#coordinateScale)/this.#coordinateScale,z:Math.round(entity.z*this.#coordinateScale)/this.#coordinateScale,yaw:Math.round(entity.yaw*this.#coordinateScale)/this.#coordinateScale,vx:Math.round(entity.vx*this.#velocityScale)/this.#velocityScale,vy:Math.round(entity.vy*this.#velocityScale)/this.#velocityScale,vz:Math.round(entity.vz*this.#velocityScale)/this.#velocityScale,health:Math.round(entity.health*this.#healthScale)/this.#healthScale,flags:Math.trunc(entity.flags)});}
  estimateBytes(entityCount:number):number{return new TextEncoder().encode(JSON.stringify({v:15,t:0,s:0,m:0,c:'00000000',e:Array.from({length:Math.max(0,Math.min(this.#maxEntities,Math.trunc(entityCount)))},()=>[0,0,0,0,0,0,0,0,0,0])})).byteLength;}
  validate(snapshot:SnapshotFrameV15):readonly string[]{const issues:string[]=[];if(snapshot.version!==15)issues.push('VERSION');if(snapshot.entities.length>this.#maxEntities)issues.push('ENTITY_LIMIT');for(const entity of snapshot.entities){if(!Number.isFinite(entity.x)||!Number.isFinite(entity.y)||!Number.isFinite(entity.z))issues.push('NONFINITE_POSITION');if(entity.health<0)issues.push('NEGATIVE_HEALTH');}return Object.freeze([...new Set(issues)]);}
}

export const interpolateSnapshotEntityV15=(a:SnapshotEntityV15,b:SnapshotEntityV15,t:number):SnapshotEntityV15=>{const p=Math.min(1,Math.max(0,Number.isFinite(t)?t:0));return Object.freeze({id:b.id,x:a.x+(b.x-a.x)*p,y:a.y+(b.y-a.y)*p,z:a.z+(b.z-a.z)*p,yaw:a.yaw+(b.yaw-a.yaw)*p,vx:a.vx+(b.vx-a.vx)*p,vy:a.vy+(b.vy-a.vy)*p,vz:a.vz+(b.vz-a.vz)*p,health:a.health+(b.health-a.health)*p,flags:p<.5?a.flags:b.flags});};
