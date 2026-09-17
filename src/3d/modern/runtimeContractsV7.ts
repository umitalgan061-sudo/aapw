/**
 * Runtime v7 contracts.
 *
 * v7 is a typed integration layer above the existing v3/v4/v6 runtime surfaces. It intentionally
 * contains no renderer objects, DOM state, ambient clocks or random sources. Each subsystem speaks
 * through immutable records so the browser presentation layer remains replaceable.
 */
export type BrandV7<T, B extends string> = T & { readonly __brand: B };
export type RuntimeIdV7 = BrandV7<string, 'RuntimeIdV7'>;
export type TickV7 = BrandV7<number, 'TickV7'>;
export type FrameV7 = BrandV7<number, 'FrameV7'>;
export type EntityIdV7 = BrandV7<number, 'EntityIdV7'>;
export type AssetIdV7 = BrandV7<string, 'AssetIdV7'>;
export type CommandIdV7 = BrandV7<string, 'CommandIdV7'>;
export type TraceIdV7 = BrandV7<string, 'TraceIdV7'>;
export type ChunkIdV7 = BrandV7<string, 'ChunkIdV7'>;
export type QuestIdV7 = BrandV7<string, 'QuestIdV7'>;
export type EncounterIdV7 = BrandV7<string, 'EncounterIdV7'>;

export const runtimeIdV7 = (value: string): RuntimeIdV7 => value as RuntimeIdV7;
export const tickV7 = (value: number): TickV7 => Math.max(0, Math.trunc(value)) as TickV7;
export const frameV7 = (value: number): FrameV7 => Math.max(0, Math.trunc(value)) as FrameV7;
export const entityIdV7 = (value: number): EntityIdV7 => Math.max(1, Math.trunc(value)) as EntityIdV7;
export const assetIdV7 = (value: string): AssetIdV7 => value as AssetIdV7;
export const commandIdV7 = (value: string): CommandIdV7 => value as CommandIdV7;
export const traceIdV7 = (value: string): TraceIdV7 => value as TraceIdV7;
export const chunkIdV7 = (value: string): ChunkIdV7 => value as ChunkIdV7;
export const questIdV7 = (value: string): QuestIdV7 => value as QuestIdV7;
export const encounterIdV7 = (value: string): EncounterIdV7 => value as EncounterIdV7;

export interface Vec3V7 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuatV7 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface TransformV7 {
  readonly position: Vec3V7;
  readonly rotation: QuatV7;
  readonly scale: Vec3V7;
}

export interface VelocityV7 {
  readonly linear: Vec3V7;
  readonly angular: Vec3V7;
  readonly maxSpeed: number;
}

export type RuntimeModeV7 = 'boot' | 'loading' | 'running' | 'paused' | 'recovering' | 'stopped' | 'failed';
export type InputModeV7 = 'gameplay' | 'menu' | 'photo' | 'debug' | 'cinematic';
export type QualityTierV7 = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
export type RuntimeSourceV7 = 'engine' | 'ui' | 'network' | 'save' | 'replay' | 'worker' | 'system';

export interface RuntimeBudgetV7 {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly networkBytes: number;
  readonly assetBytes: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleEntities: number;
  readonly simulationSteps: number;
}

export interface RuntimeUsageV7 extends RuntimeBudgetV7 {
  readonly frameMs: number;
  readonly activeEntities: number;
  readonly queuedAssets: number;
  readonly pendingCommands: number;
  readonly memoryBytes: number;
}

export interface RuntimeHealthV7 {
  readonly score: number;
  readonly stable: boolean;
  readonly degraded: boolean;
  readonly reasons: readonly string[];
}

export interface RuntimeIdentityV7 {
  readonly id: RuntimeIdV7;
  readonly build: string;
  readonly protocol: number;
  readonly startedAt: number;
}

export interface RuntimeCommandV7<TPayload = unknown> {
  readonly id: CommandIdV7;
  readonly trace: TraceIdV7;
  readonly tick: TickV7;
  readonly source: RuntimeSourceV7;
  readonly kind: string;
  readonly payload: TPayload;
  readonly issuedAt: number;
  readonly expiresAt: number | null;
}

export interface RuntimeEventV7<TPayload = unknown> {
  readonly sequence: number;
  readonly trace: TraceIdV7;
  readonly tick: TickV7;
  readonly source: RuntimeSourceV7;
  readonly type: string;
  readonly payload: TPayload;
}

export interface InputIntentV7 {
  readonly tick: TickV7;
  readonly source: 'keyboard' | 'pointer' | 'touch' | 'gamepad' | 'xr' | 'virtual' | 'network';
  readonly move: Vec3V7;
  readonly look: Vec3V7;
  readonly actions: readonly string[];
  readonly sequence: number;
}

export interface InputDecisionV7 {
  readonly accepted: boolean;
  readonly intent: InputIntentV7;
  readonly consumedActions: readonly string[];
  readonly reason: string;
}

export interface WorldCellV7 {
  readonly id: ChunkIdV7;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly tier: 'critical' | 'near' | 'mid' | 'far' | 'sleeping';
  readonly desired: boolean;
  readonly loaded: boolean;
  readonly resident: boolean;
  readonly bytes: number;
}

export interface StreamTicketV7 {
  readonly id: string;
  readonly chunk: ChunkIdV7;
  readonly priority: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly generation: number;
}

