import type { EntityId } from './types';
import { checksum } from './deterministic';

export type CommandKind =
  | 'move'
  | 'interact'
  | 'attack'
  | 'spawn'
  | 'despawn'
  | 'set-quality'
  | 'save'
  | 'load'
  | 'custom';

export interface Command<TPayload = unknown> {
  readonly id: string;
  readonly tick: number;
  readonly actor?: EntityId;
  readonly kind: CommandKind;
  readonly payload: TPayload;
}

export interface CommandResult<TValue = unknown> {
  readonly id: string;
  readonly applied: boolean;
  readonly tick: number;
  readonly value?: TValue;
  readonly reason?: string;
}

export type CommandReducer<TState, TPayload> = (state: TState, payload: TPayload, command: Command<TPayload>) => TState;

interface RegisteredReducer<TState> {
  readonly reducer: CommandReducer<TState, unknown>;
  readonly validate?: (payload: unknown) => boolean;
}

/** Deterministic command journal; the same sequence can be replayed to reproduce a world state. */
export class CommandJournal<TState> {
  #reducers = new Map<CommandKind, RegisteredReducer<TState>>();
  #commands: Command[] = [];
  #applied = new Set<string>();
  #tick = 0;

  register<TPayload>(kind: CommandKind, reducer: CommandReducer<TState, TPayload>, validate?: (payload: TPayload) => boolean): void {
    if (this.#reducers.has(kind)) throw new Error(`Command reducer already registered: ${kind}`);
    this.#reducers.set(kind, { reducer: reducer as CommandReducer<TState, unknown>, validate: validate as ((payload: unknown) => boolean) | undefined });
  }

  append<TPayload>(command: Omit<Command<TPayload>, 'tick'> & { readonly tick?: number }): Command<TPayload> {
    const tick = command.tick ?? this.#tick;
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Invalid command tick');
    if (this.#commands.some((item) => item.id === command.id)) throw new Error(`Duplicate command: ${command.id}`);
    const normalized = { ...command, tick } as Command<TPayload>;
    this.#commands.push(normalized);
    this.#commands.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
    this.#tick = Math.max(this.#tick, tick);
    return normalized;
  }

  apply(command: Command, state: TState): CommandResult<TState> {
    if (this.#applied.has(command.id)) return { id: command.id, applied: false, tick: command.tick, reason: 'already-applied' };
    const registered = this.#reducers.get(command.kind);
    if (!registered) return { id: command.id, applied: false, tick: command.tick, reason: 'reducer-missing' };
    if (registered.validate && !registered.validate(command.payload)) {
      return { id: command.id, applied: false, tick: command.tick, reason: 'validation-failed' };
    }
    const value = registered.reducer(state, command.payload, command);
    this.#applied.add(command.id);
    this.#tick = Math.max(this.#tick, command.tick);
    return { id: command.id, applied: true, tick: command.tick, value };
  }

  replay(initialState: TState): TState {
    let state = structuredClone(initialState);
    for (const command of this.#commands) {
      const result = this.apply(command, state);
      if (result.applied) state = result.value as TState;
    }
    return state;
  }

  commands(): readonly Command[] { return this.#commands.map((command) => structuredClone(command)); }
  pending(): readonly Command[] { return this.#commands.filter((command) => !this.#applied.has(command.id)).map((command) => structuredClone(command)); }
  tick(): number { return this.#tick; }
  resetApplied(): void { this.#applied.clear(); }
  clear(): void { this.#commands = []; this.#applied.clear(); this.#tick = 0; }
  digest(): string { return checksum({ tick: this.#tick, commands: this.#commands }); }
}
