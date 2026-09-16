/**
 * V6 composition root.
 * Wires deterministic simulation, assets, scene planning, input, network,
 * performance, security, telemetry and UI into one framework-neutral facade.
 */

import { AssetGraph, type AssetDescriptor, type AssetLoader, type AssetId } from './assetGraph.ts';
import { CommandPipeline, type RawInputFrame, type CommandEnvelope } from './commandPipeline.ts';
import { DeterministicKernel, DeterministicTaskScheduler, type KernelConfig } from './deterministicKernel.ts';
import { NetworkSession, type NetworkRole, type NetworkSessionConfig } from './networkSession.ts';
import { PerformanceGovernor, type PerformanceGovernor as GovernorType, type QualityLevel, type PerformanceSample } from './performanceGovernor.ts';
import { PwaRuntime } from './pwaRuntime.ts';
import { RuntimeSecurityBoundary } from './securityTelemetry.ts';
import { ScenePlanner, type CameraState, type SceneObjectDescriptor, type ScenePlan } from './scenePlanner.ts';
import { UiStore, createInitialUiState, type UiAction, type UiState } from './uiState.ts';

export interface V6PlatformConfig {
  readonly kernel?: Partial<KernelConfig>;
  readonly networkRole?: NetworkRole;
  readonly network?: Partial<NetworkSessionConfig>;
  readonly initialQuality?: QualityLevel;
  readonly version?: string;
}

export interface V6PlatformSystems {
  readonly kernel: DeterministicKernel;
  readonly tasks: DeterministicTaskScheduler;
  readonly assets: AssetGraph;
  readonly input: CommandPipeline;
  readonly network: NetworkSession;
  readonly quality: GovernorType;
  readonly pwa: PwaRuntime;
  readonly security: RuntimeSecurityBoundary;
  readonly scene: ScenePlanner;
  readonly ui: UiStore;
}

export interface V6FrameResult {
  readonly tick: number;
  readonly simulationSeconds: number;
  readonly commandsProcessed: number;
  readonly scene?: ScenePlan;
  readonly quality: ReturnType<GovernorType['state']>;
  readonly uiRevision: number;
}

class NullAssetLoader implements AssetLoader {
  async load(descriptor: AssetDescriptor, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    return Object.freeze({ id: descriptor.id, uri: descriptor.uri, kind: descriptor.kind, bytes: descriptor.bytes });
  }
}

export class V6Platform {
  readonly #systems: V6PlatformSystems;
  readonly #commandHandlers = new Map<string, (command: CommandEnvelope) => void>();
  #started = false;
  #disposed = false;
  #lastFrame: V6FrameResult = { tick: 0, simulationSeconds: 0, commandsProcessed: 0, quality: new PerformanceGovernor().state(), uiRevision: 0 };

