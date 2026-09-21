/**
 * Session state V3.
 *
 * Provides transactional state updates, bounded event history, checkpoints,
 * rollback, schema versioning and persistence codec hooks.
 *
 * @module sessionStateV3
 */

export type SessionPhase =
  | 'boot'
  | 'active'
  | 'paused'
  | 'recovering'
  | 'ending'
  | 'ended';

export type SessionRecord = {
  readonly sessionId: string;
  readonly schemaVersion: number;
  readonly seed: number;
  readonly phase: SessionPhase;
  readonly revision: number;
  readonly simulationTick: number;
  readonly updatedAtMs: number;
  readonly player: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly health: number;
    readonly stamina: number;
    readonly inventory: readonly string[];
  };
  readonly world: {
    readonly weather: string;
    readonly dayTime: number;
    readonly activeQuests: readonly string[];
    readonly discovered: readonly string[];
  };
  readonly flags: Readonly<Record<string, boolean>>;
};

export type SessionPatch = {
  readonly phase?: SessionPhase;
  readonly simulationTick?: number;
  readonly player?: Partial<SessionRecord['player']>;
  readonly world?: Partial<SessionRecord['world']>;
  readonly flags?: Readonly<Record<string, boolean>>;
};

export type SessionEvent = {
  readonly id: number;
  readonly revision: number;
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly timestampMs: number;
};

export type SessionCheckpoint = {
  readonly id: string;
  readonly revision: number;
  readonly snapshot: SessionRecord;
  readonly createdAtMs: number;
};

export type SessionCodec<T = string> = {
  encode: (snapshot: SessionRecord) => T;
  decode: (payload: T) => SessionRecord;
};

export type SessionOptions = {
  readonly sessionId: string;
  readonly seed: number;
  readonly schemaVersion?: number;
  readonly clock?: () => number;
  readonly maxEvents?: number;
  readonly maxCheckpoints?: number;
};

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cloneRecord(record: SessionRecord): SessionRecord {
  return {
    ...record,
    player: {
      ...record.player,
      inventory: [...record.player.inventory],
    },
    world: {
      ...record.world,
      activeQuests: [...record.world.activeQuests],
      discovered: [...record.world.discovered],
    },
    flags: { ...record.flags },
  };
}

function createInitialRecord(options: SessionOptions, now: number): SessionRecord {
  return {
    sessionId: options.sessionId.trim(),
    schemaVersion: Math.max(1, Math.floor(options.schemaVersion ?? 1)),
    seed: Math.trunc(options.seed),
    phase: 'boot',
    revision: 0,
    simulationTick: 0,
    updatedAtMs: now,
    player: {
      x: 0,
      y: 0,
      z: 0,
      health: 100,
      stamina: 100,
      inventory: [],
    },
    world: {
      weather: 'clear',
      dayTime: 12,
      activeQuests: [],
      discovered: [],
    },
    flags: {},
  };
}

export class SessionStateV3 {
  readonly #clock: () => number;
  readonly #maxEvents: number;
  readonly #maxCheckpoints: number;
  readonly #events: SessionEvent[] = [];
  readonly #checkpoints: SessionCheckpoint[] = [];

  #record: SessionRecord;
  #nextEventId = 1;

  constructor(options: SessionOptions) {
    if (!options.sessionId.trim()) {
      throw new Error('Session id cannot be empty');
    }
    this.#clock = options.clock ?? (() => Date.now());
    this.#maxEvents = clamp(Math.floor(options.maxEvents ?? 2048), 64, 100_000);
    this.#maxCheckpoints = clamp(Math.floor(options.maxCheckpoints ?? 24), 2, 256);
    this.#record = createInitialRecord(options, this.#clock());
  }

