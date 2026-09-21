/** Production TypeScript owner for src/3d/state.js. */
import { gameEvents, type EventHandler } from './eventBus.ts';
import { WORLD_DEFAULTS, type QualityLevel } from './config.ts';

export type GamePhase =
  | 'boot'
  | 'phase0-architecture'
  | 'phase1-scene'
  | 'ready'
  | 'error';

export interface GameStateShape {
  quality: QualityLevel;
  isLoading: boolean;
  loadProgress: number;
  currentPhase: GamePhase;
  error: string | null;
}

export interface GameStateEvent {
  readonly value: unknown;
  readonly previous: unknown;
}

export class GameState {
  private readonly _state: GameStateShape;

  constructor(private readonly events = gameEvents) {
    this._state = {
      quality: WORLD_DEFAULTS.DEFAULT_QUALITY,
      isLoading: true,
      loadProgress: 0,
      currentPhase: 'boot',
      error: null,
    };
  }

  get<K extends keyof GameStateShape>(key: K): GameStateShape[K] {
    return this._state[key];
  }

  set<K extends keyof GameStateShape>(key: K, value: GameStateShape[K]): void {
    const previous = this._state[key];
    if (Object.is(previous, value)) return;
    this._state[key] = value;
    this.events.emit<GameStateEvent>(`state:${key}`, { value, previous });
  }

  subscribe<K extends keyof GameStateShape>(key: K, handler: EventHandler<GameStateEvent>): () => void {
    return this.events.on<GameStateEvent>(`state:${key}`, handler);
  }

  snapshot(): Readonly<GameStateShape> {
    return Object.freeze({ ...this._state });
  }
}

export const gameState = new GameState();
export type GameStateSnapshot = Readonly<GameStateShape>;
