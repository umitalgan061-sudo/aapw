export type EntityId = number & { readonly __entityId: unique symbol };
export type ComponentType = string & { readonly __componentType: unique symbol };
export type Tick = number & { readonly __tick: unique symbol };
export type SimTime = number & { readonly __simTime: unique symbol };

export interface Vec2 { x: number; y: number; }
export interface Vec3 { x: number; y: number; z: number; }
export interface Aabb2 { minX: number; minZ: number; maxX: number; maxZ: number; }

export interface InputFrame {
  readonly tick: Tick;
  readonly moveX: number;
  readonly moveZ: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly buttons: number;
}

export interface SimulationClockState {
  readonly tick: Tick;
  readonly simTime: SimTime;
  readonly accumulatorSeconds: number;
}

export interface FrameBudget {
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly totalMs: number;
}

export interface SchedulerTaskContext {
  readonly tick: Tick;
  readonly dtSeconds: number;
  readonly simTime: SimTime;
}

export type SchedulerTask = (context: SchedulerTaskContext) => void;

export interface SystemContext {
  readonly tick: Tick;
  readonly dtSeconds: number;
  readonly simTime: SimTime;
}

export interface System {
  readonly name: string;
  readonly order: number;
  update(context: SystemContext): void;
}

export interface ComponentSchema<T> {
  readonly type: ComponentType;
  readonly create: () => T;
  readonly clone?: (value: T) => T;
}

export interface ResourceHandle {
  readonly key: string;
  readonly generation: number;
}

export type ResourceState = 'pending' | 'ready' | 'failed' | 'disposed';

export interface ResourceRecord<T> {
  readonly handle: ResourceHandle;
  readonly state: ResourceState;
  readonly value?: T;
  readonly bytes: number;
  readonly lastUsedTick: Tick;
  readonly pinCount: number;
  readonly error?: string;
}

export interface NetworkEnvelope<TPayload> {
  readonly protocol: 2;
  readonly session: string;
  readonly sequence: number;
  readonly ack: number;
  readonly sentTick: Tick;
  readonly type: string;
  readonly payload: TPayload;
}

export interface SnapshotEntity {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly flags: number;
}

export interface WorldSnapshot {
  readonly tick: Tick;
  readonly entities: readonly SnapshotEntity[];
}

export interface SaveHeader {
  readonly format: 'aapw-next-save';
  readonly version: number;
  readonly createdAtTick: Tick;
  readonly checksum: string;
}

export interface SaveEnvelope<TState> {
  readonly header: SaveHeader;
  readonly state: TState;
}

export interface TelemetrySample {
  readonly tick: Tick;
  readonly name: string;
  readonly durationMs: number;
  readonly value?: number;
  readonly tags?: Readonly<Record<string, string>>;
}

export const entityId = (value: number): EntityId => Math.max(0, Math.floor(value)) as EntityId;
export const componentType = (value: string): ComponentType => value.trim() as ComponentType;
export const tick = (value: number): Tick => Math.max(0, Math.floor(value)) as Tick;
export const simTime = (value: number): SimTime => Math.max(0, value) as SimTime;
