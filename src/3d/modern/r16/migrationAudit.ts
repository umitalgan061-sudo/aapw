import { digestValue } from './deterministic.js';

export type R16MigrationStatus='legacy'|'shadow'|'parity'|'promoted'|'blocked';
export interface R16MigrationSurface{readonly id:string;readonly owner:string;readonly legacyPath:string|null;readonly modernPath:string;readonly status:R16MigrationStatus;readonly checks:number;readonly passed:number;readonly failed:number;readonly notes:string;}
export interface R16MigrationAudit{readonly surfaces:readonly R16MigrationSurface[];readonly promoted:number;readonly blocked:number;readonly digest:string;}

export class R16MigrationLedger{
  readonly #surfaces=new Map<string,R16MigrationSurface>();
  register(surface:Omit<R16MigrationSurface,'status'|'checks'|'passed'|'failed'|'notes'>):void{
    if(!surface.id||this.#surfaces.has(surface.id))return;
    this.#surfaces.set(surface.id,Object.freeze({...surface,status:'legacy',checks:0,passed:0,failed:0,notes:''}));
  }
  record(id:string,passed:boolean,note=''):boolean{
    const current=this.#surfaces.get(id);if(!current)return false;
    const nextChecks=current.checks+1,nextPassed=current.passed+(passed?1:0),nextFailed=current.failed+(passed?0:1);
    const status:R16MigrationStatus=passed
      ? nextPassed>=1?'parity':current.status
      : 'blocked';
    this.#surfaces.set(id,Object.freeze({...current,status,checks:nextChecks,passed:nextPassed,failed:nextFailed,notes:note.slice(0,256)}));return true;
  }
  promote(id:string):boolean{
    const current=this.#surfaces.get(id);if(!current||current.status!=='parity'||current.passed<1||current.failed>0)return false;
    this.#surfaces.set(id,Object.freeze({...current,status:'promoted'}));return true;
  }
  block(id:string,note='blocked'):boolean{
    const current=this.#surfaces.get(id);if(!current)return false;this.#surfaces.set(id,Object.freeze({...current,status:'blocked',notes:note.slice(0,256)}));return true;
  }
  get(id:string){return this.#surfaces.get(id)??null;}
  audit():R16MigrationAudit{
    const surfaces=[...this.#surfaces.values()].sort((a,b)=>a.id.localeCompare(b.id));
    return Object.freeze({surfaces:Object.freeze(surfaces),promoted:surfaces.filter(x=>x.status==='promoted').length,blocked:surfaces.filter(x=>x.status==='blocked').length,digest:digestValue(surfaces)});
  }
  clear(){this.#surfaces.clear();}
}
