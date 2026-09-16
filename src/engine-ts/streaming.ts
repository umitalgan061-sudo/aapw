import type { EntityId } from './types.js';
import { clamp, stableSort } from './deterministic.js';
import { ResourceScheduler, type ResourceKind } from './resourceScheduler.js';

export type StreamState = 'unknown' | 'queued' | 'loading' | 'resident' | 'cooldown' | 'evicted' | 'failed';
export type StreamKind = 'terrain' | 'vegetation' | 'fauna' | 'props' | 'audio' | 'vfx' | 'ui' | 'navigation';

export interface StreamChunk {
  readonly id: string;
  readonly kind: StreamKind;
  readonly center: readonly [number, number, number];
  readonly loadRadius: number;
  readonly unloadRadius: number;
  readonly priority: number;
  readonly bytes: number;
  readonly entities: number;
  readonly dependencies?: readonly string[];
  readonly state?: StreamState;
  readonly lastTouchedTick?: number;
}

export interface StreamCamera {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly velocityX?: number;
  readonly velocityZ?: number;
  readonly lookAheadSeconds?: number;
}

export interface StreamDecision {
  readonly id: string;
  readonly action: 'load' | 'retain' | 'unload' | 'retry' | 'skip';
  readonly score: number;
  readonly reason: string;
  readonly estimatedBytes: number;
  readonly estimatedEntities: number;
}

export interface StreamPlan {
  readonly decisions: readonly StreamDecision[];
  readonly loads: readonly string[];
  readonly unloads: readonly string[];
  readonly retries: readonly string[];
  readonly retained: readonly string[];
  readonly memoryBytes: number;
  readonly entityCount: number;
  readonly revision: number;
}

export interface StreamPlannerOptions {
  readonly maxLoadsPerFrame?: number;
  readonly maxUnloadsPerFrame?: number;
  readonly maxRetriesPerFrame?: number;
  readonly memoryBudgetBytes?: number;
  readonly entityBudget?: number;
  readonly directionLookAhead?: boolean;
  readonly retryCooldownTicks?: number;
  readonly scheduler?: ResourceScheduler;
}

interface RecordState {
  state: StreamState;
  failCount: number;
  nextRetryTick: number;
  lastDecisionTick: number;
}

const DEFAULTS = Object.freeze({ loads: 4, unloads: 6, retries: 2, memory: 512 * 1024 * 1024, entities: 100_000, cooldown: 30 });

export class StreamingPlanner {
  private readonly maxLoads: number;
  private readonly maxUnloads: number;
  private readonly maxRetries: number;
  private readonly memoryBudget: number;
  private readonly entityBudget: number;
  private readonly lookAhead: boolean;
  private readonly retryCooldown: number;
  private readonly scheduler: ResourceScheduler;
  private readonly states = new Map<string, RecordState>();
  private revision = 0;

  public constructor(options: StreamPlannerOptions = {}) {
    this.maxLoads = Math.max(1, Math.trunc(options.maxLoadsPerFrame ?? DEFAULTS.loads));
    this.maxUnloads = Math.max(1, Math.trunc(options.maxUnloadsPerFrame ?? DEFAULTS.unloads));
    this.maxRetries = Math.max(1, Math.trunc(options.maxRetriesPerFrame ?? DEFAULTS.retries));
    this.memoryBudget = Math.max(1, Math.trunc(options.memoryBudgetBytes ?? DEFAULTS.memory));
    this.entityBudget = Math.max(1, Math.trunc(options.entityBudget ?? DEFAULTS.entities));
    this.lookAhead = options.directionLookAhead ?? true;
    this.retryCooldown = Math.max(1, Math.trunc(options.retryCooldownTicks ?? DEFAULTS.cooldown));
    this.scheduler = options.scheduler ?? new ResourceScheduler();
  }

  public markState(id: string, state: StreamState, tick = 0): void {
    const current = this.states.get(id) ?? { state: 'unknown', failCount: 0, nextRetryTick: 0, lastDecisionTick: -1 };
    current.state = state;
    current.lastDecisionTick = tick;
    if (state === 'resident') current.failCount = 0;
    this.states.set(id, current);
  }

  public markFailure(id: string, tick: number): void {
    const current = this.states.get(id) ?? { state: 'unknown', failCount: 0, nextRetryTick: 0, lastDecisionTick: -1 };
    current.state = 'failed';
    current.failCount += 1;
    current.nextRetryTick = tick + this.retryCooldown * Math.min(8, current.failCount);
    current.lastDecisionTick = tick;
    this.states.set(id, current);
  }

