/**
 * AAPW Runtime Migration V18.
 *
 * Describes legacy-to-typed ownership without rewriting the whole application in one step.
 * Each surface carries an explicit owner, compatibility boundary, risk, parity state and
 * cutover policy. Tooling can build migration reports without importing gameplay modules.
 */

export type MigrationOwnerV18 = 'legacy' | 'typed' | 'hybrid';
export type MigrationStateV18 = 'legacy' | 'adapter' | 'shadow' | 'typed' | 'validated' | 'blocked';
export type MigrationRiskV18 = 'low' | 'medium' | 'high' | 'critical';

export interface MigrationSurfaceV18 {
  readonly id: string;
  readonly domain: 'boot' | 'world' | 'render' | 'input' | 'audio' | 'gameplay' | 'network' | 'persistence' | 'ui' | 'platform';
  readonly legacyPath: string | null;
  readonly typedPath: string;
  readonly owner: MigrationOwnerV18;
  readonly state: MigrationStateV18;
  readonly risk: MigrationRiskV18;
  readonly contractIds: readonly string[];
  readonly dependencies: readonly string[];
  readonly parityRequired: boolean;
  readonly notes: readonly string[];
}

export interface MigrationCheckpointV18 {
  readonly id: string;
  readonly surfaceId: string;
  readonly timestampMs: number;
  readonly state: MigrationStateV18;
  readonly parityScore: number;
  readonly evidence: readonly string[];
}

export interface MigrationPlanSnapshotV18 {
  readonly revision: number;
  readonly completionRatio: number;
  readonly validatedRatio: number;
  readonly blocked: readonly string[];
  readonly critical: readonly string[];
  readonly nextCandidates: readonly string[];
  readonly surfaces: readonly MigrationSurfaceV18[];
  readonly checkpoints: readonly MigrationCheckpointV18[];
}

export interface MigrationRegistryOptionsV18 {
  readonly clock?: () => number;
  readonly minParityScore?: number;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\\s+/g, '-');
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const STATE_LEVEL: Readonly<Record<MigrationStateV18, number>> = {
  legacy: 0,
  adapter: 1,
  shadow: 2,
  typed: 3,
  validated: 4,
  blocked: -1,
};

