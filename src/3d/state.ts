import { WORLD_DEFAULTS, isQualityLevel, type QualityLevel } from './config.ts';
import { gameEvents, type EventBus } from './eventBus.ts';

export type GamePhase = 'boot' | 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'disposing';

export interface GameStateShape {
  readonly quality: QualityLevel;
  readonly isLoading: boolean;
  readonly loadProgress: number;
  readonly currentPhase: GamePhase;
  readonly error: string | null;
  readonly frame: number;
  readonly worldDay: number;
  readonly worldMinute: number;
}

export type StateKey = keyof GameStateShape;
export interface StateChange<T extends StateKey = StateKey> { readonly key: T; readonly value: GameStateShape[T]; readonly previous: GameStateShape[T]; readonly changedAt: number; }
export type StateListener<K extends StateKey> = (change: StateChange<K>) => void;

export class GameState {
  private readonly listeners = new Map<StateKey, Set<StateListener<any>>>();
  private readonly events: EventBus;
  private values: GameStateShape;

  constructor(options: { events?: EventBus; initial?: Partial<GameStateShape> } = {}) {
    this.events = options.events ?? gameEvents;
    this.values = Object.freeze({
      quality: WORLD_DEFAULTS.DEFAULT_QUALITY as QualityLevel,
      isLoading: true,
      loadProgress: 0,
      currentPhase: 'boot',
      error: null,
      frame: 0,
      worldDay: 0,
      worldMinute: 432,
      ...options.initial,
    });
    if (!isQualityLevel(this.values.quality)) throw new Error('invalid initial quality level');
  }

  get<K extends StateKey>(key: K): GameStateShape[K] { return this.values[key]; }
  get snapshot(): GameStateShape { return this.values; }

  set<K extends StateKey>(key: K, value: GameStateShape[K]): boolean {
    if (this.values[key] === value) return false;
    const previous = this.values[key];
    this.values = Object.freeze({ ...this.values, [key]: value });
    const change = Object.freeze({ key, value, previous, changedAt: Date.now() }) as StateChange<K>;
    this.listeners.get(key)?.forEach(listener => listener(change));
    this.events.emit(`state:${String(key)}`, change);
    return true;
  }

  update(patch: Partial<GameStateShape>): number {
    let changed = 0;
    for (const key of Object.keys(patch) as StateKey[]) {
      const value = patch[key];
      if (value !== undefined && this.set(key, value as GameStateShape[typeof key])) changed += 1;
    }
    return changed;
  }

  subscribe<K extends StateKey>(key: K, listener: StateListener<K>): () => void {
    const bucket = this.listeners.get(key) ?? new Set<StateListener<any>>();
    bucket.add(listener);
    this.listeners.set(key, bucket);
    return () => {
      bucket.delete(listener);
      if (bucket.size === 0) this.listeners.delete(key);
    };
  }

  patchProgress(progress: number): boolean { return this.set('loadProgress', Math.max(0, Math.min(1, progress))); }

  advanceFrame(): void { this.set('frame', this.values.frame + 1); }
  fail(message: string): void { this.update({ error: message, isLoading: false, currentPhase: 'error' }); }
  clearError(): void { this.set('error', null); }
  beginLoading(): void { this.update({ isLoading: true, loadProgress: 0, currentPhase: 'loading', error: null }); }
  finishLoading(): void { this.update({ isLoading: false, loadProgress: 1, currentPhase: 'ready', error: null }); }
  beginPlay(): void { this.update({ isLoading: false, currentPhase: 'playing' }); }
  pause(): void { if (this.values.currentPhase === 'playing') this.set('currentPhase', 'paused'); }
  resume(): void { if (this.values.currentPhase === 'paused') this.set('currentPhase', 'playing'); }
  dispose(): void { this.update({ currentPhase: 'disposing', isLoading: false }); this.listeners.clear(); }
}

export const gameState = new GameState();
