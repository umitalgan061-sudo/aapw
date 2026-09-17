import { ProductionAssetPipeline, type AssetLoaderP } from './assetPipeline.ts';
import { DEFAULT_PRODUCTION_CONFIG_P, checksumP, integerP, nowP, type AssetManifestItemP, type CameraFrameP, type FrameBudgetP, type InputActionStateP, type ProductionLifecycle, type ProductionPhase, type ProductionRuntimeConfigP, type RuntimeFrameReportP, type RuntimeHealthP, type WorldCommandP, type WorldSnapshotP } from './contracts.ts';
import { ProductionDiagnosticsPipeline } from './diagnosticsPipeline.ts';
import { ProductionEventHub } from './eventHub.ts';
import { ProductionInputPipeline, defaultBindings } from './inputPipeline.ts';
import { TypeScriptMigrationLedgerP, classifyModuleP, type MigrationModuleP } from './migrationLedger.ts';
import { ProductionNetworkPipeline } from './networkPipeline.ts';
import { MemorySaveStorageP, ProductionPersistencePipeline, type SaveStorageP } from './persistencePipeline.ts';
import { ProductionClock } from './runtimeClock.ts';
import { ProductionRenderBudget } from './renderBudget.ts';
import { ProductionWorldPipeline, type InterestSourceP } from './worldPipeline.ts';

export interface ProductionRuntimeOptionsP {
  readonly config?: Partial<ProductionRuntimeConfigP>;
  readonly capabilities?: Partial<{ webgl2: boolean; instancing: boolean; maxTextureSize: number; deviceMemoryGb: number; hardwareConcurrency: number }>;
  readonly saveStorage?: SaveStorageP;
  readonly assetLoaders?: Readonly<Record<string, AssetLoaderP<unknown>>>;
}
export interface ProductionRuntimeTickInputP { readonly deltaSeconds: number; readonly camera?: CameraFrameP; readonly input?: Partial<InputActionStateP>; readonly budget?: Partial<FrameBudgetP>; readonly interests?: readonly InterestSourceP[]; readonly memoryMb?: number; readonly networkRttMs?: number; }
export interface ProductionRuntimeSnapshotP { readonly lifecycle: ProductionLifecycle; readonly frame: number; readonly tick: number; readonly revision: number; readonly actors: ReturnType<ProductionWorldPipeline['actors']>; readonly health: RuntimeHealthP; readonly render: ReturnType<ProductionRenderBudget['plan']>; readonly digest: number; }
export interface ProductionRuntimeStatsP { readonly frame: number; readonly lifecycle: ProductionLifecycle; readonly revision: number; readonly clock: ReturnType<ProductionClock['state']>; readonly world: ReturnType<ProductionWorldPipeline['stats']>; readonly network: ReturnType<ProductionNetworkPipeline['stats']>; readonly assets: ReturnType<ProductionAssetPipeline['stats']>; readonly diagnostics: ReturnType<ProductionDiagnosticsPipeline['stats']>; readonly events: ReturnType<ProductionEventHub['stats']>; readonly migration: ReturnType<TypeScriptMigrationLedgerP['stats']>; readonly digest: number; }

export class ProductionRuntime {
  readonly config: ProductionRuntimeConfigP;
  readonly events: ProductionEventHub;
  readonly clock: ProductionClock;
  readonly input: ProductionInputPipeline;
  readonly world: ProductionWorldPipeline;
  readonly assets: ProductionAssetPipeline<unknown>;
  readonly network: ProductionNetworkPipeline;
  readonly render: ProductionRenderBudget;
  readonly diagnostics: ProductionDiagnosticsPipeline;
  readonly migration: TypeScriptMigrationLedgerP;
  readonly persistence: ProductionPersistencePipeline<Record<string, unknown>>;
  #lifecycle: ProductionLifecycle = 'created'; #frame = 0; #revision = 0; #startedAt = nowP(); #disposed = false;
  #nextGenAttached: { step: (deltaSeconds: number) => unknown; digest: () => number; snapshot: () => unknown } | undefined;