const RISK_WEIGHT: Readonly<Record<MigrationRiskV18, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class RuntimeMigrationRegistryV18 {
  readonly #surfaces = new Map<string, MigrationSurfaceV18>();
  readonly #checkpoints: MigrationCheckpointV18[] = [];
  readonly #clock: () => number;
  readonly #minParityScore: number;
  #revision = 0;

  public constructor(options: MigrationRegistryOptionsV18 = {}) {
    this.#clock = options.clock ?? (() => Date.now());
    this.#minParityScore = clamp(options.minParityScore ?? 0.98, 0, 1);
  }

  public register(surface: MigrationSurfaceV18): MigrationSurfaceV18 {
    const id = normalize(surface.id);
    if (!id) throw new TypeError('Migration surface id is required.');
    if (!surface.typedPath.endsWith('.ts')) {
      throw new TypeError(`Typed owner must be TypeScript: ${surface.typedPath}`);
    }

    const normalized = freeze({
      ...surface,
      id,
      legacyPath: surface.legacyPath?.trim() || null,
      typedPath: surface.typedPath.trim(),
      contractIds: freeze([...new Set(surface.contractIds.map(normalize).filter(Boolean))]),
      dependencies: freeze([...new Set(surface.dependencies.map(normalize).filter(Boolean))]),
      notes: freeze(surface.notes.map((note) => note.trim()).filter(Boolean).slice(0, 16)),
    });

    this.#surfaces.set(id, normalized);
    this.#revision += 1;
    return normalized;
  }

  public registerMany(surfaces: readonly MigrationSurfaceV18[]): readonly MigrationSurfaceV18[] {
    return freeze(surfaces.map((surface) => this.register(surface)));
  }

  public get(id: string): MigrationSurfaceV18 | undefined {
    return this.#surfaces.get(normalize(id));
  }

  public transition(
    id: string,
    next: MigrationStateV18,
    parityScore = 1,
    evidence: readonly string[] = [],
  ): MigrationCheckpointV18 {
    const key = normalize(id);
    const surface = this.#surfaces.get(key);
    if (!surface) throw new Error(`Unknown migration surface: ${id}`);

    const safeScore = clamp(parityScore, 0, 1);
    if (next === 'validated' && surface.parityRequired && safeScore < this.#minParityScore) {
      throw new Error(
        `Parity threshold not met for ${id}: ${safeScore.toFixed(3)} < ${this.#minParityScore.toFixed(3)}`,
      );
    }

    const allowed = this.#isTransitionAllowed(surface.state, next);
    if (!allowed) {
      throw new Error(`Illegal migration transition ${surface.state} -> ${next} for ${id}`);
    }

    const updated = freeze({
      ...surface,
      state: next,
      owner: next === 'validated' || next === 'typed' ? 'typed' : surface.owner,
      notes: freeze([
        ...surface.notes,
        `state:${next}@${this.#clock()}`,
      ].slice(-16)),
    });

    this.#surfaces.set(key, updated);
    this.#revision += 1;

    const checkpoint = freeze({
      id: `${key}:${this.#revision}`,
      surfaceId: key,
      timestampMs: this.#clock(),
      state: next,
      parityScore: safeScore,
      evidence: freeze(evidence.map((item) => item.trim()).filter(Boolean).slice(0, 32)),
    });

    this.#checkpoints.push(checkpoint);
    while (this.#checkpoints.length > 1024) {
      this.#checkpoints.shift();
    }

    return checkpoint;
  }

  public validateDependencies(): readonly string[] {
    const failures: string[] = [];

    for (const surface of this.#surfaces.values()) {
      for (const dependency of surface.dependencies) {
        const target = this.#surfaces.get(dependency);
        if (!target) {
          failures.push(`${surface.id}: missing migration dependency ${dependency}`);
          continue;
        }

        if (STATE_LEVEL[target.state] < STATE_LEVEL[surface.state]) {
          failures.push(
            `${surface.id}: dependency ${dependency} is behind at ${target.state}`,
          );
        }
      }
    }

    return freeze([...new Set(failures)].sort());
  }

  public canCutover(id: string): boolean {
    const surface = this.#surfaces.get(normalize(id));
    if (!surface) return false;
    if (surface.state === 'blocked' || surface.state === 'legacy') return false;
    if (surface.state === 'validated') return true;
    return surface.owner === 'typed' && surface.risk !== 'critical';
  }

  public blockers(id: string): readonly string[] {
    const surface = this.#surfaces.get(normalize(id));
    if (!surface) return freeze(['UNKNOWN_SURFACE']);

    const blockers: string[] = [];
    for (const dependency of surface.dependencies) {
      const target = this.#surfaces.get(dependency);
      if (!target) {
        blockers.push(`MISSING:${dependency}`);
      } else if (!this.canCutover(dependency)) {
        blockers.push(`DEPENDENCY:${dependency}`);
      }
    }

    if (surface.parityRequired && surface.state !== 'validated') {
      blockers.push('PARITY_NOT_VALIDATED');
    }
    if (surface.state === 'blocked') {
      blockers.push('SURFACE_BLOCKED');
    }

    return freeze([...new Set(blockers)].sort());
  }

  public nextCandidates(limit = 12): readonly MigrationSurfaceV18[] {
    const dependenciesReady = (surface: MigrationSurfaceV18) =>
      surface.dependencies.every((dependency) => {
        const target = this.#surfaces.get(dependency);
        return Boolean(target && this.canCutover(dependency));
      });

    return freeze(
      [...this.#surfaces.values()]
        .filter((surface) => surface.state !== 'validated' && surface.state !== 'blocked')
        .filter(dependenciesReady)
        .sort(
          (a, b) =>
            RISK_WEIGHT[b.risk] - RISK_WEIGHT[a.risk] ||
            STATE_LEVEL[a.state] - STATE_LEVEL[b.state] ||
            a.id.localeCompare(b.id),
        )
        .slice(0, Math.max(1, Math.trunc(limit))),
    );
  }

  public snapshot(): MigrationPlanSnapshotV18 {
    const surfaces = [...this.#surfaces.values()].sort((a, b) => a.id.localeCompare(b.id));
    const validated = surfaces.filter((surface) => surface.state === 'validated').length;
    const blocked = surfaces.filter((surface) => surface.state === 'blocked');
    const critical = surfaces.filter((surface) => surface.risk === 'critical' && surface.state !== 'validated');

    return freeze({
      revision: this.#revision,
      completionRatio: surfaces.length === 0 ? 1 : validated / surfaces.length,
      validatedRatio:
        surfaces.length === 0
          ? 1
          : validated / surfaces.filter((surface) => surface.parityRequired).length || 1,
      blocked: freeze(blocked.map((surface) => surface.id)),
      critical: freeze(critical.map((surface) => surface.id)),
      nextCandidates: freeze(this.nextCandidates().map((surface) => surface.id)),
      surfaces: freeze(surfaces),
      checkpoints: freeze([...this.#checkpoints]),
    });
  }

  public exportManifest(): string {
    return JSON.stringify(this.snapshot());
  }

  #isTransitionAllowed(
    current: MigrationStateV18,
    next: MigrationStateV18,
  ): boolean {
    if (next === 'blocked') return current !== 'validated';
    if (current === next) return true;
    if (current === 'legacy') return next === 'adapter';
    if (current === 'adapter') return next === 'shadow' || next === 'blocked';
    if (current === 'shadow') return next === 'typed' || next === 'blocked';
    if (current === 'typed') return next === 'validated' || next === 'blocked';
    if (current === 'blocked') return next === 'adapter';
    return false;
  }
}

export function createDefaultMigrationRegistryV18(
  options: MigrationRegistryOptionsV18 = {},
): RuntimeMigrationRegistryV18 {
  const registry = new RuntimeMigrationRegistryV18(options);

  registry.registerMany([
    {
      id: '3d.game-entry',
      domain: 'boot',
      legacyPath: 'src/3d/game3d.js',
      typedPath: 'src/3d/modern/gameEntry.ts',
      owner: 'hybrid',
      state: 'validated',
      risk: 'critical',
      contractIds: ['bootstrap-lifecycle', 'legacy-init-boundary'],
      dependencies: [],
      parityRequired: true,
      notes: ['TypeScript composition root owns the entry contract.'],
    },
    {
      id: '3d.camera',
      domain: 'render',
      legacyPath: 'src/3d/camera.js',
      typedPath: 'src/3d/camera.ts',
      owner: 'hybrid',
      state: 'adapter',
      risk: 'high',
      contractIds: ['camera-frame'],
      dependencies: ['3d.game-entry'],
      parityRequired: true,
      notes: [],
    },
    {
      id: '3d.chunk-manager',
      domain: 'world',
      legacyPath: 'src/3d/world/chunkManager.js',
      typedPath: 'src/3d/modern/worldLifecycleV18.ts',
      owner: 'hybrid',
      state: 'shadow',
      risk: 'high',
      contractIds: ['world-residency'],
      dependencies: ['3d.game-entry'],
      parityRequired: true,
      notes: ['Typed residency controller is renderer-neutral.'],
    },
    {
      id: '3d.assets',
      domain: 'world',
      legacyPath: 'src/3d/assetLoader.js',
      typedPath: 'src/3d/modern/assetLifecycleV18.ts',
      owner: 'typed',
      state: 'typed',
      risk: 'medium',
      contractIds: ['asset-integrity', 'asset-residency'],
      dependencies: ['3d.game-entry'],
      parityRequired: true,
      notes: [],
    },
    {
      id: '3d.input',
      domain: 'input',
      legacyPath: 'src/3d/game3d.js',
      typedPath: 'src/3d/modern/inputPipelineV18.ts',
      owner: 'typed',
      state: 'typed',
      risk: 'medium',
      contractIds: ['semantic-input'],
      dependencies: ['3d.game-entry'],
      parityRequired: true,
      notes: ['Raw DOM input remains in the legacy owner until parity validation.'],
    },
  ]);

  return registry;
}
