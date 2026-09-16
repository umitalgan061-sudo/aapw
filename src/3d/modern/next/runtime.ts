import { EntityWorld, MovementSystem, Transform, Velocity } from './ecs.ts';
import { EventBus, type RuntimeEvents } from './eventBus.ts';
import { FixedStepScheduler } from './scheduler.ts';
import { InputCommandBuffer, type InputCommand } from './input.ts';
import { ResourceCache, estimateObjectBytes, type ResourceLoader } from './resourceCache.ts';
import { SpatialGrid, createSpatialItem, type SpatialItem } from './spatial.ts';
import { AdaptiveRenderBudget, resolveInitialTier, type RenderCapabilities, type QualityTier } from './render.ts';
import { FrameTelemetry, type RuntimeFrameSample } from './telemetry.ts';
import { validatePayload, DEFAULT_SECURITY_LIMITS, RateLimiter } from './security.ts';
import { tick, type FrameBudget, type InputFrame, type Tick } from './types.ts';

export interface NextRuntimeConfig {
  readonly simulationHz?: number;
  readonly maxSimulationStepsPerFrame?: number;
  readonly resourceBytes?: number;
  readonly resourceEntries?: number;
  readonly inputCapacity?: number;
  readonly security?: Partial<typeof DEFAULT_SECURITY_LIMITS>;
  readonly renderCapabilities?: RenderCapabilities;
  readonly coarsePointer?: boolean;
  readonly qualityTier?: QualityTier;
}

export interface RuntimeFrameResult {
  readonly steps: number;
  readonly alpha: number;
  readonly tier: QualityTier;
  readonly frameMs: number;
  readonly spiralPrevented: boolean;
}

export class NextRuntime {
  readonly scheduler: FixedStepScheduler;
  readonly world = new EntityWorld();
  readonly events = new EventBus<RuntimeEvents>();
  readonly input: InputCommandBuffer;
  readonly resources: ResourceCache;
  readonly spatial = new SpatialGrid<SpatialItem>(32);
  readonly telemetry = new FrameTelemetry();
  readonly rateLimiter: RateLimiter;
  readonly renderBudget: AdaptiveRenderBudget;
  #lastInputSequence = 0;
  #started = false;

  constructor(config: NextRuntimeConfig = {}) {
    const hz = Math.max(10, Math.min(240, config.simulationHz ?? 60));
    this.scheduler = new FixedStepScheduler({ stepSeconds: 1 / hz, maxStepsPerFrame: config.maxSimulationStepsPerFrame ?? 8, maxFrameDeltaSeconds: 0.25 });
    this.input = new InputCommandBuffer(config.inputCapacity ?? 512);
    this.resources = new ResourceCache({ maxBytes: config.resourceBytes ?? 256 * 1024 * 1024, maxEntries: config.resourceEntries ?? 512, maxConcurrentLoads: 8 });
    this.rateLimiter = new RateLimiter(config.security?.maxCommandsPerSecond ?? DEFAULT_SECURITY_LIMITS.maxCommandsPerSecond);
    const initialTier = config.qualityTier ?? resolveInitialTier(config.renderCapabilities ?? { maxTextureSize: 4096, supportsInstancing: true, supportsWebGL2: true }, config.coarsePointer ?? false);
    this.renderBudget = new AdaptiveRenderBudget(initialTier);
    this.#installCoreSystems();
  }

  start(): void { if (this.#started) return; this.#started = true; }
  stop(): void { this.#started = false; }
  get running(): boolean { return this.#started; }
  get currentTick(): Tick { return this.scheduler.tick; }

  submitInput(frame: InputFrame): InputCommand {
    const command = this.input.push(frame);
    this.#lastInputSequence = command.sequence;
    return command;
  }

  async loadResource<T>(key: string, loader: ResourceLoader<T>): Promise<void> {
    const handle = await this.resources.acquire(key, this.currentTick, loader);
    this.resources.get(handle, this.currentTick);
    this.events.emit('resource:ready', { key: handle.key, generation: handle.generation });
  }

  indexEntity(id: number, x: number, z: number, radius = 0): void {
    this.spatial.insert(createSpatialItem(id, x, z, radius));
  }

  frame(frameDeltaSeconds: number, budget: FrameBudget): RuntimeFrameResult {
    if (!this.#started) this.start();
    const startedAt = globalThis.performance?.now?.() ?? 0;
    this.#applyInputForCurrentTick();
    const result = this.scheduler.advance(frameDeltaSeconds);
    this.world.update({ tick: this.currentTick, dtSeconds: this.scheduler.config.stepSeconds, simTime: this.scheduler.simTime });
    const tier = this.renderBudget.observe(budget);
    const end = globalThis.performance?.now?.() ?? startedAt + budget.totalMs;
    const sample: RuntimeFrameSample = { tick: this.currentTick, totalMs: Math.max(budget.totalMs, end - startedAt), simulationMs: budget.simulationMs, renderMs: budget.renderMs, streamingMs: budget.streamingMs, networkMs: budget.networkMs };
    this.telemetry.add(sample);
    return { steps: result.steps, alpha: result.alpha, tier: tier.tier, frameMs: sample.totalMs, spiralPrevented: result.spiralPrevented };
  }

  healthPayload(): { tick: number; entities: number; resources: ReturnType<ResourceCache['stats']>; quality: QualityTier; queuedInput: number } {
    return { tick: this.currentTick, entities: this.world.entities.count(), resources: this.resources.stats(), quality: this.renderBudget.state.tier, queuedInput: this.input.length };
  }

  validateCommandPayload(payload: unknown): boolean { return validatePayload(payload, DEFAULT_SECURITY_LIMITS).ok; }
  commandAllowed(actor: string, nowMs: number): boolean { return this.rateLimiter.allow(actor, nowMs); }
  lastInputSequence(): number { return this.#lastInputSequence; }
  objectBytes(value: unknown): number { return estimateObjectBytes(value); }

  #installCoreSystems(): void {
    this.world.registerComponent(Transform);
    this.world.registerComponent(Velocity);
    this.world.addSystem(new MovementSystem(this.world));
    this.scheduler.addTask('world-events', (context) => this.events.emit('world:tick', { tick: context.tick, dtSeconds: context.dtSeconds }), { priority: -100 });
  }

  #applyInputForCurrentTick(): void {
    const command = this.input.find(this.currentTick);
    if (!command) return;
    this.events.emit('world:tick', { tick: command.tick, dtSeconds: this.scheduler.config.stepSeconds });
  }
}

export function createNextRuntime(config?: NextRuntimeConfig): NextRuntime { return new NextRuntime(config); }
