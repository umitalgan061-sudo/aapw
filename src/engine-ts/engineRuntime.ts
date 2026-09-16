import type { Disposable, EntityId, FrameContext, Vec3 } from './coreTypes.js';
import { ENTITY_ID } from './coreTypes.js';
import { RuntimeKernel } from './runtime.js';
import { WorldRuntime } from './worldRuntime.js';
import { AssetRuntime } from './assetsRuntime.js';
import { NetworkRuntime } from './networkRuntime.js';
import { GameplayRuntime } from './gameplayRuntime.js';
import { RenderRuntime, type CameraView, type RenderItem } from './renderRuntime.js';
import { InputRuntime } from './inputRuntime.js';
import { AiRuntime, NavigationRuntime, type NavigationGrid } from './aiRuntime.js';
import { PersistenceRuntime } from './persistenceRuntime.js';

export interface EngineRuntimeOptions {
  readonly clock?: { now(): number };
  readonly navigation?: NavigationGrid;
  readonly saveSchema?: string;
  readonly saveVersion?: number;
  readonly targetEntityBudget?: number;
}

export interface EngineFrameInput {
  readonly deltaSeconds: number;
  readonly camera: CameraView;
  readonly commands?: readonly import('./gameplayRuntime.js').GameplayCommand[];
  readonly inputTick?: number;
}

export interface EngineFrameOutput {
  readonly context: FrameContext;
  readonly render: ReturnType<RenderRuntime['build']>;
  readonly gameplayEvents: readonly import('./gameplayRuntime.js').GameplayEvent[];
  readonly input: ReturnType<InputRuntime['consume']>;
  readonly health: ReturnType<RuntimeKernel['snapshot']>;
  readonly world: ReturnType<WorldRuntime['stats']>;
  readonly assets: ReturnType<AssetRuntime['stats']>;
  readonly network: ReturnType<NetworkRuntime['stats']>;
}

const defaultClock = { now: () => typeof performance !== 'undefined' ? performance.now() : Date.now() };
const defaultGrid: NavigationGrid = Object.freeze({ width: 128, height: 128, cellSize: 2, walkable: () => true, cost: () => 1 });

export class EngineRuntime implements Disposable {
  readonly runtime: RuntimeKernel;
  readonly world: WorldRuntime;
  readonly assets: AssetRuntime;
  readonly network: NetworkRuntime;
  readonly gameplay: GameplayRuntime;
  readonly render: RenderRuntime;
  readonly input: InputRuntime;
  readonly navigation: NavigationRuntime;
  readonly ai: AiRuntime;
  readonly persistence: PersistenceRuntime<Record<string, unknown>>;
  readonly entityBudget: number;
  #disposed = false;
  #booted = false;
  #lastFrame: EngineFrameOutput | null = null;

  constructor(options: EngineRuntimeOptions = {}) {
    const clock = options.clock ?? defaultClock;
    this.runtime = new RuntimeKernel({ clock });
    this.world = new WorldRuntime();
    this.assets = new AssetRuntime({ now: () => clock.now() });
    this.network = new NetworkRuntime(undefined, () => clock.now());
    this.gameplay = new GameplayRuntime();
    this.render = new RenderRuntime();
    this.input = new InputRuntime();
    this.navigation = new NavigationRuntime(options.navigation ?? defaultGrid);
    this.ai = new AiRuntime(this.navigation);
    this.persistence = new PersistenceRuntime({ schema: options.saveSchema ?? 'aapw-engine', version: options.saveVersion ?? 1, now: () => clock.now() });
    this.entityBudget = Math.max(128, Math.trunc(options.targetEntityBudget ?? 8192));
    this.input.bindDefaults();
  }

  async boot(): Promise<boolean> {
    if (this.#disposed) return false;
    if (this.#booted) return true;
    const result = await this.runtime.boot();
    this.#booted = result.ok;
    return result.ok;
  }

  async frame(input: EngineFrameInput): Promise<EngineFrameOutput | null> {
    if (this.#disposed || !(await this.boot())) return null;
    const runtimeFrame = this.runtime.frame(0);
    if (!runtimeFrame.ok) return null;
    for (const command of input.commands ?? []) this.gameplay.dispatch(command);
    const inputFrame = this.input.consume(input.inputTick ?? Number(runtimeFrame.value.tick));
    const events = this.gameplay.update(input.deltaSeconds, Number(runtimeFrame.value.tick));
    await this.assets.pump();
    await this.network.update();
    const renderItems: RenderItem[] = this.world.entities().filter(entity => entity.active).map(entity => ({
      entity: ENTITY_ID(String(entity.id)),
      position: entity.position,
      radius: entity.radius,
      material: entity.tags.includes('transparent') ? 'transparent' : 'default',
      geometry: entity.tags.includes('character') ? 'character' : 'prop',
      priority: entity.tags.includes('player') ? 100 : entity.tags.includes('enemy') ? 70 : 20,
      transparent: entity.tags.includes('transparent'),
      layer: entity.layer,
    }));
    const packet = this.render.build(input.camera, renderItems, {});
    const output: EngineFrameOutput = Object.freeze({ context: runtimeFrame.value, render: packet, gameplayEvents: events, input: inputFrame, health: this.runtime.snapshot(), world: this.world.stats(), assets: this.assets.stats(), network: this.network.stats() });
    this.#lastFrame = output;
    return output;
  }

  addPlayer(id: string, position: Vec3): boolean {
    return this.world.register({ id: ENTITY_ID(id), position, radius: 0.45, layer: 0, tags: ['player', 'character'], active: true });
  }

  addEntity(id: string, position: Vec3, tags: readonly string[] = []): boolean {
    if (this.world.stats().entities >= this.entityBudget) return false;
    return this.world.register({ id: ENTITY_ID(id), position, radius: 0.5, layer: 0, tags, active: true });
  }

  snapshot(): EngineFrameOutput | null { return this.#lastFrame; }

  async save(slot: number): Promise<boolean> {
    const payload = { runtime: this.runtime.snapshot(), world: this.world.entities(), gameplay: this.gameplay.actors(), savedAt: Date.now() };
    return (await this.persistence.save(slot, payload)).ok;
  }

  async load(slot: number): Promise<Record<string, unknown> | null> {
    const result = await this.persistence.load(slot);
    return result.ok ? result.value : null;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.persistence.dispose();
    this.ai.dispose();
    this.navigation.dispose();
    this.input.dispose();
    this.render.dispose();
    this.gameplay.dispose();
    this.network.dispose();
    this.assets.dispose();
    this.world.dispose();
    this.runtime.dispose();
    this.#lastFrame = null;
  }
}

export const createEngineRuntime = (options: EngineRuntimeOptions = {}): EngineRuntime => new EngineRuntime(options);
