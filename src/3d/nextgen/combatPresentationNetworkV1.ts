/** Network-safe presentation packet adapter. Remote packets never mutate authoritative combat state. */
import type { CombatEvent, DamageType } from './combatSimulation';
import type { CombatPresentationCue } from './combatPresentationV1';
import { deterministicHash, type Vec3 } from './deterministicMath';

export interface CombatPresentationNetworkPacket {
  readonly version: 1;
  readonly tick: number;
  readonly sequence: number;
  readonly type: CombatEvent['type'];
  readonly sourceId: number;
  readonly targetId: number | null;
  readonly attackId: string | null;
  readonly damageType: DamageType | null;
  readonly intensity: number;
  readonly position: Readonly<Vec3>;
  readonly direction: Readonly<Vec3>;
  readonly flags: Readonly<{ blocked: boolean; critical: boolean; death: boolean; stagger: boolean; dodge: boolean }>;
  readonly digest: number;
}
export interface CombatPresentationNetworkContext { readonly maxAgeTicks?: number; readonly maxFutureTicks?: number; readonly maxPackets?: number; readonly localTick: number; }
export interface CombatPresentationNetworkAudit { readonly valid: boolean; readonly errors: readonly string[]; readonly warnings: readonly string[]; readonly accepted: number; readonly dropped: number; }

const TYPES = new Set<CombatEvent['type']>(['attack-start','hit','blocked','critical','stagger','death','dodge']);
const DAMAGE_TYPES = new Set<DamageType>(['slash','pierce','blunt','fire','frost','arcane']);
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;
const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,finite(v,min)));

export function buildCombatPresentationNetworkPacket(cue: CombatPresentationCue, sequence: number): CombatPresentationNetworkPacket {
  const flags=Object.freeze({blocked:cue.blocked,critical:cue.critical,death:cue.semantic==='death',stagger:cue.semantic==='stagger',dodge:cue.semantic==='dodge'});
  const digest=deterministicHash([cue.tick,sequence,cue.sourceId,cue.targetId??0,cue.fingerprint,Math.round(cue.intensity*1000)]);
  return Object.freeze({version:1 as const,tick:cue.tick,sequence:Math.max(0,Math.floor(sequence)),type:cue.semantic==='impact'?'hit':cue.semantic==='blocked-impact'?'blocked':cue.semantic==='critical-impact'?'critical':cue.semantic==='stagger'?'stagger':cue.semantic==='death'?'death':cue.semantic==='dodge'?'dodge':'attack-start',sourceId:cue.sourceId,targetId:cue.targetId??null,attackId:null,damageType:(DAMAGE_TYPES.has(cue.damageType as DamageType)?cue.damageType as DamageType:null),intensity:clamp(cue.intensity),position:Object.freeze({...cue.position}),direction:Object.freeze({...cue.direction}),flags,digest});
}

export function validateCombatPresentationNetworkPacket(packet: CombatPresentationNetworkPacket, context: CombatPresentationNetworkContext): Readonly<{ valid:boolean; errors:readonly string[]; warnings:readonly string[] }> {
  const errors:string[]=[];const warnings:string[]=[];
  if(packet.version!==1)errors.push('unsupported network presentation version');
  if(!Number.isInteger(packet.tick)||packet.tick<0)errors.push('invalid packet tick');
  if(!Number.isInteger(packet.sequence)||packet.sequence<0)errors.push('invalid packet sequence');
  if(!TYPES.has(packet.type))errors.push('unsupported presentation event type');
  if(packet.targetId!==null&&!Number.isInteger(packet.targetId))errors.push('invalid target id');
  if(packet.damageType!==null&&!DAMAGE_TYPES.has(packet.damageType))errors.push('unsupported damage type');
  if(!Number.isFinite(packet.intensity)||packet.intensity<0||packet.intensity>1)errors.push('intensity out of range');
  if(![packet.position.x,packet.position.y,packet.position.z,packet.direction.x,packet.direction.y,packet.direction.z].every(Number.isFinite))errors.push('non-finite presentation vector');
  const maxAge=Math.max(0,Math.floor(context.maxAgeTicks??8));const maxFuture=Math.max(0,Math.floor(context.maxFutureTicks??2));
  if(packet.tick<context.localTick-maxAge)errors.push('packet too old');
  if(packet.tick>context.localTick+maxFuture)errors.push('packet too far in future');
  if(packet.sequence>0&&packet.sequence>Number.MAX_SAFE_INTEGER)errors.push('packet sequence exceeds safe integer');
  if(packet.type==='death'&&!packet.flags.death)warnings.push('death semantic flag mismatch');
  if(packet.type==='critical'&&!packet.flags.critical)warnings.push('critical semantic flag mismatch');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors),warnings:Object.freeze(warnings)});
}

export function encodeCombatPresentationNetworkPacket(packet:CombatPresentationNetworkPacket):string{return JSON.stringify(packet);}
export function decodeCombatPresentationNetworkPacket(payload:string):CombatPresentationNetworkPacket{
  const parsed=JSON.parse(payload) as CombatPresentationNetworkPacket;
  if(!parsed||typeof parsed!=='object')throw new TypeError('presentation packet must be an object');
  return Object.freeze(parsed);
}

export function buildCombatPresentationNetworkAudit(packets:readonly CombatPresentationNetworkPacket[],context:CombatPresentationNetworkContext):CombatPresentationNetworkAudit{
  const errors:string[]=[];const warnings:string[]=[];let accepted=0;let dropped=0;const seen=new Set<number>();
  const ordered=[...packets].sort((a,b)=>a.tick-b.tick||a.sequence-b.sequence);const maxPackets=Math.max(1,Math.floor(context.maxPackets??64));
  for(const packet of ordered){const report=validateCombatPresentationNetworkPacket(packet,context);if(seen.has(packet.sequence)){dropped+=1;warnings.push('duplicate sequence '+packet.sequence);continue;}seen.add(packet.sequence);if(!report.valid){dropped+=1;errors.push(...report.errors);continue;}if(accepted>=maxPackets){dropped+=1;warnings.push('packet budget exceeded');continue;}accepted+=1;warnings.push(...report.warnings);}
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors),warnings:Object.freeze(warnings),accepted,dropped}) as unknown as CombatPresentationNetworkAudit;
}

export function sortAndDedupeCombatPresentationPackets(packets:readonly CombatPresentationNetworkPacket[]):readonly CombatPresentationNetworkPacket[]{
  const bySequence=new Map<number,CombatPresentationNetworkPacket>();
  for(const packet of packets)if(!bySequence.has(packet.sequence))bySequence.set(packet.sequence,packet);
  return Object.freeze([...bySequence.values()].sort((a,b)=>a.tick-b.tick||a.sequence-b.sequence));
}