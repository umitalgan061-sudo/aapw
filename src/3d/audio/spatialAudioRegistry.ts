/** Strict TypeScript bounded spatial audio registry. */

export type SpatialAudioSourceState = 'registered' | 'active' | 'virtual' | 'stopped';

export interface SpatialAudioPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpatialAudioSourceInput {
  readonly id?: string;
  readonly class?: string;
  readonly priority?: number;
  readonly voiceCost?: number;
  readonly position?: Partial<SpatialAudioPosition>;
  readonly velocity?: Partial<SpatialAudioPosition>;
  readonly gain?: number;
  readonly maxDistance?: number;
  readonly positional?: boolean;
  readonly loop?: boolean;
  readonly state?: SpatialAudioSourceState;
  readonly timestamp?: number;
}

export interface SpatialAudioSource extends SpatialAudioPosition {
  readonly version: 1;
}

export interface SpatialAudioSourceRecord {
  readonly version: 1;
  readonly id: string;
  readonly sequence: number;
  readonly class: string;
  readonly priority: number;
  readonly voiceCost: number;
  readonly position: SpatialAudioPosition;
  readonly velocity: SpatialAudioPosition;
  readonly gain: number;
  readonly maxDistance: number;
  readonly positional: boolean;
  readonly loop: boolean;
  readonly state: SpatialAudioSourceState;
  readonly timestamp: number;
}

export interface SpatialAudioAdmission {
  readonly version: 1;
  readonly requested: number;
  readonly admitted: number;
  readonly virtualized: number;
  readonly remainingVoices: number;
  readonly remainingPositional: number;
  readonly sources: readonly (SpatialAudioSourceRecord & { readonly distance: number })[];
}

export interface SpatialAudioRegistrySnapshot {
  readonly version: 1;
  readonly disposed: boolean;
  readonly sequence: number;
  readonly maxSources: number;
  readonly maxPositionalSources: number;
  readonly sourceCount: number;
  readonly sources: readonly SpatialAudioSourceRecord[];
}

export interface SpatialAudioRegistryOptions {
  readonly maxSources?: number;
  readonly maxPositionalSources?: number;
  readonly maxDistance?: number;
}

const DEFAULT_MAX_SOURCES = 48;
const DEFAULT_MAX_POSITIONAL = 28;
const MAX_ID_LENGTH = 96;

const SOURCE_STATES = Object.freeze({
  REGISTERED: 'registered',
  ACTIVE: 'active',
  VIRTUAL: 'virtual',
  STOPPED: 'stopped',
} satisfies Record<string, SpatialAudioSourceState>);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function freezeRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function normalizeId(value: unknown, fallbackSequence: number): string {
  return String(value ?? `source-${fallbackSequence}`)
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, MAX_ID_LENGTH);
}

function normalizePosition(position: Partial<SpatialAudioPosition> | undefined): SpatialAudioPosition {
  return freezeRecord({
    x: finiteOr(position?.x, 0),
    y: finiteOr(position?.y, 0),
    z: finiteOr(position?.z, 0),
  });
}

function sourceScore(
  source: SpatialAudioSourceRecord,
  listenerPosition: SpatialAudioPosition,
): { readonly distance: number; readonly score: number } {
  const distance = Math.hypot(
    source.position.x - listenerPosition.x,
    source.position.y - listenerPosition.y,
    source.position.z - listenerPosition.z,
  );
  return freezeRecord({
    distance,
    score: source.priority * 1000 - distance * 4 - source.voiceCost * 20,
  });
}

export class SpatialAudioRegistry {
  readonly maxSources: number;
  readonly maxPositionalSources: number;
  readonly maxDistance: number;

  private readonly sources = new Map<string, SpatialAudioSourceRecord>();
  private sequence = 0;
  private disposed = false;

  constructor({
    maxSources = DEFAULT_MAX_SOURCES,
    maxPositionalSources = DEFAULT_MAX_POSITIONAL,
    maxDistance = 120,
  }: SpatialAudioRegistryOptions = {}) {
    this.maxSources = clamp(Math.round(finiteOr(maxSources, DEFAULT_MAX_SOURCES)), 1, 128);
    this.maxPositionalSources = clamp(
      Math.round(finiteOr(maxPositionalSources, DEFAULT_MAX_POSITIONAL)),
      0,
      this.maxSources,
    );
    this.maxDistance = clamp(finiteOr(maxDistance, 120), 10, 500);
  }

  register(input: SpatialAudioSourceInput = {}): Readonly<SpatialAudioSourceRecord> | null {
    if (this.disposed) return null;

    const id = normalizeId(input.id, this.sequence + 1);
    if (this.sources.has(id)) return this.update(id, input);
    if (this.sources.size >= this.maxSources) return null;

    const source = freezeRecord({
      version: 1 as const,
      id,
      sequence: ++this.sequence,
      class: typeof input.class === 'string' ? input.class.slice(0, 48) : 'ambience',
      priority: clamp(Math.round(finiteOr(input.priority, 30)), 0, 100),
      voiceCost: clamp(finiteOr(input.voiceCost, 1), 0.25, 4),
      position: normalizePosition(input.position),
      velocity: normalizePosition(input.velocity),
      gain: clamp(finiteOr(input.gain, 1), 0, 1),
      maxDistance: clamp(finiteOr(input.maxDistance, this.maxDistance), 1, this.maxDistance),
      positional: input.positional !== false,
      loop: input.loop !== false,
      state: input.state ?? SOURCE_STATES.REGISTERED,
      timestamp: finiteOr(input.timestamp, 0),
    });
    this.sources.set(id, source);
    return source;
  }

