/**
 * R27 platform contracts.
 *
 * The R27 layer is deliberately engine-agnostic: rendering, networking and persistence
 * consume these contracts rather than reaching into browser globals. This makes the
 * simulation deterministic, testable and portable to workers or a server later.
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type EntityId = Brand<number, 'EntityId'>;
export type ComponentType = Brand<string, 'ComponentType'>;
export type SystemId = Brand<string, 'SystemId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type ItemId = Brand<string, 'ItemId'>;
export type DialogueNodeId = Brand<string, 'DialogueNodeId'>;
export type SaveSlotId = Brand<string, 'SaveSlotId'>;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Sphere {
  readonly center: Vec3;
  readonly radius: number;
}

export interface Capsule {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly radius: number;
}

export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly maxDistance: number;
}

export type RuntimePhase =
  | 'input'
  | 'simulation'
  | 'physics'
  | 'ai'
  | 'gameplay'
  | 'network'
  | 'presentation'
  | 'persistence'
  | 'observability';

export interface RuntimeTick {
  readonly index: number;
  readonly dtSeconds: number;
  readonly simulationTimeSeconds: number;
}

export interface InputFrame {
  readonly tick: number;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly buttons: readonly string[];
  readonly analog: Readonly<Record<string, number>>;
}

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface Velocity {
  readonly linear: Vec3;
  readonly angular: Vec3;
}

export interface RuntimeBudget {
  readonly maxSystems: number;
  readonly maxCommands: number;
  readonly maxAiDecisions: number;
  readonly maxNetworkBytes: number;
  readonly maxAssetOperations: number;
}

export interface SystemContext {
  readonly tick: RuntimeTick;
  readonly budget: RuntimeBudget;
  readonly input: InputFrame | null;
  readonly publish: (event: RuntimeEvent) => void;
  readonly metrics: SystemMetricSink;
}

export interface SystemMetricSink {
  begin(name: string): void;
  end(name: string, units?: number): void;
  increment(name: string, delta?: number): void;
}

export interface ScheduledSystem {
  readonly id: SystemId;
  readonly phase: RuntimePhase;
  readonly order: number;
  readonly before?: readonly SystemId[];
  readonly after?: readonly SystemId[];
  readonly enabled?: boolean;
  run(context: SystemContext): void;
}

export type RuntimeEvent =
  | { readonly type: 'entity-created'; readonly entity: EntityId }
  | { readonly type: 'entity-destroyed'; readonly entity: EntityId }
  | { readonly type: 'damage'; readonly source: EntityId; readonly target: EntityId; readonly amount: number }
  | { readonly type: 'item-changed'; readonly entity: EntityId; readonly item: ItemId; readonly quantity: number }
  | { readonly type: 'dialogue-choice'; readonly entity: EntityId; readonly node: DialogueNodeId; readonly choice: string }
  | { readonly type: 'asset-state'; readonly asset: AssetId; readonly state: string }
  | { readonly type: 'incident'; readonly code: string; readonly severity: 'info' | 'warning' | 'critical'; readonly detail: string };

export interface SnapshotEntity {
  readonly id: EntityId;
  readonly transform?: Transform;
  readonly velocity?: Velocity;
  readonly tags: readonly string[];
}

export interface RuntimeSnapshot {
  readonly schema: 1;
  readonly tick: number;
  readonly timeSeconds: number;
  readonly entities: readonly SnapshotEntity[];
  readonly qualityLevel: number;
  readonly checksum: string;
}

export interface NetworkSequence {
  readonly value: number;
}

export interface SnapshotEnvelope {
  readonly sequence: NetworkSequence;
  readonly acknowledgedInput: number;
  readonly serverTick: number;
  readonly sentAtTick: number;
  readonly state: RuntimeSnapshot;
}

export interface AssetDefinition {
  readonly id: AssetId;
  readonly uri: string;
  readonly kind: 'texture' | 'model' | 'audio' | 'shader' | 'data';
  readonly weight: number;
  readonly dependencies: readonly AssetId[];
  readonly priority: number;
  readonly integrity?: {
    readonly sizeBytes?: number;
    readonly digest?: string;
    readonly contentType?: string;
  };
}

export type AssetState = 'queued' | 'loading' | 'ready' | 'failed' | 'evicted' | 'cancelled';

export interface SaveHeader {
  readonly magic: 'AAPW-R27';
  readonly schemaVersion: number;
  readonly slot: SaveSlotId;
  readonly createdAtTick: number;
  readonly updatedAtTick: number;
  readonly checksum: string;
}

export interface SaveEnvelope<T> {
  readonly header: SaveHeader;
  readonly data: T;
}

export interface ItemDefinition {
  readonly id: ItemId;
  readonly stackLimit: number;
  readonly weight: number;
  readonly tags: readonly string[];
  readonly equipSlot?: 'head' | 'chest' | 'legs' | 'feet' | 'mainhand' | 'offhand' | 'accessory';
  readonly modifiers?: Readonly<Record<string, number>>;
}

export interface ItemStack {
  readonly item: ItemId;
  readonly quantity: number;
}

export interface EquipmentState {
  readonly slots: Readonly<Record<string, ItemStack | undefined>>;
}

export interface InventoryState {
  readonly capacity: number;
  readonly stacks: readonly ItemStack[];
  readonly equipment: EquipmentState;
}

export interface DialogueState {
  readonly graphId: string;
  readonly current: DialogueNodeId;
  readonly variables: Readonly<Record<string, number | string | boolean>>;
  readonly tags: readonly string[];
  readonly history: readonly DialogueNodeId[];
}

export interface CameraVolume {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly fovYRadians: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
}

export interface VisibilityCandidate {
  readonly entity: EntityId;
  readonly bounds: Aabb;
  readonly position: Vec3;
  readonly radius: number;
  readonly importance: number;
  readonly distance: number;
  readonly occlusionHint: number;
}

export type LodTier = 0 | 1 | 2 | 3 | 4;

export interface VisibilityDecision {
  readonly entity: EntityId;
  readonly visible: boolean;
  readonly tier: LodTier;
  readonly score: number;
}

export function entityId(value: number): EntityId {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('EntityId must be a positive integer');
  return value as EntityId;
}

export function componentType(value: string): ComponentType {
  const normalized = value.trim();
  if (!normalized) throw new RangeError('ComponentType cannot be empty');
  return normalized as ComponentType;
}

export function systemId(value: string): SystemId {
  const normalized = value.trim();
  if (!normalized) throw new RangeError('SystemId cannot be empty');
  return normalized as SystemId;
}

export function assetId(value: string): AssetId {
  const normalized = value.trim();
  if (!normalized) throw new RangeError('AssetId cannot be empty');
  return normalized as AssetId;
}

export function itemId(value: string): ItemId {
  const normalized = value.trim();
  if (!normalized) throw new RangeError('ItemId cannot be empty');
  return normalized as ItemId;
}

export function dialogueNodeId(value: string): DialogueNodeId {
  const normalized = value.trim();
  if (!normalized) throw new RangeError('DialogueNodeId cannot be empty');
  return normalized as DialogueNodeId;
}

export function saveSlotId(value: string): SaveSlotId {
  const normalized = value.trim();
  if (!normalized) throw new RangeError('SaveSlotId cannot be empty');
  return normalized as SaveSlotId;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return Object.freeze({ x, y, z });
}

export function quat(x = 0, y = 0, z = 0, w = 1): Quat {
  return Object.freeze({ x, y, z, w });
}

export function identityTransform(): Transform {
  return Object.freeze({
    position: vec3(),
    rotation: quat(),
    scale: vec3(1, 1, 1),
  });
}

export function zeroInputFrame(tick = 0): InputFrame {
  return Object.freeze({
    tick,
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    buttons: [],
    analog: {},
  });
}
