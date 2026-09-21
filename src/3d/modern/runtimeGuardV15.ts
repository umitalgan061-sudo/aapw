/** Runtime guard: invariants, circuit breakers, command-rate limits and recovery actions. */
export type GuardSeverityV15='info'|'warning'|'critical';
export type BreakerStateV15='closed'|'open'|'half-open';
export interface GuardObservationV15{readonly frameMs:number;readonly simulationTick:number;readonly memoryMb?:number;readonly residentBytes?:number;readonly networkRttMs?:number;readonly packetLoss?:number;readonly entities?:number;readonly commands?:number;readonly digest?:string;}
export interface GuardRuleV15{readonly id:string;readonly severity:GuardSeverityV15;readonly description:string;readonly test:(observation:GuardObservationV15)=>boolean;readonly cooldownFrames?:number;readonly critical?:boolean;}
export interface GuardFindingV15{readonly ruleId:string;readonly severity:GuardSeverityV15;readonly description:string;readonly frame:number;readonly value?:number;readonly limit?:number;}
export interface CircuitBreakerV15{readonly id:string;readonly state:BreakerStateV15;readonly failures:number;readonly successes:number;readonly openedAtFrame?:number;readonly cooldownFrames:number;}
export interface GuardDecisionV15{readonly healthy:boolean;readonly score:number;readonly findings:readonly GuardFindingV15[];readonly openBreakers:readonly string[];readonly actions:readonly string[];}
export interface GuardOptionsV15{readonly maxFindings?:number;readonly failureWindowFrames?:number;readonly breakerThreshold?:number;readonly breakerCooldownFrames?:number;readonly now?:()=>number;}

const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,Number.isFinite(value)?value:min));

interface BreakerInternal{state:BreakerStateV15;failures:number;successes:number;openedAtFrame:number;cooldownFrames:number;}

export class RuntimeGuardV15{
  readonly #rules=new Map<string,GuardRuleV15>();
  readonly #breakers=new Map<string,BreakerInternal>();
  readonly #history:GuardFindingV15[]=[];
  readonly #maxFindings:number;
  readonly #failureWindow:number;
  readonly #breakerThreshold:number;
  readonly #defaultCooldown:number;
  readonly #now:()=>number;
  #frame=0;
  #criticalFailures=0;

