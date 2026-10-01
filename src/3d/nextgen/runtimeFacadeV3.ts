/** Unified orchestration layer for the next-generation runtime services. */

import { RuntimeKernel, RuntimeWorld, type RuntimeSnapshot } from './runtimeKernel';
import { AiBrain, type AiContext, type AiDecision, type AiStimulus } from './aiSimulation';
import { CombatSimulation, createCombatStats, type CombatantId, type CombatEvent } from './combatSimulation';
import { NavigationRuntimeV3, type NavPath } from './navigationRuntimeV3';
import { AssetStreamingV3, type AssetRequest, type AssetRecord, type StreamingBudget } from './assetStreamingV3';
import { PlayerPredictor, type PlayerInput, type PlayerState, type ReconciliationResult } from './playerPrediction';
import { RuntimeTelemetryV3, createDefaultTelemetry, type FrameTelemetry } from './runtimeTelemetryV3';
import { SaveSystemV3, createWorldSaveState, registerDefaultSaveMigrations, type WorldSaveState } from './saveSystemV3';
import { SnapshotHistory, type NetworkSnapshot, type NetworkDelta, snapshotDelta, applyDelta } from './networkProtocolV3';
import { WorkerTaskBroker } from './workerProtocolV3';
import { CombatPresentationDirector, type CombatPresentationDevice, type CombatPresentationFrame, type CombatPresentationConfig } from './combatPresentationV1';
import { CombatPresentationQueue, type CombatPresentationDispatch, type CombatPresentationQueueConfig } from './combatPresentationQueueV1';
import { projectCombatAccessibility, type CombatAccessibilityMode, type CombatAccessibilitySignal } from './combatPresentationAccessibilityV1';
import type { CombatListenerPose } from './combatPresentationSpatialAudioV1';
import { createCombatPresentationTelemetry, type CombatPresentationTelemetry, type CombatPresentationTelemetrySummary } from './combatPresentationTelemetryV1';
import { resolveCombatPresentationQuality, tuneCombatPresentationCue, type CombatPresentationQuality, type CombatPresentationQualityDecision } from './combatPresentationQualityV1';
import { CombatPresentationBus, type CombatPresentationConsumer, type CombatPresentationBusReport } from './combatPresentationBusV1';

export interface NextGenConfig {
  fixedDeltaSeconds: number;
  navigationWidth: number;
  navigationHeight: number;
  navigationCellSize: number;
  assetBudget?: Partial<StreamingBudget>;
  snapshotHistory: number;
  combatPresentation?: Partial<CombatPresentationConfig>;
  combatPresentationQueue?: Partial<CombatPresentationQueueConfig>;
}

export interface RuntimeFrameResult {
  tick: number;
  snapshot: RuntimeSnapshot;
  combatEvents: readonly CombatEvent[];
  aiDecisions: readonly AiDecision[];
  streamResults: readonly AssetRecord[];
  presentationFrame: CombatPresentationFrame;
  presentationDispatches: readonly CombatPresentationDispatch[];
  presentationAccessibility: readonly CombatAccessibilitySignal[];
  presentationQuality: CombatPresentationQualityDecision;
  presentationTelemetry: CombatPresentationTelemetrySummary;
  presentationBus: CombatPresentationBusReport;
}

const DEFAULT_CONFIG: NextGenConfig = {
  fixedDeltaSeconds: 1 / 60,
  navigationWidth: 128,
  navigationHeight: 128,
  navigationCellSize: 2,
  snapshotHistory: 32,
  combatPresentation: Object.freeze({}),
  combatPresentationQueue: Object.freeze({}),
};

