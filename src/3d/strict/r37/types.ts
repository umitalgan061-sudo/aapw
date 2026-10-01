export type RuntimeMode = 'booting' | 'running' | 'paused' | 'degraded' | 'recovering' | 'disposed';

export type QualityTier = 'minimal' | 'low' | 'balanced' | 'high' | 'ultra';

export type EntityKind =
  | 'player'
  | 'npc'
  | 'animal'
  | 'creature'
  | 'dragon'
  | 'vehicle'
  | 'structure'
  | 'prop'
  | 'effect';

export type CommandKind =
  | 'move'
  | 'look'
  | 'jump'
  | 'attack'
  | 'guard'
  | 'dodge'
  | 'interact'
  | 'equip'
  | 'unequip'
  | 'use'
  | 'pause'
  | 'resume'
  | 'teleport'
  | 'custom';

export type NetworkRole = 'offline' | 'client' | 'host' | 'server';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EntityTransform {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export interface EntityRecord {
  readonly id: string;
  readonly kind: EntityKind;
  readonly transform: EntityTransform;
  readonly active: boolean;
  readonly version: number;
  readonly tags: readonly string[];
  readonly data: Readonly<Record<string, unknown>>;
}

export interface InputFrame {
  readonly tick: number;
  readonly sequence: number;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly jump: boolean;
  readonly sprint: boolean;
  readonly guard: boolean;
  readonly attack: boolean;
  readonly dodge: boolean;
  readonly interact: boolean;
  readonly timestampMs: number;
}

export interface RuntimeCommand {
  readonly id: string;
  readonly tick: number;
  readonly kind: CommandKind;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sequence: number;
}

export interface RuntimeEvent {
  readonly id: string;
  readonly tick: number;
  readonly type: string;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WorldClockSnapshot {
  readonly tick: number;
  readonly simulationSeconds: number;
  readonly accumulatorSeconds: number;
  readonly fixedStepSeconds: number;
  readonly timeScale: number;
  readonly droppedSteps: number;
}

export interface WorldStateSnapshot {
  readonly version: 37;
  readonly seed: number;
  readonly tick: number;
  readonly mode: RuntimeMode;
  readonly entities: readonly EntityRecord[];
  readonly flags: Readonly<Record<string, boolean>>;
  readonly values: Readonly<Record<string, number>>;
}

export interface RenderItem {
  readonly entityId: string;
  readonly kind: EntityKind;
  readonly transform: EntityTransform;
  readonly visible: boolean;
  readonly lod: number;
  readonly materialKey: string;
  readonly layer: number;
}

export interface RenderFrame {
  readonly frameId: number;
  readonly tick: number;
  readonly alpha: number;
  readonly items: readonly RenderItem[];
  readonly debug: Readonly<Record<string, number>>;
}

export interface AssetTicket {
  readonly id: string;
  readonly url: string;
  readonly priority: number;
  readonly estimatedBytes: number;
  readonly critical: boolean;
}

export interface AssetResult {
  readonly ticketId: string;
  readonly ok: boolean;
  readonly bytes: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface NetworkEntityState {
  readonly id: string;
  readonly tick: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly rotationY: number;
  readonly flags: number;
}

export interface NetworkSnapshot {
  readonly tick: number;
  readonly sentAtMs: number;
  readonly acknowledgedInputSequence: number;
  readonly entities: readonly NetworkEntityState[];
}

export interface SaveEnvelope {
  readonly schema: 37;
  readonly profileId: string;
  readonly createdAtMs: number;
  readonly world: WorldStateSnapshot;
  readonly inputSequence: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface RuntimeBudget {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly assetMs: number;
  readonly maxEntities: number;
  readonly maxCommandsPerTick: number;
}

export interface RuntimeMetrics {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly networkMs: number;
  readonly assetMs: number;
  readonly entities: number;
  readonly commands: number;
  readonly droppedTicks: number;
  readonly memoryPressure: number;
  readonly quality: QualityTier;
}

export interface RuntimeHealth {
  readonly score: number;
  readonly mode: RuntimeMode;
  readonly issues: readonly string[];
  readonly metrics: RuntimeMetrics;
}

export interface RuntimeConfig {
  readonly seed: number;
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly networkRole: NetworkRole;
  readonly initialQuality: QualityTier;
  readonly maxEntities: number;
  readonly maxCommandsPerTick: number;
  readonly commandHistoryCapacity: number;
  readonly snapshotHistoryCapacity: number;
}
