import type { R16Result } from './types.js';

export type R16ServiceFactory<T> = () => T;
export interface R16ServiceDescriptor<T=unknown>{readonly id:string;readonly version:number;readonly factory:R16ServiceFactory<T>;readonly dependsOn:readonly string[];readonly critical:boolean;}
export interface R16ServiceState{readonly id:string;readonly version:number;readonly started:boolean;readonly healthy:boolean;readonly dependencyFailures:readonly string[];}

export class R16ServiceRegistry{
  readonly #services=new Map<string,R16ServiceDescriptor>();
  readonly #instances=new Map<string,unknown>();
  readonly #states=new Map<string,R16ServiceState>();
  register<T>(descriptor:R16ServiceDescriptor<T>):R16Result<void>{
    if(!descriptor.id||descriptor.id.length>96||this.#services.has(descriptor.id))return{ok:false,error:{code:'SERVICE_DUPLICATE',message:'Service id must be unique',retryable:false}};
    if(descriptor.version<1||!Number.isInteger(descriptor.version))return{ok:false,error:{code:'SERVICE_VERSION',message:'Service version is invalid',retryable:false}};
    this.#services.set(descriptor.id,descriptor as R16ServiceDescriptor);
    this.#states.set(descriptor.id,Object.freeze({id:descriptor.id,version:descriptor.version,started:false,healthy:true,dependencyFailures:Object.freeze([])}));
    return{ok:true,value:undefined};
  }
  startAll():R16Result<readonly string[]>{
    const started:string[]=[];const visiting=new Set<string>();const visited=new Set<string>();
    const start=(id:string):R16Result<void>=>{
      if(visited.has(id))return{ok:true,value:undefined};if(visiting.has(id))return{ok:false,error:{code:'SERVICE_CYCLE',message:'Service dependency cycle detected at '+id,retryable:false}};
      const descriptor=this.#services.get(id);if(!descriptor)return{ok:false,error:{code:'SERVICE_MISSING',message:'Missing dependency '+id,retryable:false}};
      visiting.add(id);const failures:string[]=[];
      for(const dep of descriptor.dependsOn){const result=start(dep);if(!result.ok)failures.push(dep);}
      visiting.delete(id);if(failures.length){
        const state=this.#states.get(id)!;this.#states.set(id,Object.freeze({...state,healthy:false,dependencyFailures:Object.freeze(failures)}));
        if(descriptor.critical)return{ok:false,error:{code:'SERVICE_DEPENDENCY',message:'Critical service dependency failed for '+id,retryable:false}};return{ok:true,value:undefined};
      }
      try{this.#instances.set(id,descriptor.factory());const state=this.#states.get(id)!;this.#states.set(id,Object.freeze({...state,started:true,healthy:true,dependencyFailures:Object.freeze([])}));visited.add(id);started.push(id);return{ok:true,value:undefined};}
      catch(error){const state=this.#states.get(id)!;this.#states.set(id,Object.freeze({...state,started:false,healthy:false}));return{ok:false,error:{code:'SERVICE_START',message:error instanceof Error?error.message:String(error),retryable:false}};}
    };
    for(const id of this.#services.keys()){const result=start(id);if(!result.ok&&this.#services.get(id)?.critical)return result;}
    return{ok:true,value:Object.freeze(started)};
  }
  get<T>(id:string):T|null{return (this.#instances.get(id) as T|undefined)??null;}
  state(id:string):R16ServiceState|null{return this.#states.get(id)??null;}
  states(){return Object.freeze([...this.#states.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  stopAll():void{for(const id of [...this.#instances.keys()].sort().reverse())this.#instances.delete(id);for(const [id,state]of this.#states)this.#states.set(id,Object.freeze({...state,started:false}));}
  clear():void{this.stopAll();this.#services.clear();this.#states.clear();}
}
