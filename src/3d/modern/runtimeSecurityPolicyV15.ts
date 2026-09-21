/** Centralized hostile-input policy for command, payload and network boundaries. */
export interface SecurityPolicyV15{readonly maxStringLength:number;readonly maxArrayLength:number;readonly maxObjectKeys:number;readonly maxPayloadBytes:number;readonly maxCommandsPerTick:number;readonly maxNetworkEntities:number;readonly maxSnapshotAgeTicks:number;readonly allowProtocols:readonly string[];}
export interface SecurityAuditV15{readonly accepted:boolean;readonly score:number;readonly reasons:readonly string[];readonly sanitized:string[];}

export const DEFAULT_SECURITY_POLICY_V15:SecurityPolicyV15=Object.freeze({maxStringLength:512,maxArrayLength:4096,maxObjectKeys:4096,maxPayloadBytes:256*1024,maxCommandsPerTick:256,maxNetworkEntities:10000,maxSnapshotAgeTicks:180,allowProtocols:['https:','http:','blob:','data:']});

const text=(value:unknown,max:number)=>String(value??'').slice(0,Math.max(1,Math.trunc(max)));
const bytes=(value:unknown)=>{try{return new TextEncoder().encode(JSON.stringify(value)).byteLength;}catch{return Number.MAX_SAFE_INTEGER;}};

export class RuntimeSecurityPolicyV15{
  readonly #policy:SecurityPolicyV15;
  constructor(policy:Partial<SecurityPolicyV15>={}){this.#policy=Object.freeze({...DEFAULT_SECURITY_POLICY_V15,...policy,allowProtocols:Object.freeze([...(policy.allowProtocols??DEFAULT_SECURITY_POLICY_V15.allowProtocols)])});}
  get policy():SecurityPolicyV15{return this.#policy;}

  auditPayload(payload:unknown):SecurityAuditV15{
    const reasons:string[]=[];const sanitized:string[]=[];const size=bytes(payload);
    if(size>this.#policy.maxPayloadBytes)reasons.push('PAYLOAD_BYTES');
    if(typeof payload==='string'&&payload.length>this.#policy.maxStringLength)reasons.push('STRING_LENGTH');
    if(Array.isArray(payload)&&payload.length>this.#policy.maxArrayLength)reasons.push('ARRAY_LENGTH');
    if(payload&&typeof payload==='object'&&!Array.isArray(payload)){const keys=Object.keys(payload as Record<string,unknown>);if(keys.length>this.#policy.maxObjectKeys)reasons.push('OBJECT_KEYS');for(const key of keys)if(key.length>this.#policy.maxStringLength){reasons.push('OBJECT_KEY_LENGTH');break;}}
    return Object.freeze({accepted:reasons.length===0,score:Math.max(0,100-reasons.length*25),reasons:Object.freeze(reasons),sanitized:Object.freeze(sanitized)});
  }

  sanitizeString(value:unknown,max=this.#policy.maxStringLength):string{const result=text(value,max).replace(/[\u0000-\u001f\u007f]/g,'');return result;}
  sanitizeId(value:unknown,max=96):string{return this.sanitizeString(value,max).replace(/[^a-zA-Z0-9._:-]/g,'_');}
  validateUrl(value:unknown):boolean{try{const url=new URL(String(value));return this.#policy.allowProtocols.includes(url.protocol);}catch{return false;}}
  validateCommandCount(count:number):boolean{return Number.isFinite(count)&&Math.trunc(count)>=0&&Math.trunc(count)<=this.#policy.maxCommandsPerTick;}
  validateEntityCount(count:number):boolean{return Number.isFinite(count)&&Math.trunc(count)>=0&&Math.trunc(count)<=this.#policy.maxNetworkEntities;}
  validateSnapshotAge(snapshotTick:number,currentTick:number):boolean{return Math.max(0,Math.trunc(currentTick)-Math.trunc(snapshotTick))<=this.#policy.maxSnapshotAgeTicks;}
  rateLimit(count:number,limit:number):boolean{return Math.max(0,Math.trunc(count))<=Math.max(0,Math.trunc(limit));}
  cloneSafe<T>(value:T):T{const serialized=JSON.stringify(value);if(bytes(value)>this.#policy.maxPayloadBytes)throw new Error('Payload exceeds security policy.');return JSON.parse(serialized) as T;}
}

export const securityScoreV15=(audits:readonly SecurityAuditV15[]):number=>{if(!audits.length)return 100;return Number((audits.reduce((sum,a)=>sum+a.score,0)/audits.length).toFixed(2));};