  update(id: string, patch: SpatialAudioSourceInput = {}): Readonly<SpatialAudioSourceRecord> | null {
    const key = normalizeId(id, this.sequence + 1);
    const current = this.sources.get(key);
    if (!current || this.disposed) return null;

    const source = freezeRecord({
      ...current,
      ...patch,
      id: current.id,
      position: patch.position ? normalizePosition(patch.position) : current.position,
      velocity: patch.velocity ? normalizePosition(patch.velocity) : current.velocity,
      state: patch.state ?? current.state,
      priority: patch.priority === undefined
        ? current.priority
        : clamp(Math.round(finiteOr(patch.priority, current.priority)), 0, 100),
      gain: patch.gain === undefined ? current.gain : clamp(finiteOr(patch.gain, current.gain), 0, 1),
      maxDistance: patch.maxDistance === undefined
        ? current.maxDistance
        : clamp(finiteOr(patch.maxDistance, current.maxDistance), 1, this.maxDistance),
      sequence: ++this.sequence,
    });
    this.sources.set(key, source);
    return source;
  }

  setState(id: string, state: SpatialAudioSourceState): Readonly<SpatialAudioSourceRecord> | null {
    return this.update(id, { state });
  }

  unregister(id: string): boolean {
    return this.sources.delete(normalizeId(id, this.sequence + 1));
  }

  get(id: string): Readonly<SpatialAudioSourceRecord> | null {
    return this.sources.get(normalizeId(id, this.sequence + 1)) ?? null;
  }

  selectAdmissions({
    listenerPosition = { x: 0, y: 0, z: 0 },
    maxSources = this.maxSources,
    maxPositionalSources = this.maxPositionalSources,
  }: {
    readonly listenerPosition?: SpatialAudioPosition;
    readonly maxSources?: number;
    readonly maxPositionalSources?: number;
  } = {}): SpatialAudioAdmission {
    const sourceLimit = clamp(Math.round(finiteOr(maxSources, this.maxSources)), 0, this.maxSources);
    const positionalLimit = clamp(
      Math.round(finiteOr(maxPositionalSources, this.maxPositionalSources)),
      0,
      sourceLimit,
    );

    const ranked = [...this.sources.values()]
      .filter((source) => source.state !== SOURCE_STATES.STOPPED)
      .map((source) => ({ source, ...sourceScore(source, listenerPosition) }))
      .filter((item) => item.distance <= item.source.maxDistance)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.source.id.localeCompare(b.source.id),
      );

    let positionalLeft = positionalLimit;
    let voicesLeft = sourceLimit;
    const admitted: Array<SpatialAudioSourceRecord & { readonly distance: number }> = [];

    for (const item of ranked) {
      if (voicesLeft <= 0 || item.source.voiceCost > voicesLeft) continue;
      if (item.source.positional && positionalLeft <= 0) continue;
      admitted.push(
        freezeRecord({
          ...item.source,
          distance: Number(item.distance.toFixed(4)),
          state: SOURCE_STATES.ACTIVE,
        }),
      );
      voicesLeft -= item.source.voiceCost;
      if (item.source.positional) positionalLeft -= 1;
    }

    const admittedIds = new Set(admitted.map((item) => item.id));
    for (const source of this.sources.values()) {
      if (source.state === SOURCE_STATES.STOPPED) continue;
      const state: SpatialAudioSourceState = admittedIds.has(source.id)
        ? SOURCE_STATES.ACTIVE
        : SOURCE_STATES.VIRTUAL;
      if (source.state !== state) {
        this.sources.set(source.id, freezeRecord({
          ...source,
          state,
          sequence: ++this.sequence,
        }));
      }
    }

    return freezeRecord({
      version: 1 as const,
      requested: ranked.length,
      admitted: admitted.length,
      virtualized: Math.max(0, ranked.length - admitted.length),
      remainingVoices: Number(Math.max(0, voicesLeft).toFixed(3)),
      remainingPositional: positionalLeft,
      sources: freezeRecord(admitted),
    });
  }

  markStopped(id: string): Readonly<SpatialAudioSourceRecord> | null {
    return this.setState(id, SOURCE_STATES.STOPPED);
  }

  clearVirtualized(): void {
    for (const source of this.sources.values()) {
      if (source.state !== SOURCE_STATES.VIRTUAL) continue;
      this.sources.set(source.id, freezeRecord({
        ...source,
        state: SOURCE_STATES.REGISTERED,
        sequence: ++this.sequence,
      }));
    }
  }

  snapshot(): SpatialAudioRegistrySnapshot {
    return freezeRecord({
      version: 1 as const,
      disposed: this.disposed,
      sequence: this.sequence,
      maxSources: this.maxSources,
      maxPositionalSources: this.maxPositionalSources,
      sourceCount: this.sources.size,
      sources: freezeRecord(
        [...this.sources.values()].map((source) => freezeRecord({
          ...source,
          position: freezeRecord({ ...source.position }),
          velocity: freezeRecord({ ...source.velocity }),
        })),
      ),
    });
  }

  dispose(): void {
    this.disposed = true;
    this.sources.clear();
  }
}

export function createSpatialAudioRegistry(
  options: SpatialAudioRegistryOptions = {},
): SpatialAudioRegistry {
  return new SpatialAudioRegistry(options);
}

export function spatialAudioRegistryConstants() {
  return Object.freeze({
    states: SOURCE_STATES,
    defaultMaxSources: DEFAULT_MAX_SOURCES,
    defaultMaxPositionalSources: DEFAULT_MAX_POSITIONAL,
  });
}
