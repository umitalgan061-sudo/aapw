/** Strict configuration validator: rejects impossible budgets before runtime boot. */
export interface RuntimeConfigV15{readonly fixedStepMs:number;readonly maxCatchUpSteps:number;readonly frameBudgetMs:number;readonly maxEntities:number;readonly maxDrawCalls:number;readonly maxTextureBytes:number;readonly maxNetworkBytes:number;readonly autosaveIntervalMs:number;readonly replayHistoryTicks:number;readonly workerConcurrency:number;readonly featureFlags:Readonly<Record<string,boolean>>;}
export interface ConfigIssueV15{readonly code:'FIXED_STEP'|'CATCHUP'|'FRAME_BUDGET'|'ENTITY_CAP'|'DRAW_CAP'|'TEXTURE_BUDGET'|'NETWORK_BUDGET'|'AUTOSAVE'|'REPLAY_HISTORY'|'WORKERS'|'FLAG_KEY';readonly field:string;readonly message:string;}
export interface ConfigValidationV15{readonly valid:boolean;readonly issues:readonly ConfigIssueV15[];readonly normalized:RuntimeConfigV15;}

const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,Number.isFinite(v)?v:a));

const defaults:RuntimeConfigV15=Object.freeze({fixedStepMs:16.6667,maxCatchUpSteps:8,frameBudgetMs:16.67,maxEntities:6000,maxDrawCalls:2200,maxTextureBytes:1024*1024*1024,maxNetworkBytes:512*1024,maxAutosave:30000,autosaveIntervalMs:30000,replayHistoryTicks:600,workerConcurrency:4,featureFlags:{}} as RuntimeConfigV15);

export class RuntimeConfigValidatorV15{
  validate(input:Partial<RuntimeConfigV15>={}):ConfigValidationV15{
    const normalized:RuntimeConfigV15=Object.freeze({
      fixedStepMs:clamp(input.fixedStepMs??defaults.fixedStepMs,4,100),
      maxCatchUpSteps:Math.round(clamp(input.maxCatchUpSteps??defaults.maxCatchUpSteps,1,60)),
      frameBudgetMs:clamp(input.frameBudgetMs??defaults.frameBudgetMs,.25,100),
      maxEntities:Math.round(clamp(input.maxEntities??defaults.maxEntities,100,500000)),
      maxDrawCalls:Math.round(clamp(input.maxDrawCalls??defaults.maxDrawCalls,100,50000)),
      maxTextureBytes:Math.round(clamp(input.maxTextureBytes??defaults.maxTextureBytes,16*1024*1024,8*1024*1024*1024)),
      maxNetworkBytes:Math.round(clamp(input.maxNetworkBytes??defaults.maxNetworkBytes,4096,16*1024*1024)),
      autosaveIntervalMs:Math.round(clamp(input.autosaveIntervalMs??defaults.autosaveIntervalMs,1000,3600_000)),
      replayHistoryTicks:Math.round(clamp(input.replayHistoryTicks??defaults.replayHistoryTicks,30,100000)),
      workerConcurrency:Math.round(clamp(input.workerConcurrency??defaults.workerConcurrency,1,64)),
      featureFlags:Object.freeze({...input.featureFlags}),
    });
    const issues:ConfigIssueV15[]=[];
    if(normalized.fixedStepMs>normalized.frameBudgetMs*2)issues.push({code:'FIXED_STEP',field:'fixedStepMs',message:'Fixed step cannot exceed twice the frame budget.'});
    if(normalized.maxCatchUpSteps*normalized.fixedStepMs>500)issues.push({code:'CATCHUP',field:'maxCatchUpSteps',message:'Catch-up window must remain bounded.'});
    if(normalized.frameBudgetMs<4)issues.push({code:'FRAME_BUDGET',field:'frameBudgetMs',message:'Frame budget below 4ms is unsupported for the browser runtime.'});
    if(normalized.maxEntities>100000)issues.push({code:'ENTITY_CAP',field:'maxEntities',message:'Entity cap exceeds configured safety ceiling.'});
    if(normalized.maxDrawCalls>20000)issues.push({code:'DRAW_CAP',field:'maxDrawCalls',message:'Draw-call cap exceeds configured safety ceiling.'});
    if(normalized.maxTextureBytes>4*1024*1024*1024)issues.push({code:'TEXTURE_BUDGET',field:'maxTextureBytes',message:'Texture budget exceeds 4GiB.'});
    if(normalized.maxNetworkBytes>4*1024*1024)issues.push({code:'NETWORK_BUDGET',field:'maxNetworkBytes',message:'Network snapshot budget exceeds 4MiB.'});
    if(normalized.autosaveIntervalMs<5000)issues.push({code:'AUTOSAVE',field:'autosaveIntervalMs',message:'Autosave interval is too aggressive.'});
    if(normalized.replayHistoryTicks<60)issues.push({code:'REPLAY_HISTORY',field:'replayHistoryTicks',message:'Replay history must cover at least one second at 60Hz.'});
    if(normalized.workerConcurrency>32)issues.push({code:'WORKERS',field:'workerConcurrency',message:'Worker concurrency above 32 is rejected.'});
    for(const key of Object.keys(normalized.featureFlags))if(!/^[a-zA-Z0-9._:-]{1,96}$/.test(key))issues.push({code:'FLAG_KEY',field:'featureFlags',message:'Feature flag key is invalid: '+key});
    return Object.freeze({valid:issues.length===0,issues:Object.freeze(issues),normalized});
  }

  assertValid(input:Partial<RuntimeConfigV15>={}):RuntimeConfigV15{const result=this.validate(input);if(!result.valid)throw new Error(result.issues.map((issue)=>issue.field+': '+issue.message).join(' | '));return result.normalized;}
  defaults():RuntimeConfigV15{return defaults;}
}

export const createSafeRuntimeConfigV15=(input:Partial<RuntimeConfigV15>={}):RuntimeConfigV15=>new RuntimeConfigValidatorV15().assertValid(input);
