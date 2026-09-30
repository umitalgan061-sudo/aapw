import {RuntimeError,stableHash} from './contracts.ts';

export interface RateLimitDecision{readonly allowed:boolean;readonly remaining:number;readonly resetTick:number;readonly reason?:string;}
export interface RateLimiterOptions{readonly capacity:number;readonly refillPerTick:number;}
interface Bucket{tokens:number;lastTick:number;}

export class DeterministicRateLimiter{
  readonly #options:RateLimiterOptions;readonly #buckets=new Map<string,Bucket>();
  constructor(options:RateLimiterOptions){
    if(options.capacity<=0||options.refillPerTick<=0)throw new RuntimeError({code:'R32_RATE_LIMIT_OPTIONS',message:'Rate limiter configuration is invalid',recoverable:false});
    this.#options=options;
  }
  consume(key:string,tick:number,cost=1):RateLimitDecision{
    if(!Number.isFinite(tick)||cost<=0)return{allowed:false,remaining:0,resetTick:tick+1,reason:'invalid-input'};
    const bucket=this.#buckets.get(key)??{tokens:this.#options.capacity,lastTick:tick};
    const elapsed=Math.max(0,tick-bucket.lastTick);
    bucket.tokens=Math.min(this.#options.capacity,bucket.tokens+elapsed*this.#options.refillPerTick);
    bucket.lastTick=tick;
    if(cost>this.#options.capacity)return{allowed:false,remaining:Math.floor(bucket.tokens),resetTick:tick+1,reason:'cost-exceeds-capacity'};
    if(bucket.tokens<cost){
      const wait=Math.max(1,Math.ceil((cost-bucket.tokens)/this.#options.refillPerTick));
      this.#buckets.set(key,bucket);
      return{allowed:false,remaining:Math.floor(bucket.tokens),resetTick:tick+wait,reason:'rate-limit'};
    }
    bucket.tokens-=cost;this.#buckets.set(key,bucket);
    return{allowed:true,remaining:Math.floor(bucket.tokens),resetTick:tick+Math.max(1,Math.ceil((this.#options.capacity-bucket.tokens)/this.#options.refillPerTick))};
  }
  clear(key?:string):void{if(key===undefined)this.#buckets.clear();else this.#buckets.delete(key);}
  size():number{return this.#buckets.size;}
}

export interface PayloadRule{
  readonly path:string;readonly type:'string'|'number'|'boolean'|'array'|'object';readonly required?:boolean;
  readonly maxLength?:number;readonly minimum?:number;readonly maximum?:number;
}
export interface PayloadValidationReport{readonly valid:boolean;readonly errors:readonly string[];}

export class PayloadValidator{
  readonly #rules:readonly PayloadRule[];
  constructor(rules:readonly PayloadRule[]){this.#rules=rules;}
  validate(payload:unknown):PayloadValidationReport{
    const errors:string[]=[];
    for(const rule of this.#rules){
      const value=this.#read(payload,rule.path);
      if(value===undefined||value===null){if(rule.required)errors.push(rule.path+':required');continue;}
      if(this.#type(value)!==rule.type)errors.push(rule.path+':type');
      if(typeof value==='string'&&rule.maxLength!==undefined&&value.length>rule.maxLength)errors.push(rule.path+':length');
      if(typeof value==='number'){
        if(!Number.isFinite(value))errors.push(rule.path+':finite');
        if(rule.minimum!==undefined&&value<rule.minimum)errors.push(rule.path+':minimum');
        if(rule.maximum!==undefined&&value>rule.maximum)errors.push(rule.path+':maximum');
      }
    }
    return{valid:errors.length===0,errors};
  }
  assert(payload:unknown):void{
    const report=this.validate(payload);
    if(!report.valid)throw new RuntimeError({code:'R32_PAYLOAD_INVALID',message:'Payload rejected: '+report.errors.join(', '),recoverable:false});
  }
  #read(root:unknown,path:string):unknown{
    let current=root;
    for(const part of path.split('.')){if(!current||typeof current!=='object')return undefined;current=(current as Record<string,unknown>)[part];}
    return current;
  }
  #type(value:unknown):PayloadRule['type']{
    if(Array.isArray(value))return'array';
    if(value!==null&&typeof value==='object')return'object';
    if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return value;
    return'object';
  }
}

export function sanitizeText(value:string,maxLength=256):string{
  return value.normalize('NFKC').replace(/[<>&"']/g,'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,maxLength);
}
export function sanitizeIdentifier(value:string,maxLength=96):string{
  return sanitizeText(value,maxLength).replace(/[^a-zA-Z0-9._:-]/g,'-');
}
export function assertSafeUrl(value:string,allowedProtocols:readonly string[]=['https:','http:']):string{
  const trimmed=value.trim();
  if(!trimmed)throw new RuntimeError({code:'R32_URL_EMPTY',message:'URL cannot be empty',recoverable:false});
  if(trimmed.startsWith('/'))return trimmed;
  if(/^javascript:|^vbscript:|^data:text\/html/i.test(trimmed))throw new RuntimeError({code:'R32_URL_UNSAFE',message:'Unsafe URL protocol',recoverable:false});
  let parsed:URL;
  try{parsed=new URL(trimmed);}catch{throw new RuntimeError({code:'R32_URL_INVALID',message:'Invalid URL',recoverable:false});}
  if(!allowedProtocols.includes(parsed.protocol))throw new RuntimeError({code:'R32_URL_PROTOCOL',message:'URL protocol not allowed',recoverable:false});
  return parsed.toString();
}

export interface CapabilityToken{
  readonly subject:string;readonly capability:string;readonly issuedTick:number;readonly expiresTick:number;readonly signature:string;
}
export function createCapabilityAuthority(secret:string){
  if(!secret)throw new RuntimeError({code:'R32_CAPABILITY_SECRET',message:'Capability secret cannot be empty',recoverable:false});
  const issue=(subject:string,capability:string,tick:number,ttlTicks:number):CapabilityToken=>{
    const expires=tick+Math.max(1,Math.floor(ttlTicks));
    return{subject,capability,issuedTick:tick,expiresTick:expires,signature:stableHash({secret,subject,capability,tick,expires})};
  };
  const verify=(token:CapabilityToken,subject:string,capability:string,tick:number):boolean=>{
    return token.subject===subject&&token.capability===capability&&tick>=token.issuedTick&&tick<=token.expiresTick&&token.signature===stableHash({secret,subject,capability,tick:token.issuedTick,expires:token.expiresTick});
  };
  return{issue,verify};
}

export interface AuditEntry{
  readonly tick:number;readonly action:string;readonly subject:string;readonly allowed:boolean;readonly reason?:string;readonly fingerprint:string;
}
export class SecurityAuditLog{
  readonly #limit:number;readonly #entries:AuditEntry[]=[];
  constructor(limit=512){this.#limit=Math.max(1,Math.floor(limit));}
  record(entry:Omit<AuditEntry,'fingerprint'>):void{
    this.#entries.push({...entry,fingerprint:stableHash(entry)});
    while(this.#entries.length>this.#limit)this.#entries.shift();
  }
  entries():readonly AuditEntry[]{return this.#entries.slice();}
  failures():readonly AuditEntry[]{return this.#entries.filter(e=>!e.allowed);}
  clear():void{this.#entries.length=0;}
}
