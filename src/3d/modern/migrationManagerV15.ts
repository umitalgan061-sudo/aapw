/** Explicit legacy-to-modern ownership planner for incremental migration without dual truth. */
export type OwnershipModeV15='legacy'|'shadow'|'canary'|'modern'|'retired';
export type MigrationRiskV15='low'|'medium'|'high'|'critical';
export interface MigrationSurfaceV15{readonly id:string;readonly legacyPath:string;readonly modernPath:string;readonly mode:OwnershipModeV15;readonly risk:MigrationRiskV15;readonly deterministic:boolean;readonly parity:number;readonly errorRate:number;readonly frameDeltaMs:number;readonly memoryDeltaMb:number;readonly blockers:readonly string[];readonly owner:'runtime'|'render'|'world'|'network'|'gameplay'|'ui';}
export interface MigrationSignalV15{readonly deterministic:boolean;readonly parity:number;readonly errorRate:number;readonly frameDeltaMs:number;readonly memoryDeltaMb:number;readonly blockers?:readonly string[];}
export interface MigrationDecisionV15{readonly id:string;readonly mode:OwnershipModeV15;readonly eligible:boolean;readonly score:number;readonly reasons:readonly string[];readonly nextMode?:OwnershipModeV15;}
export interface MigrationReportV15{readonly revision:number;readonly eligible:readonly MigrationDecisionV15[];readonly blocked:readonly MigrationDecisionV15[];readonly retired:readonly string[];}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));
const modes:readonly OwnershipModeV15[]=['legacy','shadow','canary','modern','retired'];

export class MigrationManagerV15{
  readonly #surfaces=new Map<string,MigrationSurfaceV15>();
  readonly #revisions=new Map<string,number>();
  #revision=0;

  register(surface:Omit<MigrationSurfaceV15,'parity'|'errorRate'|'frameDeltaMs'|'memoryDeltaMb'|'blockers'> & Partial<Pick<MigrationSurfaceV15,'parity'|'errorRate'|'frameDeltaMs'|'memoryDeltaMb'|'blockers'>>):MigrationSurfaceV15{
    if(this.#surfaces.has(surface.id))throw new Error('Migration surface already exists: '+surface.id);
    const value=Object.freeze({...surface,parity:clamp(surface.parity??0,0,1),errorRate:clamp(surface.errorRate??1,0,1),frameDeltaMs:Number.isFinite(surface.frameDeltaMs)?surface.frameDeltaMs!:0,memoryDeltaMb:Number.isFinite(surface.memoryDeltaMb)?surface.memoryDeltaMb!:0,blockers:Object.freeze([...(surface.blockers??[])])});
    this.#surfaces.set(surface.id,value);this.#revisions.set(surface.id,0);this.#revision+=1;return value;
  }

  updateSignal(id:string,signal:MigrationSignalV15):MigrationSurfaceV15|undefined{
    const current=this.#surfaces.get(id);if(!current)return undefined;
    const value=Object.freeze({...current,deterministic:Boolean(signal.deterministic),parity:clamp(signal.parity,0,1),errorRate:clamp(signal.errorRate,0,1),frameDeltaMs:Number.isFinite(signal.frameDeltaMs)?signal.frameDeltaMs:0,memoryDeltaMb:Number.isFinite(signal.memoryDeltaMb)?signal.memoryDeltaMb:0,blockers:Object.freeze([...(signal.blockers??[])])});
    this.#surfaces.set(id,value);this.#revisions.set(id,(this.#revisions.get(id)??0)+1);this.#revision+=1;return value;
  }

  decide(id:string):MigrationDecisionV15{
    const surface=this.#surfaces.get(id);if(!surface)throw new Error('Unknown migration surface: '+id);
    const reasons:string[]=[];
    if(!surface.deterministic)reasons.push('determinism');
    if(surface.parity<.98)reasons.push('parity');
    if(surface.errorRate>.01)reasons.push('error-rate');
    if(surface.frameDeltaMs>2)reasons.push('frame-regression');
    if(surface.memoryDeltaMb>32)reasons.push('memory-regression');
    if(surface.blockers.length)reasons.push(...surface.blockers);
    const score=clamp(surface.deterministic?surface.parity*100-surface.errorRate*200-surface.frameDeltaMs*3-surface.memoryDeltaMb*.1:0,0,100);
    const eligible=reasons.length===0;
    const nextMode=eligible?this.#next(surface.mode):undefined;
    return Object.freeze({id,mode:surface.mode,eligible,score:Number(score.toFixed(2)),reasons:Object.freeze([...new Set(reasons)]),...(nextMode?{nextMode}: {})});
  }

  advanceEligible():MigrationReportV15{
    const eligible:MigrationDecisionV15[]=[];const blocked:MigrationDecisionV15[]=[];const retired:string[]=[];
    for(const surface of this.#surfaces.values()){
      const decision=this.decide(surface.id);
      if(surface.mode==='retired'){retired.push(surface.id);continue;}
      if(decision.eligible){eligible.push(decision);if(decision.nextMode&&decision.nextMode!==surface.mode)this.#setMode(surface.id,decision.nextMode);}else blocked.push(decision);
    }
    return Object.freeze({revision:this.#revision,eligible:Object.freeze(eligible),blocked:Object.freeze(blocked),retired:Object.freeze(retired)});
  }

  cutover(id:string):MigrationDecisionV15{
    const surface=this.#surfaces.get(id);if(!surface)throw new Error('Unknown migration surface: '+id);
    const decision=this.decide(id);if(!decision.eligible)throw new Error('Migration surface blocked: '+decision.reasons.join(', '));
    this.#setMode(id,'modern');return this.decide(id);
  }

  retire(id:string):void{const surface=this.#surfaces.get(id);if(!surface)throw new Error('Unknown migration surface: '+id);if(surface.mode!=='modern')throw new Error('Only modern surfaces may be retired.');this.#setMode(id,'retired');}
  rollback(id:string):void{const surface=this.#surfaces.get(id);if(!surface)throw new Error('Unknown migration surface: '+id);if(surface.mode==='retired')throw new Error('Retired surface cannot be rolled back automatically.');this.#setMode(id,'canary');}

  get(id:string):MigrationSurfaceV15|undefined{return this.#surfaces.get(id);}
  surfaces():readonly MigrationSurfaceV15[]{return Object.freeze([...this.#surfaces.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
  revision(id:string):number{return this.#revisions.get(id)??0;}
  report():MigrationReportV15{return this.advanceEligible();}

  #setMode(id:string,mode:OwnershipModeV15):void{const current=this.#surfaces.get(id)!;if(modes.indexOf(mode)<modes.indexOf(current.mode)&&mode!=='canary')return;this.#surfaces.set(id,Object.freeze({...current,mode}));this.#revision+=1;this.#revisions.set(id,(this.#revisions.get(id)??0)+1);}
  #next(mode:OwnershipModeV15):OwnershipModeV15|undefined{if(mode==='legacy')return'shadow';if(mode==='shadow')return'canary';if(mode==='canary')return'modern';if(mode==='modern')return'retired';return undefined;}
}

export const migrationModeRankV15=(mode:OwnershipModeV15):number=>modes.indexOf(mode);
