import { DeterministicEventBus, type V7Event } from './eventBus.js';
import { InputReplayRuntime, type InputCommand, type RawInput } from './inputReplay.js';
import { NetworkSession, type NetworkEnvelope } from './networkSession.js';
import { VersionedPersistence } from './persistence.js';
import { RenderGovernor, type RenderSignals, type RenderDecision } from './renderGovernor.js';
import { ResourceResidency, type ResourceManifest } from './resourceResidency.js';
import { RuntimeSecurity } from './security.js';
import { RuntimeScheduler, FixedStepClock, type SchedulerReport, type ScheduledTask } from './scheduler.js';
import { SpatialWorldIndex, type SpatialEntity } from './spatialWorld.js';
import { RuntimeStateStore, type StateChange, type StateSource, type StateSnapshot } from './stateStore.js';
import { RuntimeTaskGraph } from './taskGraph.js';
import { RuntimeTelemetry } from './telemetry.js';
import { UtilityAiDirector, type AiActor, type AiStimulus, type AiGoal } from './aiDirector.js';
import { BoundedWorkerPool } from './workerPool.js';
import { asTick, digest, type Disposable, type Tick, type Vec3, type V7Result } from './primitives.js';
import { V7_PROTOCOL, V7_VERSION } from './version.js';

export interface RuntimeKernelOptions { readonly fixedStepMs?: number; readonly memoryBudgetBytes?: number; readonly renderBackend?: 'webgpu' | 'webgl2' | 'headless'; readonly saveBuild?: string; }
export interface RuntimeFrame { readonly tick: Tick; readonly interpolation: number; readonly scheduler: SchedulerReport; readonly render: RenderDecision; readonly state: StateSnapshot; readonly events: readonly V7Event[]; readonly digest: string; }
export interface RuntimeHealth { readonly runtime: 'ready' | 'degraded' | 'disposed'; readonly version: string; readonly tick: Tick; readonly schedulerDropped: number; readonly residentBytes: number; readonly aiActors: number; readonly networkPeers: number; readonly healthScore: number; readonly digest: string; }