  constructor(options:GuardOptionsV15={}){this.#maxFindings=Math.max(32,Math.trunc(options.maxFindings??512));this.#failureWindow=Math.max(30,Math.trunc(options.failureWindowFrames??300));this.#breakerThreshold=Math.max(1,Math.trunc(options.breakerThreshold??3));this.#defaultCooldown=Math.max(1,Math.trunc(options.breakerCooldownFrames??120));this.#now=options.now??(()=>Date.now());}

  addRule(rule:GuardRuleV15):()=>void{if(this.#rules.has(rule.id))throw new Error('Guard rule already exists: '+rule.id);this.#rules.set(rule.id,Object.freeze({...rule,cooldownFrames:Math.max(1,Math.trunc(rule.cooldownFrames??30))}));return()=>{if(this.#rules.get(rule.id)===rule)this.#rules.delete(rule.id);};}
  removeRule(id:string):boolean{return this.#rules.delete(id);}
  rules():readonly GuardRuleV15[]{return Object.freeze([...this.#rules.values()]);}

  registerBreaker(id:string,cooldownFrames=this.#defaultCooldown):void{if(!this.#breakers.has(id))this.#breakers.set(id,{state:'closed',failures:0,successes:0,openedAtFrame:-1,cooldownFrames:Math.max(1,Math.trunc(cooldownFrames))});}
  breaker(id:string):CircuitBreakerV15|undefined{const b=this.#breakers.get(id);if(!b)return undefined;return Object.freeze({...b,openedAtFrame:b.openedAtFrame>=0?b.openedAtFrame:undefined});}

  evaluate(observation:GuardObservationV15):GuardDecisionV15{
    this.#frame=Math.max(this.#frame+1,Math.trunc(observation.simulationTick));
    const findings:GuardFindingV15[]=[];const actions:string[]=[];
    for(const rule of this.#rules.values()){
      let violated=false;try{violated=!rule.test(observation);}catch{violated=true;}
      if(!violated)continue;
      const finding=Object.freeze({ruleId:rule.id,severity:rule.severity,description:rule.description,frame:this.#frame});
      findings.push(finding);this.#history.push(finding);if(rule.severity==='critical')this.#criticalFailures+=1;
      if(rule.critical){this.openBreaker(rule.id);actions.push('OPEN_BREAKER:'+rule.id);}else actions.push('DEGRADE:'+rule.id);
      if(findings.length>=this.#maxFindings)break;
    }
    this.#trimHistory();
    const openBreakers=this.#advanceBreakers();
    const critical=findings.filter((item)=>item.severity==='critical').length;
    const warnings=findings.filter((item)=>item.severity==='warning').length;
    const score=clamp(100-critical*30-warnings*8-findings.filter((item)=>item.severity==='info').length*1,0,100);
    return Object.freeze({healthy:findings.length===0&&openBreakers.length===0,score,findings:Object.freeze(findings),openBreakers:Object.freeze(openBreakers),actions:Object.freeze([...new Set(actions)])});
  }

  openBreaker(id:string):boolean{this.registerBreaker(id);const b=this.#breakers.get(id)!;b.failures+=1;b.openedAtFrame=this.#frame;if(b.failures>=this.#breakerThreshold){b.state='open';return true;}if(b.state==='closed')b.state='half-open';return false;}
  allow(id:string):boolean{const b=this.#breakers.get(id);if(!b)return true;if(b.state==='closed')return true;if(b.state==='open'){if(this.#frame-b.openedAtFrame>=b.cooldownFrames){b.state='half-open';return true;}return false;}return true;}
  success(id:string):void{const b=this.#breakers.get(id);if(!b)return;b.successes+=1;if(b.state==='half-open'){b.state='closed';b.failures=0;}}
  failure(id:string):void{this.openBreaker(id);}
  resetBreaker(id:string):void{const b=this.#breakers.get(id);if(!b)return;b.state='closed';b.failures=0;b.successes=0;b.openedAtFrame=-1;}

  rateLimit(count:number,limit:number):boolean{return Math.max(0,Math.trunc(count))<=Math.max(0,Math.trunc(limit));}
  assert(condition:boolean,message:string):void{if(!condition)throw new Error('Runtime invariant violated: '+message);}
  history():readonly GuardFindingV15[]{return Object.freeze([...this.#history]);}
  criticalFailureCount():number{return this.#criticalFailures;}
  reset():void{this.#history.length=0;this.#criticalFailures=0;this.#frame=0;for(const b of this.#breakers.values()){b.state='closed';b.failures=0;b.successes=0;b.openedAtFrame=-1;}}

  installDefaultRules():void{
    this.addRule({id:'frame-time',severity:'warning',description:'Frame time exceeds 50ms.',test:(o)=>o.frameMs<=50});
    this.addRule({id:'frame-time-critical',severity:'critical',description:'Frame time exceeds 100ms.',test:(o)=>o.frameMs<=100,critical:true});
    this.addRule({id:'memory',severity:'warning',description:'JavaScript memory exceeds 1400MB.',test:(o)=>o.memoryMb===undefined||o.memoryMb<=1400});
    this.addRule({id:'packet-loss',severity:'warning',description:'Packet loss exceeds 10%.',test:(o)=>o.packetLoss===undefined||o.packetLoss<=0.1});
    this.addRule({id:'network-rtt',severity:'warning',description:'Network RTT exceeds 500ms.',test:(o)=>o.networkRttMs===undefined||o.networkRttMs<=500});
    this.addRule({id:'entity-cap',severity:'critical',description:'Visible entity count exceeds hard safety cap.',test:(o)=>o.entities===undefined||o.entities<=20000,critical:true});
    this.addRule({id:'command-cap',severity:'critical',description:'Command volume exceeds hard frame cap.',test:(o)=>o.commands===undefined||o.commands<=1024,critical:true});
  }

  #trimHistory():void{const cutoff=this.#frame-this.#failureWindow;while(this.#history.length&&this.#history[0]!.frame<cutoff)this.#history.shift();}
  #advanceBreakers():string[]{const open:string[]=[];for(const [id,b] of this.#breakers){if(b.state==='open'&&this.#frame-b.openedAtFrame<b.cooldownFrames)open.push(id);else if(b.state==='open')b.state='half-open';if(b.state==='open')open.push(id);}return [...new Set(open)];}
}

export const guardScoreBandV15=(score:number):'healthy'|'watch'|'degraded'|'critical'=>score>=90?'healthy':score>=75?'watch':score>=50?'degraded':'critical';