export class NextGenRuntimeV3 {
  readonly config: NextGenConfig;
  readonly kernel: RuntimeKernel;
  readonly world: RuntimeWorld;
  readonly navigation: NavigationRuntimeV3;
  readonly combat: CombatSimulation;
  readonly assets: AssetStreamingV3;
  readonly telemetry: RuntimeTelemetryV3;
  readonly networkHistory: SnapshotHistory;
  readonly workers: WorkerTaskBroker;
  readonly saveSystem: SaveSystemV3<WorldSaveState>;
  readonly combatPresentation: CombatPresentationDirector;
  readonly combatPresentationQueue: CombatPresentationQueue;
  readonly combatPresentationTelemetry: CombatPresentationTelemetry;
  readonly combatPresentationBus: CombatPresentationBus;
  #presentationDevice: CombatPresentationDevice = 'virtual';
  #presentationReducedMotion = false;
  #presentationMuted = false;
  #presentationAccessibility: CombatAccessibilityMode = 'standard';
  #presentationListener: CombatListenerPose | null = null;
  #brains = new Map<number, AiBrain>();
  #predictors = new Map<number, PlayerPredictor>();
  #lastNetworkSnapshot: NetworkSnapshot | null = null;
  #networkBaselineSnapshot: NetworkSnapshot | null = null;
  #worldSeed = 1;

  constructor(config?: Partial<NextGenConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.kernel = new RuntimeKernel(this.config.fixedDeltaSeconds);
    this.world = this.kernel.world;
    this.navigation = new NavigationRuntimeV3({ width: this.config.navigationWidth, height: this.config.navigationHeight, cellSize: this.config.navigationCellSize, maxSearchNodes: 8192, diagonal: true });
    this.combat = new CombatSimulation();
    this.assets = new AssetStreamingV3(this.config.assetBudget);
    this.telemetry = createDefaultTelemetry();
    this.networkHistory = new SnapshotHistory(this.config.snapshotHistory);
    this.workers = new WorkerTaskBroker();
    this.saveSystem = new SaveSystemV3();
    this.combatPresentation = new CombatPresentationDirector(this.config.combatPresentation);
    this.combatPresentationQueue = new CombatPresentationQueue(this.config.combatPresentationQueue);
    this.combatPresentationTelemetry = createCombatPresentationTelemetry();
    this.combatPresentationBus = new CombatPresentationBus();
    registerDefaultSaveMigrations(this.saveSystem);
    this.registerDefaultWorkers();
  }