  constructor(options: ProductionRuntimeOptionsP = {}) {
    const configured = options.config ?? {};
    this.config = Object.freeze({ ...DEFAULT_PRODUCTION_CONFIG_P, ...configured, seed: integerP(configured.seed ?? DEFAULT_PRODUCTION_CONFIG_P.seed), simulationHz: Math.max(10, Math.min(240, integerP(configured.simulationHz ?? DEFAULT_PRODUCTION_CONFIG_P.simulationHz))), maxStepsPerFrame: Math.max(1, Math.min(32, integerP(configured.maxStepsPerFrame ?? DEFAULT_PRODUCTION_CONFIG_P.maxStepsPerFrame))) });
    this.events = new ProductionEventHub();
    this.clock = new ProductionClock({ hz: this.config.simulationHz, maxStepsPerFrame: this.config.maxStepsPerFrame });
    this.input = new ProductionInputPipeline(defaultBindings(), { maxHistory: this.config.maxInputHistory }, this.events);
    this.world = new ProductionWorldPipeline({ maxActors: this.config.maxWorldActors }, this.events);
    this.assets = new ProductionAssetPipeline({ maxBytes: this.config.maxAssetBytes, maxEntries: this.config.maxAssetEntries }, this.events);
    this.network = new ProductionNetworkPipeline({ sessionId: `aapw-${this.config.seed.toString(36)}`, maxQueue: this.config.maxNetworkQueue, maxHistory: this.config.snapshotHistory }, this.events);
    const capabilities = Object.freeze({ webgl2: options.capabilities?.webgl2 ?? true, instancing: options.capabilities?.instancing ?? true, maxTextureSize: options.capabilities?.maxTextureSize ?? 4096, deviceMemoryGb: options.capabilities?.deviceMemoryGb ?? 4, hardwareConcurrency: options.capabilities?.hardwareConcurrency ?? 4 });
    this.render = new ProductionRenderBudget(capabilities);
    this.diagnostics = new ProductionDiagnosticsPipeline({ maxSamples: this.config.maxTelemetrySamples }, this.events);
    this.migration = new TypeScriptMigrationLedgerP({ minimumTypedRatio: this.config.strictMigration ? 0.9 : 0.65 }, this.events);
    this.persistence = new ProductionPersistencePipeline(options.saveStorage ?? new MemorySaveStorageP());
    for (const [scheme, loader] of Object.entries(options.assetLoaders ?? {})) this.assets.registerLoader(scheme, loader);
  }