export interface NetworkStateV7 {
  readonly peerId: string;
  readonly revision: number;
  readonly tick: TickV7;
  readonly acknowledgedTick: TickV7;
  readonly estimatedRttMs: number;
  readonly packetLoss: number;
  readonly interpolationDelayMs: number;
}

export interface ReplicationFieldV7<T = unknown> {
  readonly name: string;
  readonly value: T;
  readonly quantization?: number;
}

export interface ReplicationDeltaV7 {
  readonly entity: EntityIdV7;
  readonly baseRevision: number;
  readonly revision: number;
  readonly tick: TickV7;
  readonly fields: readonly ReplicationFieldV7[];
  readonly checksum: string;
}

export interface CombatantV7 {
  readonly id: EntityIdV7;
  readonly team: number;
  readonly transform: TransformV7;
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly guard: number;
  readonly alive: boolean;
}

export type DamageKindV7 = 'physical' | 'fire' | 'ice' | 'shock' | 'poison' | 'true';

export interface DamageRequestV7 {
  readonly attacker: EntityIdV7;
  readonly defender: EntityIdV7;
  readonly amount: number;
  readonly kind: DamageKindV7;
  readonly hitTick: TickV7;
  readonly hitPoint: Vec3V7;
  readonly critical: boolean;
  readonly source: RuntimeSourceV7;
}

export interface DamageResultV7 {
  readonly accepted: boolean;
  readonly blocked: boolean;
  readonly amountApplied: number;
  readonly remainingHealth: number;
  readonly defeated: boolean;
  readonly stagger: number;
  readonly trace: TraceIdV7;
}

export interface EncounterDefinitionV7 {
  readonly id: EncounterIdV7;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly radius: number;
  readonly cooldownTicks: number;
  readonly maxParticipants: number;
  readonly rewards: readonly string[];
  readonly tags: readonly string[];
}

export interface EncounterStateV7 {
  readonly definition: EncounterDefinitionV7;
  readonly spawnedAt: TickV7 | null;
  readonly participantIds: readonly EntityIdV7[];
  readonly completed: boolean;
  readonly cooldownUntil: TickV7;
}

export type QuestObjectiveKindV7 = 'reach' | 'collect' | 'defeat' | 'interact' | 'survive' | 'escort' | 'inspect';

export interface QuestObjectiveV7 {
  readonly id: string;
  readonly kind: QuestObjectiveKindV7;
  readonly target: string;
  readonly required: number;
  readonly optional: boolean;
}

export interface QuestDefinitionV7 {
  readonly id: QuestIdV7;
  readonly title: string;
  readonly objectives: readonly QuestObjectiveV7[];
  readonly prerequisites: readonly QuestIdV7[];
  readonly rewards: readonly string[];
}

export interface QuestProgressV7 {
  readonly id: QuestIdV7;
  readonly accepted: boolean;
  readonly completed: boolean;
  readonly failed: boolean;
  readonly progress: Readonly<Record<string, number>>;
}

export interface RenderItemV7 {
  readonly entity: EntityIdV7;
  readonly transform: TransformV7;
  readonly materialKey: string;
  readonly geometryKey: string;
  readonly layer: number;
  readonly visible: boolean;
  readonly distance: number;
}

export interface RenderViewV7 {
  readonly position: Vec3V7;
  readonly forward: Vec3V7;
  readonly near: number;
  readonly far: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly renderScale: number;
}

export interface RenderPacketV7 {
  readonly frame: FrameV7;
  readonly tick: TickV7;
  readonly tier: QualityTierV7;
  readonly items: readonly RenderItemV7[];
  readonly culled: number;
  readonly instanced: number;
  readonly batches: number;
  readonly checksum: string;
}

export interface SnapshotV7<TState = unknown> {
  readonly runtime: RuntimeIdV7;
  readonly tick: TickV7;
  readonly frame: FrameV7;
  readonly phase: RuntimeModeV7;
  readonly inputMode: InputModeV7;
  readonly quality: QualityTierV7;
  readonly state: TState;
  readonly checksum: string;
}

export interface RuntimeDiagnosticsV7 {
  readonly identity: RuntimeIdentityV7;
  readonly phase: RuntimeModeV7;
  readonly tick: TickV7;
  readonly frame: FrameV7;
  readonly health: RuntimeHealthV7;
  readonly usage: RuntimeUsageV7;
  readonly activeCells: number;
  readonly loadedAssets: number;
  readonly peers: number;
  readonly quests: number;
  readonly encounters: number;
  readonly recentErrors: readonly string[];
}

export interface OutcomeV7<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable: boolean };
}

export const okV7 = <T>(value: T): OutcomeV7<T> => Object.freeze({ ok: true, value });
export const failV7 = <T = never>(code: string, message: string, retryable = false): OutcomeV7<T> =>
  Object.freeze({ ok: false, error: Object.freeze({ code, message, retryable }) });

export const zeroVec3V7 = (): Vec3V7 => Object.freeze({ x: 0, y: 0, z: 0 });
export const unitQuatV7 = (): QuatV7 => Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const identityTransformV7 = (): TransformV7 =>
  Object.freeze({ position: zeroVec3V7(), rotation: unitQuatV7(), scale: Object.freeze({ x: 1, y: 1, z: 1 }) });

export function distanceSqV7(a: Vec3V7, b: Vec3V7): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

export function finiteVec3V7(value: Vec3V7): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function clampV7(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function checksumV7(value: unknown): string {
  const text = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second ^ (second >>> 16), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