  setWorldSeed(seed: number): void { this.#worldSeed = seed >>> 0; }
  get worldSeed(): number { return this.#worldSeed; }

  createPlayer(initial?: Partial<PlayerState>): number {
    const entity = this.world.createEntity();
    const predictor = new PlayerPredictor(initial, { fixedDeltaSeconds: this.config.fixedDeltaSeconds });
    this.#predictors.set(entity, predictor);
    this.world.setTransform(entity, { position: predictor.state.position, rotation: { x: 0, y: predictor.state.yaw, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
    this.world.setVelocity(entity, { linear: predictor.state.velocity, angular: { x: 0, y: 0, z: 0 } });
    const combatId = entity as unknown as CombatantId;
    this.combat.spawn(combatId, predictor.state.position, createCombatStats());
    return entity;
  }

  getPlayerState(entityId: number): PlayerState | null {
    return this.#predictors.get(entityId)?.state ?? null;
  }

  createAi(entityId: number): AiBrain {
    if (!this.world.hasEntity(entityId as never)) throw new Error(`cannot attach AI to unknown entity ${entityId}`);
    const brain = new AiBrain();
    this.#brains.set(entityId, brain);
    return brain;
  }

  queuePlayerInput(entityId: number, input: PlayerInput): void { this.#predictors.get(entityId)?.pushInput(input); }

  reconcilePlayer(entityId: number, authoritative: { tick: number; state: PlayerState }): ReconciliationResult | null { return this.#predictors.get(entityId)?.reconcile(authoritative) ?? null; }

  startCombatAttack(entityId: number, attackId: string): boolean { return this.combat.startAttack(entityId as unknown as CombatantId, attackId); }
  setCombatPose(entityId: number, position: PlayerState['position'], forward: PlayerState['position']): void { this.combat.setPose(entityId as unknown as CombatantId, position, forward); }
  setBlocking(entityId: number, blocking: boolean): void { this.combat.setBlocking(entityId as unknown as CombatantId, blocking); }
  setPresentationDevice(device: CombatPresentationDevice): void { this.#presentationDevice = device; }
  setReducedMotion(reduced: boolean): void { this.#presentationReducedMotion = reduced; }
  setMuted(muted: boolean): void { this.#presentationMuted = muted; }
  setPresentationAccessibility(mode: CombatAccessibilityMode): void { this.#presentationAccessibility = mode; }
  setPresentationListener(listener: CombatListenerPose | null): void { this.#presentationListener = listener; }
  subscribeCombatPresentationConsumer(consumer: CombatPresentationConsumer): void { this.combatPresentationBus.subscribe(consumer); }
  unsubscribeCombatPresentationConsumer(id: string): boolean { return this.combatPresentationBus.unsubscribe(id); }

  perceive(entityId: number, stimulus: AiStimulus): void { this.#brains.get(entityId)?.perceive(stimulus, this.kernel.clock.tick); }

  decideAi(entityId: number, context: Omit<AiContext, 'id' | 'memories' | 'mode'>): AiDecision | null {
    const brain = this.#brains.get(entityId);
    return brain?.tick(this.kernel.clock.tick, { ...context, id: entityId }) ?? null;
  }

  findPath(start: number, goal: number): NavPath { return this.navigation.findPath(start, goal); }
  requestAsset<T>(request: AssetRequest<T>): AssetRecord<T> { return this.assets.request(request); }

  async frame(fetcher: typeof fetch = fetch): Promise<RuntimeFrameResult> {
    const before = performance.now();
    const snapshot = this.kernel.step();
    const streamResults = await this.assets.pump(fetcher);
    const combatEvents = this.combat.step();
    const listenerPlayer = [...this.#predictors.values()][0]?.state;
    const listener = this.#presentationListener ?? (listenerPlayer ? { position: listenerPlayer.position, forward: { x: Math.sin(listenerPlayer.yaw), y: 0, z: Math.cos(listenerPlayer.yaw) } } : undefined);
    const presentationFrame = this.combatPresentation.ingest(combatEvents, { states: this.combat.snapshot(), device: this.#presentationDevice, reducedMotion: this.#presentationReducedMotion, muted: this.#presentationMuted, listener });
        const presentationQuality = resolveCombatPresentationQuality({ frameP95Ms: this.telemetry.summarize().frameP95Ms, pendingQueue: this.combatPresentationQueue.pendingCount(), droppedCues: presentationFrame.droppedCues, reducedMotion: this.#presentationReducedMotion, device: this.#presentationDevice });
    this.combatPresentationQueue.clear();
    const qualityCues = presentationFrame.cues.map((cue) => tuneCombatPresentationCue(cue, presentationQuality));
    this.combatPresentationQueue.enqueue(qualityCues, this.#presentationDevice, presentationFrame.tick);
    const presentationDispatches = this.combatPresentationQueue.dispatch(presentationFrame.tick);
    this.combatPresentationTelemetry.record(presentationFrame, presentationDispatches, this.combatPresentationQueue.pendingCount());
    const presentationAccessibility = projectCombatAccessibility(qualityCues, { mode: this.#presentationAccessibility, device: this.#presentationDevice });
    const presentationBus = this.combatPresentationBus.dispatch(presentationDispatches, presentationAccessibility, presentationFrame.tick);
    const aiDecisions: AiDecision[] = [];
    for (const [entityId, brain] of this.#brains) {
      const player = this.#predictors.get(entityId)?.state;
      if (!player) continue;
      const decision = brain.tick(this.kernel.clock.tick, { id: entityId, position: player.position, forward: { x: Math.sin(player.yaw), y: 0, z: Math.cos(player.yaw) }, healthRatio: 1, staminaRatio: player.stamina / 100, allyCount: 0, enemyCount: 0, needs: { survival: 0.6, combat: 0.4, curiosity: 0.35, social: 0.1, duty: 0.7, fatigue: 0.25 } });
      aiDecisions.push(decision);
    }
    const elapsed = performance.now() - before;
    const frame: FrameTelemetry = { tick: snapshot.tick, cpuMs: elapsed, renderMs: 0, simulationMs: elapsed, networkMs: 0, streamingMs: 0, gpuMs: null, entityCount: this.world.entityCount(), drawCalls: 0, triangles: 0 };
    this.telemetry.record(frame);
    return { tick: snapshot.tick, snapshot, combatEvents, aiDecisions, streamResults, presentationFrame, presentationDispatches, presentationAccessibility, presentationQuality, presentationTelemetry: this.combatPresentationTelemetry.summary(), presentationBus };

  }

  buildNetworkSnapshot(entities: readonly NetworkSnapshot['entities'][number][]): NetworkSnapshot {
    const previous = this.#lastNetworkSnapshot;
    const snapshot: NetworkSnapshot = { version: 3, serverTick: this.kernel.clock.tick, baselineTick: previous?.serverTick ?? 0, ackSequence: 0, entities: [...entities].sort((a, b) => a.id - b.id) };
    this.#networkBaselineSnapshot = previous;
    this.#lastNetworkSnapshot = snapshot;
    this.networkHistory.push(snapshot);
    return snapshot;
  }

  buildNetworkDelta(current: NetworkSnapshot): NetworkDelta {
    const baseline = this.#networkBaselineSnapshot ?? this.networkHistory.find(current.serverTick - 1) ?? null;
    return snapshotDelta(baseline, current);
  }

  applyNetworkDelta(baseline: NetworkSnapshot, delta: NetworkDelta): NetworkSnapshot { return applyDelta(baseline, delta); }

  save(): Uint8Array {
    const state = createWorldSaveState(this.#worldSeed);
    state.tick = this.kernel.clock.tick;
    const player = [...this.#predictors.values()][0]?.state;
    if (player) state.player = { ...state.player, position: { ...player.position }, yaw: player.yaw, stamina: player.stamina };
    return this.saveSystem.encode(state, state.tick, this.#worldSeed);
  }

  load(bytes: Uint8Array): void {
    const decoded = this.saveSystem.decode(bytes);
    this.#worldSeed = decoded.header.worldSeed;
    this.kernel.clock.tick = decoded.header.createdTick;
    this.kernel.clock.simulationTime = decoded.header.createdTick * this.kernel.clock.fixedDeltaSeconds;
    const playerId = [...this.#predictors.keys()][0];
    if (playerId !== undefined) {
      const predictor = this.#predictors.get(playerId)!;
      predictor.reconcile({ tick: decoded.state.tick, state: { ...predictor.state, position: decoded.state.player.position, yaw: decoded.state.player.yaw, stamina: decoded.state.player.stamina } });
    }
  }

  summary() { return { tick: this.kernel.clock.tick, entities: this.world.entityCount(), assets: this.assets.stats(), telemetry: this.telemetry.summarize(), combatants: this.combat.snapshot().length, aiBrains: this.#brains.size, predictors: this.#predictors.size }; }

  private registerDefaultWorkers(): void {
    this.workers.register({ domain: 'navigation', operation: 'find-path', handle: (payload: { start: number; goal: number }) => this.findPath(payload.start, payload.goal) });
    this.workers.register({ domain: 'serialization', operation: 'validate-save', handle: (payload: Uint8Array) => this.saveSystem.validate(payload) });
    this.workers.register({ domain: 'simulation', operation: 'snapshot', handle: () => this.kernel.saveSnapshot() });
  }
}

export function createNextGenRuntime(config?: Partial<NextGenConfig>): NextGenRuntimeV3 { return new NextGenRuntimeV3(config); }
