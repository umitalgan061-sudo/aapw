import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { ENTITY_ID } from './coreTypes.js';
import { EngineRuntime, type EngineFrameInput, type EngineFrameOutput } from './engineRuntime.js';
import { EcsRuntime } from './ecsRuntime.js';
import { EventRuntime } from './eventRuntime.js';
import { CommandRuntime, type CommandEnvelope } from './commandRuntime.js';
import { SnapshotRuntime } from './snapshotRuntime.js';
import { PerformanceRuntime } from './performanceRuntime.js';
import { WorldStateRuntime } from './worldStateRuntime.js';
import { TelemetryRuntime } from './telemetryRuntime.js';
import { ReleaseRuntime } from './releaseRuntime.js';
import type { ReleaseInput } from './releaseRuntime.js';

export interface IntegrationOptions { readonly engine?: EngineRuntime; readonly now?: () => number; readonly autoSnapshotTicks?: number; readonly maxSnapshots?: number; }
export interface IntegrationFrame { readonly tick: number; readonly frame: EngineFrameOutput | null; readonly commands: ReturnType<CommandRuntime['stats']>; readonly ecs: ReturnType<EcsRuntime['stats']>; readonly worldState: ReturnType<WorldStateRuntime['stats']>; readonly performance: ReturnType<PerformanceRuntime['stats']>; readonly telemetry: ReturnType<TelemetryRuntime['stats']>; }
export interface IntegrationStats { readonly frames: number; readonly snapshots: number; readonly events: number; readonly commands: number; readonly releases: number; }

export class IntegrationRuntime implements Disposable {
  readonly engine: EngineRuntime;
  readonly ecs: EcsRuntime;
  readonly events: EventRuntime;
  readonly commands: CommandRuntime;
  readonly snapshots: SnapshotRuntime<unknown>;
  readonly performance: PerformanceRuntime;
  readonly worldState: WorldStateRuntime;
  readonly telemetry: TelemetryRuntime;
  readonly release: ReleaseRuntime;
  #now: () => number;
  #autoSnapshotTicks: number;
  #frame = 0;
  #disposed = false;
  #lastTick = 0;

  constructor(options: IntegrationOptions = {}) {
    this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.engine = options.engine ?? new EngineRuntime({ clock: { now: this.#now } });
    this.ecs = new EcsRuntime();
    this.events = new EventRuntime();
    this.commands = new CommandRuntime({ now: this.#now });
    this.snapshots = new SnapshotRuntime(options.maxSnapshots ?? 64);
    this.performance = new PerformanceRuntime();
    this.worldState = new WorldStateRuntime();
    this.telemetry = new TelemetryRuntime();
    this.release = new ReleaseRuntime({}, this.#now);
    this.#autoSnapshotTicks = Math.max(1, Math.trunc(options.autoSnapshotTicks ?? 120));
    this.#wireCommands();
  }

  async boot(): Promise<boolean> { return this.engine.boot(); }

  async frame(input: EngineFrameInput): Promise<IntegrationFrame> {
    if (this.#disposed) return Object.freeze({ tick: this.#lastTick, frame: null, commands: this.commands.stats(), ecs: this.ecs.stats(), worldState: this.worldState.stats(), performance: this.performance.stats(), telemetry: this.telemetry.stats() });
    const frame = await this.engine.frame(input);
    this.#frame += 1;
    this.#lastTick = Number(frame?.context.tick ?? this.#lastTick);
    this.commands.execute(this.#lastTick);
    this.ecs.update(input.deltaSeconds);
    this.events.publish('engine.frame', { frame: this.#frame, tick: this.#lastTick }, this.#lastTick);
    this.events.flush(128);
    this.telemetry.sample({ name: 'integration.frame.ms', value: Number.isFinite(input.deltaSeconds) ? input.deltaSeconds * 1000 : 0, unit: 'ms', tick: this.#lastTick, frame: this.#frame, tags: {} });
    this.telemetry.sample({ name: 'integration.entities', value: this.worldState.stats().entities, unit: 'count', tick: this.#lastTick, frame: this.#frame, tags: {} });
    if (this.#lastTick > 0 && this.#lastTick % this.#autoSnapshotTicks === 0) this.captureSnapshot();
    return Object.freeze({ tick: this.#lastTick, frame, commands: this.commands.stats(), ecs: this.ecs.stats(), worldState: this.worldState.stats(), performance: this.performance.stats(), telemetry: this.telemetry.stats() });
  }

  enqueue<T>(command: CommandEnvelope<T>): boolean { return this.commands.enqueue(command).ok; }
  publish<T>(type: string, payload: T, tick = this.#lastTick): boolean { return this.events.publish(type, payload, tick); }
  addEntity(id: string, position: Vec3, tags: readonly string[] = []): EntityId | null {
    const entity = this.engine.addEntity(id, position, tags);
    if (!entity) return null;
    const typedId = ENTITY_ID(id);
    this.worldState.upsert({ id: typedId, revision: this.#lastTick + 1, owner: 'local', transform: { position: Object.freeze({ ...position }), rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }), scale: Object.freeze({ x: 1, y: 1, z: 1 }) }, flags: 0, metadata: Object.freeze({ tags: tags.join(',') }) });
    return typedId;
  }

  captureSnapshot(): ReturnType<SnapshotRuntime<unknown>['capture']> {
    const state = Object.freeze({ tick: this.#lastTick, engine: this.engine.snapshot(), worldState: this.worldState.snapshot(), ecs: this.ecs.snapshot() });
    return this.snapshots.capture(this.#lastTick, state);
  }

  releaseCheck(input: ReleaseInput, buildId = 'integration'): ReturnType<ReleaseRuntime['evaluate']> { return this.release.evaluate(buildId, input); }
  health(): ReturnType<TelemetryRuntime['health']> { return this.telemetry.health(); }
  snapshot(): IntegrationFrame | null { return this.#lastFrame; }
  stats(): IntegrationStats { return Object.freeze({ frames: this.#frame, snapshots: this.snapshots.stats().snapshots, events: this.events.stats().published, commands: this.commands.stats().executed, releases: this.release.history().length }); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.release.dispose(); this.telemetry.dispose(); this.worldState.dispose(); this.performance.dispose(); this.snapshots.dispose(); this.commands.dispose(); this.events.dispose(); this.ecs.dispose(); this.engine.dispose(); }
  #lastFrame: IntegrationFrame | null = null;
  #wireCommands(): void { this.commands.register({ type: 'engine.pause', priority: 100, handle: () => ({ ok: this.engine.pause(), value: undefined }) }); this.commands.register({ type: 'engine.resume', priority: 100, handle: () => ({ ok: this.engine.resume(), value: undefined }) }); }
}

export const createIntegrationRuntime = (options: IntegrationOptions = {}): IntegrationRuntime => new IntegrationRuntime(options);