  public plan(chunks: readonly StreamChunk[], camera: StreamCamera, tick = 0): StreamPlan {
    const normalized = chunks.map(chunk => Object.freeze({ ...chunk }));
    const requests = normalized.map(chunk => ({ id: chunk.id, kind: toResourceKind(chunk.kind), amount: chunk.bytes, priority: chunk.priority, critical: chunk.kind === 'terrain', pinned: this.stateFor(chunk.id) === 'resident', group: chunk.kind }));
    this.scheduler.resetFrameUsage();
    const schedule = this.scheduler.schedule(requests);
    let memory = 0;
    let entities = 0;
    for (const grant of schedule.grants) { memory += grant.granted; entities += normalized.find(chunk => chunk.id === grant.requestId)?.entities ?? 0; }
    memory = Math.min(memory, this.memoryBudget);
    entities = Math.min(entities, this.entityBudget);

    const candidates = normalized.map(chunk => this.score(chunk, camera, tick, memory, entities));
    const loadBudget = this.maxLoads;
    const unloadBudget = this.maxUnloads;
    const retryBudget = this.maxRetries;
    let loads = 0;
    let unloads = 0;
    let retries = 0;
    const decisions: StreamDecision[] = [];

    for (const candidate of stableSort(candidates, (a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
      const action = candidate.action;
      if (action === 'load' && loads >= loadBudget) { decisions.push({ ...candidate, action: 'skip', reason: 'load-budget' }); continue; }
      if (action === 'unload' && unloads >= unloadBudget) { decisions.push({ ...candidate, action: 'retain', reason: 'unload-budget' }); continue; }
      if (action === 'retry' && retries >= retryBudget) { decisions.push({ ...candidate, action: 'skip', reason: 'retry-budget' }); continue; }
      if (action === 'load') loads += 1;
      if (action === 'unload') unloads += 1;
      if (action === 'retry') retries += 1;
      decisions.push(candidate);
    }

    this.revision += 1;
    return Object.freeze({
      decisions: Object.freeze(decisions),
      loads: Object.freeze(decisions.filter(item => item.action === 'load').map(item => item.id)),
      unloads: Object.freeze(decisions.filter(item => item.action === 'unload').map(item => item.id)),
      retries: Object.freeze(decisions.filter(item => item.action === 'retry').map(item => item.id)),
      retained: Object.freeze(decisions.filter(item => item.action === 'retain').map(item => item.id)),
      memoryBytes: memory,
      entityCount: entities,
      revision: this.revision,
    });
  }

  public state(id: string): StreamState { return this.stateFor(id); }
  public snapshot(): Readonly<Record<string, RecordState>> {
    const snapshot: Record<string, RecordState> = {};
    for (const [id, state] of this.states) snapshot[id] = Object.freeze({ ...state });
    return Object.freeze(snapshot);
  }
  public dispose(): void { this.states.clear(); }

  private score(chunk: StreamChunk, camera: StreamCamera, tick: number, memory: number, entities: number): StreamDecision {
    const state = this.states.get(chunk.id)?.state ?? chunk.state ?? 'unknown';
    const center = this.predictedCenter(camera);
    const dx = chunk.center[0] - center.x;
    const dz = chunk.center[2] - center.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const score = clamp(chunk.priority * 10 - distance * 0.1 + kindWeight(chunk.kind), -1000, 1000);
    const insideLoad = distance <= Math.max(1, chunk.loadRadius);
    const outsideUnload = distance >= Math.max(chunk.loadRadius, chunk.unloadRadius);
    const retryable = state === 'failed' && (this.states.get(chunk.id)?.nextRetryTick ?? Infinity) <= tick;
    if (retryable) return decision(chunk, 'retry', score + 50, 'retry-window');
    if (state === 'resident' && outsideUnload) return decision(chunk, 'unload', score - 20, 'outside-unload-radius');
    if (state === 'resident') return decision(chunk, 'retain', score, 'resident-hysteresis');
    if (insideLoad && memory + chunk.bytes <= this.memoryBudget && entities + chunk.entities <= this.entityBudget) return decision(chunk, 'load', score + 40, 'inside-load-radius');
    if (state === 'loading' || state === 'queued') return decision(chunk, 'retain', score, 'already-loading');
    return decision(chunk, 'skip', score, memory > this.memoryBudget ? 'memory-budget' : 'outside-load-radius');
  }

  private stateFor(id: string): StreamState { return this.states.get(id)?.state ?? 'unknown'; }
  private predictedCenter(camera: StreamCamera): { x: number; z: number } {
    if (!this.lookAhead) return { x: camera.x, z: camera.z };
    const seconds = clamp(camera.lookAheadSeconds ?? 0.35, 0, 2);
    return { x: camera.x + (camera.velocityX ?? 0) * seconds, z: camera.z + (camera.velocityZ ?? 0) * seconds };
  }
}

const decision = (chunk: StreamChunk, action: StreamDecision['action'], score: number, reason: string): StreamDecision => Object.freeze({ id: chunk.id, action, score, reason, estimatedBytes: Math.max(0, Math.trunc(chunk.bytes)), estimatedEntities: Math.max(0, Math.trunc(chunk.entities)) });

const kindWeight = (kind: StreamKind): number => ({ terrain: 80, navigation: 40, fauna: 25, vegetation: 18, props: 12, vfx: 10, audio: 8, ui: 4 }[kind]);
const toResourceKind = (kind: StreamKind): ResourceKind => kind === 'audio' ? 'audio' : kind === 'terrain' || kind === 'vegetation' || kind === 'fauna' || kind === 'props' || kind === 'vfx' || kind === 'navigation' ? 'memory' : 'cpu';

export const createStreamChunk = (input: Partial<StreamChunk> & Pick<StreamChunk, 'id' | 'kind'>): StreamChunk => Object.freeze({ id: input.id, kind: input.kind, center: input.center ?? [0, 0, 0], loadRadius: Math.max(1, input.loadRadius ?? 100), unloadRadius: Math.max(input.loadRadius ?? 100, input.unloadRadius ?? 140), priority: Number.isFinite(input.priority) ? Number(input.priority) : 0, bytes: Math.max(0, Math.trunc(input.bytes ?? 0)), entities: Math.max(0, Math.trunc(input.entities ?? 0)), ...(input.dependencies ? { dependencies: Object.freeze([...input.dependencies]) } : {}), ...(input.state ? { state: input.state } : {}), ...(input.lastTouchedTick === undefined ? {} : { lastTouchedTick: input.lastTouchedTick }) });

export const streamEntityKey = (entity: EntityId, layer: StreamKind): string => `${layer}:${String(entity)}`;