  get lifecycle(): ProductionLifecycle { return this.#lifecycle; }
  get frame(): number { return this.#frame; }
  get revision(): number { return this.#revision; }
  get uptimeMs(): number { return Math.max(0, nowP() - this.#startedAt); }

  boot(): void { this.#ensureLive(); if (this.#lifecycle !== 'created' && this.#lifecycle !== 'stopped') return; this.#transition('booting'); this.clock.reset(); this.network.connect(0); this.#transition('running'); }
  pause(): void { if (this.#lifecycle === 'running') { this.clock.pause(); this.#transition('paused'); } }
  resume(): void { if (this.#lifecycle === 'paused') { this.clock.resume(); this.#transition('running'); } }
  stop(): void { if (this.#lifecycle !== 'running' && this.#lifecycle !== 'paused') return; this.clock.pause(); this.network.disconnect(); this.#transition('stopped'); }

  registerMigrationModules(paths: readonly string[]): number { let registered = 0; for (const path of paths) { const module = classifyModuleP(path); if (!this.migration.get(module.path)) { this.migration.register(module); registered += 1; } } return registered; }
  ingestMigrationRecord(module: MigrationModuleP): void { this.#ensureLive(); if (!this.migration.get(module.path)) this.migration.register(module); }
  spawn(actor: Parameters<ProductionWorldPipeline['spawn']>[0]): boolean { this.#ensureRunning(); const spawned = this.world.spawn(actor, this.clock.tick); if (spawned) this.#revision += 1; return spawned; }
  despawn(id: number, reason = 'requested'): boolean { this.#ensureRunning(); const removed = this.world.despawn(id, this.clock.tick, reason); if (removed) this.#revision += 1; return removed; }
  submitCommand(command: WorldCommandP): boolean { this.#ensureRunning(); return this.world.applyCommand(command); }
  queueNetwork<T>(kind: string, payload: T, reliable = true): boolean { this.#ensureRunning(); return this.network.queue(kind, payload, this.clock.tick, reliable) !== undefined; }
  enqueueAssets(items: readonly AssetManifestItemP[]): number { this.#ensureLive(); return this.assets.enqueue(items, this.clock.tick); }
  async pumpAssets(signal?: AbortSignal): Promise<number> { this.#ensureLive(); return this.assets.pump(this.clock.tick, signal); }

  tick(input: ProductionRuntimeTickInputP): ProductionRuntimeSnapshotP {
    this.#ensureRunning();
    const frameStarted = nowP(); this.#frame += 1;
    if (input.input) this.#applyInput(input.input);
    const sample = this.input.process(this.clock.tick, frameStarted);
    const phaseStart = new Map<ProductionPhase, number>(); const durations = new Map<ProductionPhase, number>();
    const begin = (name: ProductionPhase): void => phaseStart.set(name, nowP());
    const end = (name: ProductionPhase): void => { const start = phaseStart.get(name); if (start !== undefined) durations.set(name, Math.max(0, nowP() - start)); };
    begin('input'); end('input');
    begin('simulation');
    const clockResult = this.clock.advance(input.deltaSeconds, (tick, dt, simulationSeconds) => this.#simulateStep(tick, dt, simulationSeconds, sample, input.interests ?? []));
    end('simulation');
    begin('world');
    if (input.camera) this.world.updateInterests([{ id: 'camera', position: input.camera.position, radiusMeters: Math.max(1, input.camera.far) }], this.clock.tick);
    end('world');
    begin('network');
    this.#recordSnapshotIfNeeded();
    end('network');
    begin('assets');
    void this.assets.pump();
    end('assets');
    begin('render');
    const budget = this.#budget(input.budget, durations, frameStarted); const renderObservation = this.render.observe(budget);
    end('render');
    begin('telemetry');
    const health = this.diagnostics.sample(this.#frame, this.clock.tick, budget, input.memoryMb ?? 0, input.networkRttMs ?? 0, this.assets.stats().queued, 0);
    end('telemetry');
    const render = this.render.plan;
    const phaseTimings = Object.freeze([...durations.entries()].map(([phase, durationMs]) => Object.freeze({ phase, durationMs, budgetMs: phaseBudget(phase) })));
    const report: RuntimeFrameReportP = Object.freeze({ frame: this.#frame, tick: this.clock.tick, lifecycle: this.#lifecycle, steps: clockResult.steps, alpha: clockResult.alpha, render, health, phaseTimings, digest: checksumP({ frame: this.#frame, tick: this.clock.tick, revision: this.#revision, input: sample.sequence, renderObservation, health, world: this.world.digest() }) });
    this.events.emit('runtime:frame', report);
    return this.snapshot();
  }

  snapshot(): ProductionRuntimeSnapshotP { const health = this.diagnostics.latest(); return Object.freeze({ lifecycle: this.#lifecycle, frame: this.#frame, tick: this.clock.tick, revision: this.#revision, actors: this.world.actors(), health, render: this.render.plan, digest: checksumP({ lifecycle: this.#lifecycle, frame: this.#frame, tick: this.clock.tick, revision: this.#revision, world: this.world.digest(), network: this.network.stats().checksum, assets: this.assets.digest(), render: this.render.plan }) }); }

  worldSnapshot(): WorldSnapshotP { const actors = this.world.actors().map(actor => ({ id: actor.id, x: actor.transform.position.x, y: actor.transform.position.y, z: actor.transform.position.z, yaw: actor.transform.yaw, health: actor.health, stamina: actor.stamina, flags: actor.transform.flags })); return Object.freeze({ tick: this.clock.tick, revision: this.#revision, actors: Object.freeze(actors), checksum: checksumP(actors) }); }

  restoreWorld(snapshot: WorldSnapshotP): void {
    this.#ensureLive(); if (checksumP(snapshot.actors) !== snapshot.checksum) throw new Error('invalid world snapshot checksum');
    const current = new Map(this.world.actors().map(actor => [actor.id, actor]));
    for (const actor of snapshot.actors) { const existing = current.get(actor.id); if (!existing) continue; this.world.updateActor(actor.id, { transform: { ...existing.transform, position: { x: actor.x, y: actor.y, z: actor.z }, yaw: actor.yaw, flags: actor.flags }, health: Math.max(0, Math.min(existing.maxHealth, actor.health)), stamina: Math.max(0, Math.min(existing.maxStamina, actor.stamina)) }, snapshot.tick); }
    this.clock.reset(snapshot.tick, snapshot.tick / this.clock.config.hz); this.#revision = Math.max(0, integerP(snapshot.revision));
  }
  async save(slot: string): Promise<void> { this.#ensureLive(); const snapshot = this.worldSnapshot(); await this.persistence.save(slot, { runtime: this.snapshot(), world: snapshot }, this.clock.tick); }
  async load(slot: string): Promise<boolean> { this.#ensureLive(); const save = await this.persistence.load(slot); if (!save) return false; const world = save.state.world as WorldSnapshotP | undefined; if (world) this.restoreWorld(world); return true; }
  attachNextGen(facade: { step: (deltaSeconds: number) => unknown; digest: () => number; snapshot: () => unknown }): void { this.#nextGenAttached = facade; }
  nextGenDigest(): number { return this.#nextGenAttached?.digest() ?? 0; }
  nextGenStep(deltaSeconds: number): unknown { return this.#nextGenAttached?.step(deltaSeconds); }
  nextGenSnapshot(): unknown { return this.#nextGenAttached?.snapshot(); }
  stats(): ProductionRuntimeStatsP { return Object.freeze({ frame: this.#frame, lifecycle: this.#lifecycle, revision: this.#revision, clock: this.clock.state, world: this.world.stats(), network: this.network.stats(), assets: this.assets.stats(), diagnostics: this.diagnostics.stats(), events: this.events.stats(), migration: this.migration.stats(), digest: checksumP({ frame: this.#frame, revision: this.#revision, world: this.world.digest(), network: this.network.stats().checksum, assets: this.assets.digest(), migration: this.migration.digest(), nextGen: this.nextGenDigest() }) }); }
  dispose(): void { if (this.#disposed) return; if (this.#lifecycle === 'running' || this.#lifecycle === 'paused') this.stop(); this.#disposed = true; this.assets.dispose(); this.events.clear(); this.#transition('disposed'); }

  #recordSnapshotIfNeeded(): void { if (this.clock.tick % 6 === 0) this.network.recordSnapshot(this.worldSnapshot()); }
  #simulateStep(tick: number, dt: number, _simulationSeconds: number, sample: ReturnType<ProductionInputPipeline['process']>, interests: readonly InterestSourceP[]): void { this.world.updateInterests(interests, tick); const player = this.world.get(1); if (player) { const speed = sample.sprint ? 7 : 4; const nextVelocity = { x: sample.moveX * speed, y: player.transform.velocity.y, z: sample.moveZ * speed }; const moving = Math.abs(nextVelocity.x) + Math.abs(nextVelocity.z) > 0.0001; this.world.updateActor(1, { transform: { ...player.transform, velocity: nextVelocity, position: { x: player.transform.position.x + nextVelocity.x * dt, y: player.transform.position.y + nextVelocity.y * dt, z: player.transform.position.z + nextVelocity.z * dt }, yaw: moving ? Math.atan2(nextVelocity.x, Math.max(0.0001, nextVelocity.z)) : player.transform.yaw } }, tick); } for (const command of this.world.drainCommands(64)) this.#executeCommand(command, tick); this.world.emitEvent(tick, 'simulation:tick', 'production', undefined, { actors: this.world.count(), input: sample.sequence }); }
  #executeCommand(command: WorldCommandP, tick: number): void { if (command.kind === 'despawn') this.world.despawn(command.actorId, tick, 'command'); if (command.kind === 'damage') { const actor = this.world.get(command.actorId); const amount = Number(command.payload.amount ?? 0); if (actor) this.world.updateActor(actor.id, { health: Math.max(0, actor.health - Math.max(0, Number.isFinite(amount) ? amount : 0)) }, tick); } }
  #applyInput(input: Partial<InputActionStateP>): void { if (input.moveX !== undefined) this.input.setAxis('moveX', Number(input.moveX)); if (input.moveZ !== undefined) this.input.setAxis('moveZ', Number(input.moveZ)); if (input.lookX !== undefined) this.input.setAxis('lookX', Number(input.lookX)); if (input.lookY !== undefined) this.input.setAxis('lookY', Number(input.lookY)); for (const action of ['jump', 'sprint', 'dodge', 'primary', 'secondary', 'interact', 'pause'] as const) if (input[action] !== undefined) input[action] ? this.input.press(action) : this.input.release(action); }
  #budget(input: Partial<FrameBudgetP> | undefined, durations: Map<ProductionPhase, number>, frameStarted: number): FrameBudgetP { const fallback = (name: ProductionPhase): number => durations.get(name) ?? 0; const targetMs = Math.max(1, input?.targetMs ?? (this.render.plan.tier === 'low' || this.render.plan.tier === 'safe' ? 33.3 : 16.6)); const totalMs = Math.max(0, input?.totalMs ?? nowP() - frameStarted); return Object.freeze({ inputMs: Math.max(0, input?.inputMs ?? fallback('input')), simulationMs: Math.max(0, input?.simulationMs ?? fallback('simulation')), worldMs: Math.max(0, input?.worldMs ?? fallback('world')), networkMs: Math.max(0, input?.networkMs ?? fallback('network')), assetMs: Math.max(0, input?.assetMs ?? fallback('assets')), renderMs: Math.max(0, input?.renderMs ?? fallback('render')), telemetryMs: Math.max(0, input?.telemetryMs ?? fallback('telemetry')), totalMs, targetMs }); }
  #transition(next: ProductionLifecycle): void { const previous = this.#lifecycle; this.#lifecycle = next; this.events.emit('runtime:lifecycle', { previous, next }); }
  #ensureLive(): void { if (this.#disposed || this.#lifecycle === 'disposed') throw new Error('production runtime disposed'); }
  #ensureRunning(): void { this.#ensureLive(); if (this.#lifecycle === 'created' || this.#lifecycle === 'stopped') this.boot(); if (this.#lifecycle !== 'running') throw new Error(`runtime is not running: ${this.#lifecycle}`); }
}
function phaseBudget(phase: ProductionPhase): number { return { input: 1, simulation: 4, world: 3, network: 2, assets: 3, render: 8, telemetry: 1 }[phase]; }
export function createProductionRuntime(options: ProductionRuntimeOptionsP = {}): ProductionRuntime { return new ProductionRuntime(options); }