  constructor(config: V6PlatformConfig = {}, loader: AssetLoader = new NullAssetLoader()) {
    const kernel = new DeterministicKernel(config.kernel);
    const quality = new PerformanceGovernor(config.initialQuality ?? 2);
    this.#systems = {
      kernel,
      tasks: new DeterministicTaskScheduler(),
      assets: new AssetGraph(loader),
      input: new CommandPipeline(),
      network: new NetworkSession(config.networkRole ?? 'client', config.network),
      quality,
      pwa: new PwaRuntime(config.version ?? 'v6'),
      security: new RuntimeSecurityBoundary(),
      scene: new ScenePlanner(),
      ui: new UiStore(createInitialUiState()),
    };
  }

  get systems(): V6PlatformSystems { return this.#systems; }
  get lastFrame(): V6FrameResult { return this.#lastFrame; }

  start(): void {
    this.#assertLive();
    if (this.#started) return;
    this.#started = true;
    this.#systems.network.open();
    this.#systems.kernel.start();
    this.#systems.pwa.start();
    this.#systems.ui.dispatch({ type: 'screen/open', screen: 'game' });
  }

  pause(): void { this.#assertLive(); this.#systems.kernel.pause(); this.#systems.ui.dispatch({ type: 'pause/set', paused: true }); }
  resume(): void { this.#assertLive(); this.#systems.kernel.start(); this.#systems.ui.dispatch({ type: 'pause/set', paused: false }); }

  dispose(): void {
    if (this.#disposed) return;
    this.#systems.kernel.dispose();
    this.#systems.tasks.clear();
    this.#systems.input.clear();
    this.#systems.network.close();
    this.#systems.assets.gc();
    this.#disposed = true;
  }

  registerCommandHandler(name: string, handler: (command: CommandEnvelope) => void): () => void {
    this.#assertLive();
    if (!name || name.length > 80) throw new TypeError('invalid command handler name');
    this.#commandHandlers.set(name, handler);
    return () => { if (this.#commandHandlers.get(name) === handler) this.#commandHandlers.delete(name); };
  }

  ingestInput(frame: RawInputFrame, currentTick: number): ReturnType<CommandPipeline['ingest']> {
    this.#assertLive();
    return this.#systems.input.ingest(frame, currentTick);
  }

  dispatchUi(action: UiAction): UiState {
    this.#assertLive();
    return this.#systems.ui.dispatch(action);
  }

  registerAssets(descriptors: readonly AssetDescriptor[]): void { this.#systems.assets.registerMany(descriptors); }
  requestAssets(ids: readonly AssetId[]): void { for (const id of ids) this.#systems.assets.request(id); }
  upsertSceneObjects(objects: readonly SceneObjectDescriptor[]): void { for (const object of objects) this.#systems.scene.upsert(object); }

  renderPlan(camera: CameraState): ScenePlan { return this.#systems.scene.plan(camera, this.#systems.kernel.snapshot().tickId); }

  frame(realDeltaSeconds: number, sample?: PerformanceSample, camera?: CameraState): V6FrameResult {
    this.#assertLive();
    if (!this.#started) this.start();
    let commandsProcessed = 0;
    this.#systems.kernel.advance(realDeltaSeconds, (context) => {
      const commands = this.#systems.input.drain(Number(context.id));
      commandsProcessed += commands.length;
      for (const command of commands) {
        const handler = this.#commandHandlers.get(command.name);
        if (handler) handler(command);
        else this.#systems.security.guard(`command.${command.name}`, command.payload, Number(context.id));
      }
      this.#systems.tasks.run(context);
      this.#systems.assets.tick(Number(context.id));
      this.#systems.ui.dispatch({ type: 'tick', tick: Number(context.id) });
      return 0;
    });
    if (sample) this.#systems.quality.sample(sample);
    const kernelSnapshot = this.#systems.kernel.snapshot();
    const scene = camera ? this.#systems.scene.plan(camera, Number(kernelSnapshot.tickId)) : undefined;
    this.#systems.pwa.setTick(Number(kernelSnapshot.tickId));
    this.#lastFrame = {
      tick: Number(kernelSnapshot.tickId),
      simulationSeconds: kernelSnapshot.simulationSeconds,
      commandsProcessed,
      scene,
      quality: this.#systems.quality.state(),
      uiRevision: this.#systems.ui.state.revision,
    };
    return this.#lastFrame;
  }

  snapshot(): string {
    this.#assertLive();
    return JSON.stringify({
      kernel: this.#systems.kernel.snapshot(),
      input: this.#systems.input.snapshot(),
      ui: this.#systems.ui.state,
      assets: this.#systems.assets.snapshot(),
      quality: this.#systems.quality.state(),
      network: this.#systems.network.metrics(),
      version: this.#systems.pwa.state().version,
    });
  }

  #assertLive(): void { if (this.#disposed) throw new Error('v6 platform is disposed'); }
}

export function createV6Platform(config: V6PlatformConfig = {}, loader?: AssetLoader): V6Platform {
  return new V6Platform(config, loader);
}

export function platformHealth(platform: V6Platform): { readonly healthy: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  const kernel = platform.systems.kernel.snapshot();
  const quality = platform.systems.quality.state();
  const security = platform.systems.security.metrics.summaries();
  if (kernel.state === 'disposed') reasons.push('kernel disposed');
  if (quality.pressure === 'critical') reasons.push('performance critical');
  if (platform.systems.network.state === 'closed') reasons.push('network closed');
  if (security.some((summary) => summary.name.startsWith('security.reject.') && summary.count > 20)) reasons.push('repeated security rejections');
  return { healthy: reasons.length === 0, reasons };
}

export const V6_FEATURES = Object.freeze([
  'deterministic-kernel',
  'typed-command-pipeline',
  'asset-residency-graph',
  'scene-visibility-lod',
  'transport-agnostic-network',
  'adaptive-performance',
  'pwa-lifecycle',
  'security-telemetry',
  'typed-ui-state',
] as const);
