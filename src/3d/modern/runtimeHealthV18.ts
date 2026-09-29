/**
 * AAPW Runtime Health V18.
 *
 * Aggregates bounded health signals from runtime subsystems without coupling the
 * health model to a renderer or network vendor. Health is descriptive: it exposes
 * observable pressure, failures and readiness rather than making policy decisions.
 */

export type RuntimeHealthStateV18 = 'healthy' | 'degraded' | 'blocked' | 'failed';

export interface RuntimeHealthSignalV18 {
  readonly id: string;
  readonly score: number;
  readonly state: RuntimeHealthStateV18;
  readonly critical: boolean;
  readonly message: string | null;
  readonly details: Readonly<Record<string, number | string | boolean | null>>;
}

export interface RuntimeHealthReportV18 {
  readonly revision: number;
  readonly timestampMs: number;
  readonly state: RuntimeHealthStateV18;
  readonly score: number;
  readonly criticalFailures: readonly string[];
  readonly degradedSignals: readonly string[];
  readonly signals: readonly RuntimeHealthSignalV18[];
}

export interface RuntimeHealthOptionsV18 {
  readonly clock?: () => number;
  readonly minimumHealthyScore?: number;
  readonly minimumReadyRatio?: number;
}

function clamp(value:number,min:number,max:number):number{
  if(!Number.isFinite(value))return min;
  return Math.min(max,Math.max(min,value));
}
function normalize(value:string):string{return value.trim().toLowerCase().replace(/\s+/g,'.');}
function freeze<T>(value:T):T{return Object.freeze(value);}

export class RuntimeHealthV18 {
  readonly #clock:()=>number;
  readonly #minimumHealthyScore:number;
  readonly #minimumReadyRatio:number;
  readonly #signals=new Map<string,RuntimeHealthSignalV18>();
  #revision=0;

  public constructor(options:RuntimeHealthOptionsV18={}){
    this.#clock=options.clock??(()=>performance.now());
    this.#minimumHealthyScore=clamp(options.minimumHealthyScore??0.9,0,1);
    this.#minimumReadyRatio=clamp(options.minimumReadyRatio??0.8,0,1);
  }

  public set(signal:RuntimeHealthSignalV18):RuntimeHealthSignalV18{
    const id=normalize(signal.id);
    if(!id)throw new TypeError('Health signal id is required.');
    const normalized=freeze({
      ...signal,
      id,
      score:clamp(signal.score,0,1),
      critical:Boolean(signal.critical),
      message:signal.message?.trim().slice(0,512)??null,
      details:freeze({...signal.details}),
    });
    this.#signals.set(id,normalized);
    this.#revision+=1;
    return normalized;
  }

  public remove(id:string):boolean{
    const deleted=this.#signals.delete(normalize(id));
    if(deleted)this.#revision+=1;
    return deleted;
  }

  public setReadiness(id:string,ready:boolean,critical=true,details:Readonly<Record<string,number|string|boolean|null>>={}):void{
    this.set({
      id,
      score:ready?1:0,
      state:ready?'healthy':critical?'failed':'degraded',
      critical,
      message:ready?null:'readiness requirement not satisfied',
      details,
    });
  }

  public setPressure(id:string,pressure:number,critical=false,details:Readonly<Record<string,number|string|boolean|null>>={}):void{
    const p=clamp(pressure,0,2);
    const score=clamp(1-Math.max(0,p-0.35)/1.65,0,1);
    this.set({
      id,
      score,
      state:p>=1.5?'failed':p>=0.9?'blocked':p>=0.65?'degraded':'healthy',
      critical,
      message:p>=0.65?'pressure threshold exceeded':null,
      details:freeze({pressure:p,...details}),
    });
  }

  public evaluate():RuntimeHealthReportV18{
    const signals=[...this.#signals.values()].sort((a,b)=>a.id.localeCompare(b.id));
    const criticalFailures=signals.filter(s=>s.critical&&s.state==='failed').map(s=>s.id);
    const degradedSignals=signals.filter(s=>s.state==='degraded'||s.state==='blocked').map(s=>s.id);
    const score=signals.length===0?1:signals.reduce((sum,s)=>sum+s.score,0)/signals.length;
    const readyRatio=signals.length===0?1:signals.filter(s=>s.state==='healthy').length/signals.length;

    let state:RuntimeHealthStateV18='healthy';
    const blockedReadyRatio = this.#minimumReadyRatio * 0.70;
    if(criticalFailures.length>0)state='failed';
    else if(readyRatio<blockedReadyRatio||score<0.5)state='blocked';
    else if(readyRatio<this.#minimumReadyRatio||degradedSignals.length>0||score<this.#minimumHealthyScore)state='degraded';

    return freeze({
      revision:this.#revision,
      timestampMs:this.#clock(),
      state,
      score,
      criticalFailures:freeze(criticalFailures),
      degradedSignals:freeze(degradedSignals),
      signals:freeze(signals),
    });
  }

  public snapshot():RuntimeHealthReportV18{
    return this.evaluate();
  }

  public clear():void{
    this.#signals.clear();
    this.#revision+=1;
  }
}