export class V7RuntimeKernel implements Disposable {
  readonly version = V7_VERSION; readonly protocol = V7_PROTOCOL;
  readonly clock: FixedStepClock; readonly scheduler: RuntimeScheduler; readonly state: RuntimeStateStore; readonly events: DeterministicEventBus;
  readonly resources: ResourceResidency; readonly spatial: SpatialWorldIndex; readonly ai: UtilityAiDirector; readonly network: NetworkSession; readonly render: RenderGovernor;
  readonly input: InputReplayRuntime; readonly persistence: VersionedPersistence; readonly security: RuntimeSecurity; readonly telemetry: RuntimeTelemetry; readonly workers: BoundedWorkerPool; readonly tasks: RuntimeTaskGraph;
  #disposed = false; #lastFrame: RuntimeFrame | null = null;
  constructor(options: RuntimeKernelOptions = {}) {
    this.clock = new FixedStepClock(options.fixedStepMs ?? 1000 / 60, 5); this.scheduler = new RuntimeScheduler(); this.state = new RuntimeStateStore(); this.events = new DeterministicEventBus();
    this.resources = new ResourceResidency({ maxBytes: options.memoryBudgetBytes ?? 512 * 1024 * 1024 }); this.spatial = new SpatialWorldIndex(); this.ai = new UtilityAiDirector(); this.network = new NetworkSession(); this.render = new RenderGovernor(); this.render.setBackend(options.renderBackend ?? 'headless');
    this.input = new InputReplayRuntime(); this.persistence = new VersionedPersistence({ build: options.saveBuild ?? `aapw-${V7_VERSION}` }); this.security = new RuntimeSecurity(); this.telemetry = new RuntimeTelemetry(); this.workers = new BoundedWorkerPool(); this.tasks = new RuntimeTaskGraph();
  }
  ingestFrame(frameMs: number): number { if (this.#disposed) return 0; const steps = this.clock.ingest(frameMs); this.telemetry.observeFrame(Math.max(0, frameMs), this.clock.tick()); return steps; }
  enqueue(task: ScheduledTask): V7Result<void> { return this.scheduler.enqueue(task); }
  ingestInput(raw: RawInput): V7Result<InputCommand> { return this.input.ingest(raw, this.clock.tick()); }
  mutate(source: StateSource, changes: readonly StateChange[]): V7Result<unknown> { return this.state.begin(`frame:${Number(this.clock.tick())}:${this.state.revision() + 1}`, source, this.clock.tick(), changes); }
  publish<T>(type: string, source: string, payload: T): V7Result<V7Event<T>> { return this.events.publish(type, this.clock.tick(), source, payload); }
  registerResource(entry: Omit<ResourceManifest, 'id'> & { id: string }): V7Result<unknown> { return this.resources.register(entry); }
  requestResource(id: ResourceManifest['id']): boolean { return this.resources.request(id); }
  completeResource(id: ResourceManifest['id'], bytes: number, valid = true): boolean { return this.resources.complete(id, bytes, Number(this.clock.tick()), valid); }
  upsertSpatial(entity: Omit<SpatialEntity, 'id'> & { id: string }): boolean { return this.spatial.upsert(entity); }
  registerAi(actor: Omit<AiActor, 'id'> & { id: string }): boolean { return this.ai.registerActor(actor); }
  setAiGoals(actor: AiActor['id'], goals: readonly AiGoal[]): boolean { return this.ai.setGoals(actor, goals); }
  observeAi(actor: AiActor['id'], stimuli: readonly AiStimulus[]): number { return this.ai.observe(actor, stimuli); }
  connectPeer(id: string): V7Result<unknown> { return this.network.connect(id); }
  sendNetwork(source: AiActor['id'], payload: unknown, channel: NetworkEnvelope['channel'] = 'state'): V7Result<unknown> { return this.network.send(channel, source, payload); }
  evaluateRender(signals: RenderSignals): RenderDecision { return this.render.evaluate(signals); }
  advance(frameMs: number, renderSignals: RenderSignals): RuntimeFrame {
    if (this.#disposed) return this.#lastFrame ?? Object.freeze({ tick: asTick(0), interpolation: 0, scheduler: this.scheduler.run(asTick(0)), render: this.render.evaluate(renderSignals), state: this.state.snapshot(), events: [], digest: 'disposed' });
    this.ingestFrame(frameMs); const tick = this.clock.tick(); const aiDecisions = this.ai.update(Number(tick), new Map()); this.network.setTick(Number(tick));
    if (aiDecisions.length) this.events.publish('ai:decisions', tick, 'v7.ai', aiDecisions);
    this.telemetry.counter('runtime.operations', 1); const scheduler = this.scheduler.run(tick); const render = this.render.evaluate(renderSignals); const state = this.state.snapshot(); const frame: RuntimeFrame = Object.freeze({ tick, interpolation: this.clock.interpolation(), scheduler, render, state, events: Object.freeze(this.events.query({ afterSerial: Math.max(0, this.events.serial() - 64) })), digest: digest(tick, scheduler.digest, render.digest, state.digest, this.events.serial()) });
    this.#lastFrame = frame; this.telemetry.gauge('runtime.queuePressure01', Math.min(1, this.scheduler.queues().simulation / 256)); this.telemetry.gauge('runtime.memoryPressure01', Math.min(1, this.resources.stats().residentBytes / Math.max(1, 512 * 1024 * 1024))); return frame;
  }
  health(): RuntimeHealth { if (this.#disposed) return Object.freeze({ runtime: 'disposed', version: this.version, tick: asTick(0), schedulerDropped: 0, residentBytes: 0, aiActors: 0, networkPeers: 0, healthScore: 0, digest: 'disposed' }); const telemetry = this.telemetry.health(); const health: RuntimeHealth = Object.freeze({ runtime: telemetry.score01 < .5 ? 'degraded' : 'ready', version: this.version, tick: this.clock.tick(), schedulerDropped: this.clock.droppedSteps(), residentBytes: this.resources.stats().residentBytes, aiActors: this.ai.stats().actors, networkPeers: this.network.stats().peers, healthScore: telemetry.score01, digest: digest(telemetry, this.clock.tick(), this.resources.stats(), this.ai.stats(), this.network.stats()) }); return health; }
  snapshot(): StateSnapshot { return this.state.snapshot(); }
  replayInputs(fromTick: Tick, toTick: Tick, consumer: (command: InputCommand) => void): number { return this.input.replay(this.input.range(fromTick, toTick), consumer); }
  async save(slot: string, payload: unknown): Promise<V7Result<unknown>> { return this.persistence.save(slot, payload, this.clock.tick()); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.clock.dispose(); this.scheduler.dispose(); this.state.dispose(); this.events.dispose(); this.resources.dispose(); this.spatial.dispose(); this.ai.dispose(); this.network.dispose(); this.render.dispose(); this.input.dispose(); this.persistence.dispose(); this.security.dispose(); this.telemetry.dispose(); this.workers.dispose(); this.tasks.dispose(); this.#lastFrame = null; }
}
