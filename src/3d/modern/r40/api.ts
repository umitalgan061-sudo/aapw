import type { EntityId, InterestPoint, RuntimeCommand, RuntimeHealthReport, RuntimeTask, Tick, Vec3 } from './types';
import { R40Runtime, createDefaultRuntimeConfig } from './runtime';
import { detectR40Capabilities, classifyPlatform } from './capabilities';
import { SpatialEntityWorld } from './world';
import { FrameGraph } from './render';
import { AssetCatalog, AssetStreamingController } from './streaming';
import { SecurityGate } from './security';
import { UtilityAi } from './ai';
import { SpatialAudioMixer } from './audio';
import { ReplayRecorder } from './save';
import { RuntimeStateGraph } from './runtimeGraph';
import { EcsWorld } from './ecs';
import type { EntityState, AssetManifestEntry, AudioSourceState } from './types';

export interface R40Services {
  readonly runtime: R40Runtime;
  readonly world: SpatialEntityWorld;
  readonly ecs: EcsWorld;
  readonly graph: RuntimeStateGraph;
  readonly render: FrameGraph;
  readonly assets: AssetStreamingController;
  readonly ai: UtilityAi;
  readonly audio: SpatialAudioMixer;
  readonly replay: ReplayRecorder;
  readonly security: SecurityGate;
}

export function createR40Services(viewportWidth = 1280, touchPoints = 0): R40Services {
  const capabilities = detectR40Capabilities();
  const platform = classifyPlatform(capabilities, viewportWidth, touchPoints);
  const runtime = new R40Runtime(createDefaultRuntimeConfig(platform, capabilities));
  const catalog = new AssetCatalog();
  return Object.freeze({
    runtime,
    world: new SpatialEntityWorld({ maxEntities: runtime.config.maxEntities }),
    ecs: new EcsWorld(runtime.config.maxEntities),
    graph: new RuntimeStateGraph(),
    render: new FrameGraph(),
    assets: new AssetStreamingController(catalog),
    ai: new UtilityAi(),
    audio: new SpatialAudioMixer({ maxVoices: runtime.config.initialQuality.maxAudioVoices }),
    replay: new ReplayRecorder(),
    security: runtime.security,
  });
}

export class R40GameFacade {
  readonly services: R40Services;
  #disposed = false;
  constructor(services = createR40Services()) { this.services = services; }
  submit(command: RuntimeCommand): boolean { return !this.#disposed && this.services.runtime.submit(command); }
  addTask(task: RuntimeTask): boolean { return !this.#disposed && this.services.runtime.registerTask(task); }
  registerEntity(entity: EntityState): boolean { return !this.#disposed && this.services.world.upsert(entity) && this.services.ecs.spawn(entity); }
  updateInterest(point: InterestPoint): number { return this.#disposed ? 0 : this.services.world.updateInterest(point); }
  registerAsset(entry: AssetManifestEntry): boolean { return !this.#disposed && this.services.assets.catalog.register(entry); }
  registerAudio(source: AudioSourceState): boolean { return !this.#disposed && this.services.audio.upsert(source); }
  tick(deltaMs: number): RuntimeHealthReport {
    if (this.#disposed) throw new Error('R40 facade disposed');
    this.services.runtime.step(deltaMs);
    return this.health();
  }
  health(): RuntimeHealthReport { return this.services.runtime.healthReport(); }
  setState(path: string, value: unknown, source = 'system' as const): boolean { return !this.#disposed && Boolean(this.services.graph.commit(path, value, source, this.services.runtime.currentTick())); }
  readState(path: string): unknown { return this.#disposed ? undefined : this.services.graph.read(path); }
  audioPlan(listener: Vec3): ReturnType<SpatialAudioMixer['plan']> { return this.#disposed ? Object.freeze([]) : this.services.audio.plan(listener); }
  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.services.runtime.stop(); this.services.world.clear(); this.services.ecs.clear(); this.services.graph.clear(); this.services.render.clearTransient(); this.services.assets.catalog.clear(); this.services.audio.clear(); this.services.replay.clear(); }
  disposed(): boolean { return this.#disposed; }
}

export type { EntityId };
