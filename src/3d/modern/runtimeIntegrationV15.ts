import type { BudgetObservationV14 } from './budgetDirectorV14';
import type { InputIntentV14 } from './inputIntentV14';
import { NextGenRuntimeV15, type NextGenRuntimeOptionsV15 } from './nextGenRuntimeV15';
import { GameplayAuthorityV15, makeGameplayInputV15, type GameplayStateV15 } from './gameplayAuthorityV15';
import { WorldSimulationV15, type WorldEnvironmentStateV15 } from './worldSimulationV15';
import { SpatialRuntimeV15, type SpatialEntityV15, type SpatialPointV15 } from './spatialRuntimeV15';
import { RenderBridgeV15, type RenderCapabilitiesV15, type RenderPacketV15, type RenderDecisionV15 } from './renderBridgeV15';
import { RenderGraphV15, type RenderGraphReportV15 } from './renderGraphV15';
import { PerformanceSamplerV15, type PerformanceSampleV15, type PerformanceSnapshotV15 } from './performanceSamplerV15';
import { RuntimeEventRouterV15 } from './runtimeEventRouterV15';
import { RuntimeSecurityPolicyV15, DEFAULT_SECURITY_POLICY_V15 } from './runtimeSecurityPolicyV15';
import { ModuleRegistryV15 } from './moduleRegistryV15';
import { RuntimeGuardV15 } from './runtimeGuardV15';

export interface RuntimeIntegrationOptionsV15 extends NextGenRuntimeOptionsV15 {
  readonly playerId?: string;
  readonly worldSeed?: number;
  readonly renderCapabilities?: RenderCapabilitiesV15;
  readonly spatialCellSize?: number;
  readonly enableRenderGraph?: boolean;
}

export interface RuntimeInputBundleV15 {
  readonly intent: InputIntentV14;
  readonly gameplay: ReturnType<typeof makeGameplayInputV15>;
  readonly observation: BudgetObservationV14;
}

export interface RuntimeFrameV15 {
  readonly frame: number;
  readonly tick: number;
  readonly runtime: Awaited<ReturnType<NextGenRuntimeV15['tick']>>;
  readonly gameplay: GameplayStateV15;
  readonly environment: WorldEnvironmentStateV15;
  readonly render?: RenderDecisionV15;
  readonly renderGraph?: RenderGraphReportV15;
  readonly performance: PerformanceSnapshotV15;
  readonly spatial: ReturnType<SpatialRuntimeV15<unknown>['metrics']>;
  readonly healthy: boolean;
  readonly eventCount: number;
}

export class RuntimeIntegrationV15 {
  readonly nextGen: NextGenRuntimeV15;
  readonly gameplay: GameplayAuthorityV15;
  readonly environment: WorldSimulationV15;
  readonly spatial: SpatialRuntimeV15<unknown>;
  readonly events: RuntimeEventRouterV15;
  readonly security: RuntimeSecurityPolicyV15;
  readonly modules: ModuleRegistryV15;
  readonly guard: RuntimeGuardV15;
  readonly performance: PerformanceSamplerV15;
  readonly renderBridge?: RenderBridgeV15;
  readonly renderGraph?: RenderGraphV15;
  #lastFrame?: RuntimeFrameV15;
  #initialized = false;

  constructor(options: RuntimeIntegrationOptionsV15 = {}) {
    const seed = options.worldSeed ?? options.worldSeed ?? 0x57455354;
    this.nextGen = new NextGenRuntimeV15({
      initialQuality: options.initialQuality,
      fixedStepMs: options.fixedStepMs,
      frameBudgetMs: options.frameBudgetMs,
      maxExecutionTasks: options.maxExecutionTasks,
      worldState: options.worldState,
      now: options.now,
    });
    this.gameplay = new GameplayAuthorityV15(options.playerId ?? 'player-1', {
      now: options.now,
    });
    this.environment = new WorldSimulationV15({
      seed,
    });
    this.spatial = new SpatialRuntimeV15(options.spatialCellSize ?? 32);
    this.events = new RuntimeEventRouterV15({
      now: options.now,
    });
    this.security = new RuntimeSecurityPolicyV15(DEFAULT_SECURITY_POLICY_V15);
    this.modules = new ModuleRegistryV15();
    this.guard = new RuntimeGuardV15({
      now: options.now,
    });
    this.guard.installDefaultRules();
    this.performance = new PerformanceSamplerV15();
    if (options.renderCapabilities) {
      this.renderBridge = new RenderBridgeV15(options.renderCapabilities);
    }
    if (options.enableRenderGraph !== false) {
      this.renderGraph = new RenderGraphV15();
    }
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    await this.modules.start(
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
      (message) => {
        this.events.emit(
          'runtime:module-warning',
          { message },
          { source: 'module-registry' },
        );
      },
    );
    this.#initialized = true;
    this.events.emit(
      'runtime:initialized',
      { version: 15 },
      { source: 'runtime-integration' },
    );
  }