  get snapshot(): SessionRecord {
    return cloneRecord(this.#record);
  }

  get revision(): number {
    return this.#record.revision;
  }

  get phase(): SessionPhase {
    return this.#record.phase;
  }

  patch(patch: SessionPatch, eventKind = 'state.patch'): SessionRecord {
    const previous = this.#record;
    const next: SessionRecord = {
      ...previous,
      ...patch,
      revision: previous.revision + 1,
      updatedAtMs: this.#clock(),
      player: {
        ...previous.player,
        ...(patch.player ?? {}),
        inventory: patch.player?.inventory
          ? [...patch.player.inventory]
          : [...previous.player.inventory],
      },
      world: {
        ...previous.world,
        ...(patch.world ?? {}),
        activeQuests: patch.world?.activeQuests
          ? [...patch.world.activeQuests]
          : [...previous.world.activeQuests],
        discovered: patch.world?.discovered
          ? [...patch.world.discovered]
          : [...previous.world.discovered],
      },
      flags: {
        ...previous.flags,
        ...(patch.flags ?? {}),
      },
    };

    this.#validate(next);
    this.#record = next;
    this.appendEvent(eventKind, {
      revision: next.revision,
      phase: next.phase,
      simulationTick: next.simulationTick,
    });
    return this.snapshot;
  }

  transact(
    mutator: (draft: SessionRecord) => SessionRecord,
    eventKind = 'state.transaction',
  ): SessionRecord {
    const draft = cloneRecord(this.#record);
    const candidate = mutator(draft);
    const next: SessionRecord = {
      ...candidate,
      revision: this.#record.revision + 1,
      updatedAtMs: this.#clock(),
      player: {
        ...candidate.player,
        inventory: [...candidate.player.inventory],
      },
      world: {
        ...candidate.world,
        activeQuests: [...candidate.world.activeQuests],
        discovered: [...candidate.world.discovered],
      },
      flags: { ...candidate.flags },
    };
    this.#validate(next);
    this.#record = next;
    this.appendEvent(eventKind, {
      revision: next.revision,
      phase: next.phase,
    });
    return this.snapshot;
  }

  appendEvent(
    kind: string,
    payload: Readonly<Record<string, unknown>> = {},
  ): SessionEvent {
    const event: SessionEvent = {
      id: this.#nextEventId++,
      revision: this.#record.revision,
      kind: kind.trim() || 'event',
      payload: { ...payload },
      timestampMs: this.#clock(),
    };
    this.#events.push(event);
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
    }
    return { ...event, payload: { ...event.payload } };
  }

  events(sinceRevision = -1): readonly SessionEvent[] {
    return this.#events
      .filter((event) => event.revision > sinceRevision)
      .map((event) => ({ ...event, payload: { ...event.payload } }));
  }

  checkpoint(id = `checkpoint:${this.#record.revision}`): SessionCheckpoint {
    const checkpoint: SessionCheckpoint = {
      id,
      revision: this.#record.revision,
      snapshot: this.snapshot,
      createdAtMs: this.#clock(),
    };
    this.#checkpoints.push(checkpoint);
    while (this.#checkpoints.length > this.#maxCheckpoints) {
      this.#checkpoints.shift();
    }
    return {
      ...checkpoint,
      snapshot: cloneRecord(checkpoint.snapshot),
    };
  }

  checkpoints(): readonly SessionCheckpoint[] {
    return this.#checkpoints.map((checkpoint) => ({
      ...checkpoint,
      snapshot: cloneRecord(checkpoint.snapshot),
    }));
  }

  restoreCheckpoint(id: string): SessionRecord {
    const checkpoint = this.#checkpoints.find((item) => item.id === id);
    if (!checkpoint) {
      throw new Error(`Session checkpoint not found: ${id}`);
    }

    const restored: SessionRecord = {
      ...cloneRecord(checkpoint.snapshot),
      revision: this.#record.revision + 1,
      updatedAtMs: this.#clock(),
    };
    this.#validate(restored);
    this.#record = restored;
    this.appendEvent('state.restore', {
      checkpointId: id,
      restoredRevision: checkpoint.revision,
    });
    return this.snapshot;
  }

  transition(phase: SessionPhase): SessionRecord {
    if (!canTransition(this.#record.phase, phase)) {
      throw new Error(
        `Invalid session transition ${this.#record.phase} -> ${phase}`,
      );
    }
    return this.patch({ phase }, 'session.transition');
  }

  advanceSimulation(ticks = 1): SessionRecord {
    const delta = clamp(Math.floor(ticks), 0, 10_000);
    return this.patch({
      simulationTick: this.#record.simulationTick + delta,
    }, 'simulation.advance');
  }

  setPlayerPosition(x: number, y: number, z: number): SessionRecord {
    return this.patch({
      player: {
        x: finite(x, 0),
        y: finite(y, 0),
        z: finite(z, 0),
      },
    }, 'player.position');
  }

  setPlayerVitals(health: number, stamina: number): SessionRecord {
    return this.patch({
      player: {
        health: clamp(finite(health, 0), 0, 100),
        stamina: clamp(finite(stamina, 0), 0, 100),
      },
    }, 'player.vitals');
  }

  addInventoryItem(id: string): SessionRecord {
    const item = id.trim();
    if (!item) {
      throw new Error('Inventory item id cannot be empty');
    }
    if (this.#record.player.inventory.includes(item)) {
      return this.snapshot;
    }
    return this.patch({
      player: {
        inventory: [...this.#record.player.inventory, item],
      },
    }, 'inventory.add');
  }

  removeInventoryItem(id: string): SessionRecord {
    const item = id.trim();
    if (!this.#record.player.inventory.includes(item)) {
      return this.snapshot;
    }
    return this.patch({
      player: {
        inventory: this.#record.player.inventory.filter((value) => value !== item),
      },
    }, 'inventory.remove');
  }

  discover(id: string): SessionRecord {
    const value = id.trim();
    if (!value || this.#record.world.discovered.includes(value)) {
      return this.snapshot;
    }
    return this.patch({
      world: {
        discovered: [...this.#record.world.discovered, value],
      },
    }, 'world.discover');
  }

  setWeather(weather: string): SessionRecord {
    const value = weather.trim().slice(0, 64);
    if (!value) {
      throw new Error('Weather cannot be empty');
    }
    return this.patch({
      world: { weather: value },
    }, 'world.weather');
  }

  setDayTime(hours: number): SessionRecord {
    const normalized = ((finite(hours, 12) % 24) + 24) % 24;
    return this.patch({
      world: { dayTime: normalized },
    }, 'world.time');
  }

  setFlag(key: string, value: boolean): SessionRecord {
    const normalized = key.trim();
    if (!normalized) {
      throw new Error('Flag key cannot be empty');
    }
    return this.patch({
      flags: { [normalized]: Boolean(value) },
    }, 'world.flag');
  }

  hasFlag(key: string): boolean {
    return this.#record.flags[key.trim()] === true;
  }

  save<T>(codec: SessionCodec<T>): T {
    return codec.encode(this.snapshot);
  }

  load<T>(payload: T, codec: SessionCodec<T>): SessionRecord {
    const candidate = codec.decode(payload);
    this.#validate(candidate);
    this.#record = cloneRecord(candidate);
    this.#events.length = 0;
    this.#checkpoints.length = 0;
    this.#nextEventId = 1;
    this.appendEvent('session.load', {
      revision: this.#record.revision,
      schemaVersion: this.#record.schemaVersion,
    });
    return this.snapshot;
  }

  clearHistory(): void {
    this.#events.length = 0;
    this.#checkpoints.length = 0;
  }

  #validate(record: SessionRecord): void {
    if (!record.sessionId.trim()) throw new Error('Invalid session id');
    if (record.schemaVersion < 1) throw new Error('Invalid session schema');
    if (!Number.isFinite(record.seed)) throw new Error('Invalid session seed');
    if (!Number.isInteger(record.revision) || record.revision < 0) {
      throw new Error('Invalid session revision');
    }
    if (!Number.isInteger(record.simulationTick) || record.simulationTick < 0) {
      throw new Error('Invalid simulation tick');
    }
    if (!Number.isFinite(record.updatedAtMs)) {
      throw new Error('Invalid session update timestamp');
    }
    if (!Number.isFinite(record.player.x) || !Number.isFinite(record.player.y) || !Number.isFinite(record.player.z)) {
      throw new Error('Invalid player position');
    }
    if (record.player.health < 0 || record.player.health > 100) {
      throw new Error('Player health out of bounds');
    }
    if (record.player.stamina < 0 || record.player.stamina > 100) {
      throw new Error('Player stamina out of bounds');
    }
    if (record.world.dayTime < 0 || record.world.dayTime >= 24) {
      throw new Error('World day time out of bounds');
    }
  }
}

export function canTransition(from: SessionPhase, to: SessionPhase): boolean {
  if (from === to) {
    return true;
  }
  const transitions: Readonly<Record<SessionPhase, readonly SessionPhase[]>> = {
    boot: ['active', 'ending'],
    active: ['paused', 'recovering', 'ending'],
    paused: ['active', 'ending'],
    recovering: ['active', 'ending'],
    ending: ['ended'],
    ended: [],
  };
  return transitions[from].includes(to);
}

export function createJsonSessionCodec(): SessionCodec<string> {
  return {
    encode(snapshot) {
      return JSON.stringify(snapshot);
    },
    decode(payload) {
      const value: unknown = JSON.parse(payload);
      if (!value || typeof value !== 'object') {
        throw new Error('Invalid session payload');
      }
      return value as SessionRecord;
    },
  };
}