  registerEntity(entity: SpatialEntityV15<unknown>): void {
    const audit = this.security.auditPayload(entity);
    if (!audit.accepted) {
      throw new Error(
        'Entity rejected by security policy: ' +
        audit.reasons.join(', '),
      );
    }
    this.spatial.set(entity);
    this.events.emit(
      'world:entity-added',
      { id: entity.id },
      { source: 'spatial-runtime' },
    );
  }

  removeEntity(id: string): boolean {
    const removed = this.spatial.remove(id);
    if (removed) {
      this.events.emit(
        'world:entity-removed',
        { id },
        { source: 'spatial-runtime' },
      );
    }
    return removed;
  }

  queryEntities(
    center: SpatialPointV15,
    radius: number,
    limit = 128,
  ): readonly SpatialEntityV15<unknown>[] {
    return this.spatial.querySphere({
      center,
      radius,
      limit: Math.min(
        this.security.policy.maxNetworkEntities,
        Math.max(1, Math.trunc(limit)),
      ),
    });
  }

  async tick(bundle: RuntimeInputBundleV15): Promise<RuntimeFrameV15> {
    if (!this.#initialized) {
      await this.initialize();
    }
    const securityAudit = this.security.auditPayload(bundle.intent);
    if (!securityAudit.accepted) {
      this.events.emit(
        'security:input-rejected',
        securityAudit,
        { source: 'security' },
      );
      throw new Error(
        'Input rejected by security policy: ' +
        securityAudit.reasons.join(', '),
      );
    }

    const runtime = await this.nextGen.tick(
      bundle.observation,
      bundle.intent,
    );

    const gameplayInput = makeGameplayInputV15(bundle.gameplay);
    const gameplay = this.gameplay.step(
      gameplayInput,
      runtime.deltaMs,
      runtime.tick,
    );

    const environment = this.environment.tick(
      Math.max(
        1,
        Math.round(runtime.deltaMs / Math.max(1, this.environmentTicksPerFrame())),
      ),
    );

    for (const event of this.gameplay.drainEvents()) {
      await this.events.emit(
        'gameplay:' + event.type,
        event,
        {
          frame: runtime.frame,
          tick: runtime.tick,
          source: 'gameplay-authority',
        },
      );
    }

    const render = this.renderBridge
      ? this.renderBridge.build(
          this.createRenderPacket(runtime.frame, runtime.tick),
        )
      : undefined;

    const renderGraph = this.renderGraph
      ? this.renderGraph.execute(runtime.frame, runtime.tick)
      : undefined;

    const performanceSample: PerformanceSampleV15 = {
      frameMs: runtime.deltaMs,
      cpuMs: runtime.execution.totalDurationMs,
      gpuMs: bundle.observation.gpuMs ?? runtime.execution.totalDurationMs,
      simulationMs: bundle.observation.cpuMs,
      streamingMs: bundle.observation.frameMs - bundle.observation.cpuMs,
      networkMs: bundle.observation.gpuMs ?? 0,
      drawCalls: bundle.observation.drawCalls,
      triangles: Math.max(0, bundle.observation.visibleObjects * 128),
      visibleObjects: bundle.observation.visibleObjects,
      memoryMb: bundle.observation.memoryPressure * 1600,
      timestampMs: runtime.frame,
      frame: runtime.frame,
    };

    const performance = this.performance.push(performanceSample);

    const guard = this.guard.evaluate({
      frameMs: runtime.deltaMs,
      simulationTick: runtime.tick,
      memoryMb: performance.average.memoryMb,
      networkRttMs: bundle.observation.gpuMs,
      packetLoss: bundle.observation.memoryPressure * 0.1,
      entities: bundle.observation.visibleObjects,
      commands: runtime.execution.completed.length,
      digest: runtime.worldDigest,
    });

    const healthy =
      runtime.healthy &&
      guard.healthy &&
      performance.band !== 'critical' &&
      (!renderGraph || renderGraph.failed.length === 0);

    const frame: RuntimeFrameV15 = Object.freeze({
      frame: runtime.frame,
      tick: runtime.tick,
      runtime,
      gameplay,
      environment,
      ...(render ? { render } : {}),
      ...(renderGraph ? { renderGraph } : {}),
      performance,
      spatial: this.spatial.metrics(),
      healthy,
      eventCount: this.events.pending(),
    });

    this.#lastFrame = frame;

    this.events.emit(
      healthy ? 'runtime:frame' : 'runtime:degraded',
      {
        frame: runtime.frame,
        tick: runtime.tick,
        score: guard.score,
        pressure: performance.pressure,
      },
      {
        frame: runtime.frame,
        tick: runtime.tick,
        source: 'runtime-integration',
      },
    );

    await this.events.dispatch(512);
    return frame;
  }

  latest(): RuntimeFrameV15 | undefined {
    return this.#lastFrame;
  }

  async shutdown(): Promise<void> {
    if (!this.#initialized) {
      return;
    }
    await this.modules.stop(
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
      (message) => {
        this.events.emit(
          'runtime:shutdown-warning',
          { message },
          { source: 'module-registry' },
        );
      },
    );
    this.#initialized = false;
    this.events.emit(
      'runtime:shutdown',
      { version: 15 },
      { source: 'runtime-integration' },
    );
    await this.events.dispatch(512);
  }

  reset(): void {
    this.#lastFrame = undefined;
    this.nextGen.reset();
    this.gameplay.reset();
    this.environment.reset();
    this.spatial.clear();
    this.events.clear();
    this.performance.reset();
    this.guard.reset();
    this.#initialized = false;
  }

  #renderCamera(frame: number) {
    const player = this.gameplay.state().transform;
    return {
      x: player.x,
      y: player.y + 1.7,
      z: player.z,
      fov: 60,
      near: 0.1,
      far: 5000,
    };
  }

  #createLayers(frame: number): RenderPacketV15['layers'] {
    const visible = this.spatial.entities();
    return Object.freeze(
      visible.slice(0, 2048).map((entity, index) => Object.freeze({
        id: entity.id,
        visible: entity.active,
        priority: Math.max(0, 1000 - index),
        drawCalls: 1,
        triangles: 128,
        instances: 1,
        materialGroup: 'entity',
        distance: Math.hypot(
          entity.position.x - this.gameplay.state().transform.x,
          entity.position.z - this.gameplay.state().transform.z,
        ),
        castsShadow: index < 256,
      })),
    );
  }

  #createRenderPacket(frame: number, tick: number): RenderPacketV15 {
    const budget = this.nextGen.v14.control.budget.decision();
    const layers = this.#createLayers(frame);
    return Object.freeze({
      frame,
      tick,
      camera: this.#renderCamera(frame),
      layers,
      budget: Object.freeze({
        frameMs: budget.maxSimulationMs + budget.maxStreamingMs,
        drawCalls: budget.maxDrawCalls,
        triangles: Math.max(1, budget.maxVisibleObjects) * 128,
        instances: budget.maxVisibleObjects,
        textureBytes: 256 * 1024 * 1024,
        shadowCasters: Math.min(256, budget.maxVisibleObjects),
        postEffects: budget.tier === 'ultra' ? 8 : budget.tier === 'high' ? 4 : 1,
      }),
      qualityScale: budget.renderScale,
    });
  }

  environmentTicksPerFrame(): number {
    return 16.6667;
  }
}

export const createRuntimeIntegrationV15 = (
  options?: RuntimeIntegrationOptionsV15,
): RuntimeIntegrationV15 => new RuntimeIntegrationV15(options);
