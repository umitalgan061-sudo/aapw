/**
 * Modern migration manager V3.
 *
 * Makes the JS -> TS transition explicit. Each legacy surface has an owner,
 * adapter, readiness state and cutover condition. This lets the application
 * migrate incrementally without silently creating a second source of truth.
 *
 * @module migrationManagerV3
 */

export type MigrationSurfaceKind =
  | 'bootstrap'
  | 'world'
  | 'player'
  | 'combat'
  | 'render'
  | 'input'
  | 'audio'
  | 'save'
  | 'network'
  | 'tools';

export type MigrationOwner = 'legacy-js' | 'modern-ts' | 'hybrid';

export type MigrationState =
  | 'legacy'
  | 'adapter'
  | 'shadow'
  | 'canary'
  | 'cutover'
  | 'retired';

export type MigrationSurface = {
  readonly id: string;
  readonly kind: MigrationSurfaceKind;
  readonly owner: MigrationOwner;
  readonly state: MigrationState;
  readonly legacyPath?: string;
  readonly modernPath?: string;
  readonly contractIds: readonly string[];
  readonly risk: 'low' | 'medium' | 'high';
  readonly blocking: boolean;
};

export type MigrationSignal = {
  readonly surfaceId: string;
  readonly deterministic: boolean;
  readonly errorRate: number;
  readonly p95FrameMs: number;
  readonly memoryDeltaMb: number;
  readonly featureParity: number;
};

export type MigrationDecision = {
  readonly surfaceId: string;
  readonly state: MigrationState;
  readonly canAdvance: boolean;
  readonly reason: string;
};

const STATE_ORDER: readonly MigrationState[] = [
  'legacy',
  'adapter',
  'shadow',
  'canary',
  'cutover',
  'retired',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export class MigrationManagerV3 {
  readonly #surfaces = new Map<string, MigrationSurface>();
  readonly #signals = new Map<string, MigrationSignal>();

  define(surface: MigrationSurface): () => void {
    if (!surface.id.trim()) {
      throw new Error('Migration surface id cannot be empty');
    }
    if (this.#surfaces.has(surface.id)) {
      throw new Error(`Migration surface already defined: ${surface.id}`);
    }

    const normalized: MigrationSurface = {
      ...surface,
      id: surface.id.trim(),
      contractIds: [...new Set(surface.contractIds.map((value) => value.trim()).filter(Boolean))].sort(),
    };
    this.#surfaces.set(normalized.id, normalized);

    return () => {
      if (this.#surfaces.get(normalized.id) === normalized) {
        this.#surfaces.delete(normalized.id);
        this.#signals.delete(normalized.id);
      }
    };
  }

  setSignal(signal: MigrationSignal): MigrationDecision {
    const surface = this.#surfaces.get(signal.surfaceId);
    if (!surface) {
      throw new Error(`Migration surface not found: ${signal.surfaceId}`);
    }
    const normalized: MigrationSignal = {
      ...signal,
      surfaceId: signal.surfaceId,
      deterministic: Boolean(signal.deterministic),
      errorRate: clamp(finite(signal.errorRate, 1), 0, 1),
      p95FrameMs: Math.max(0, finite(signal.p95FrameMs, 1000)),
      memoryDeltaMb: finite(signal.memoryDeltaMb, 0),
      featureParity: clamp(finite(signal.featureParity, 0), 0, 1),
    };
    this.#signals.set(signal.surfaceId, normalized);
    return this.evaluate(signal.surfaceId);
  }

  evaluate(surfaceId: string): MigrationDecision {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) {
      throw new Error(`Migration surface not found: ${surfaceId}`);
    }
    const signal = this.#signals.get(surfaceId);

    if (!signal) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'awaiting validation signal',
      };
    }

    if (!signal.deterministic) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'deterministic contract not proven',
      };
    }

    if (signal.errorRate > 0.005) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'error rate above 0.5%',
      };
    }

    if (signal.p95FrameMs > 33.3) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'p95 frame time above 33.3ms',
      };
    }

    if (signal.memoryDeltaMb > 64) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'memory growth above 64MB',
      };
    }

    if (signal.featureParity < 0.99) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'feature parity below 99%',
      };
    }

    if (surface.blocking && surface.contractIds.length === 0) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'blocking surface has no executable contracts',
      };
    }

    const index = STATE_ORDER.indexOf(surface.state);
    const canAdvance = index >= 0 && index < STATE_ORDER.length - 1;
    return {
      surfaceId,
      state: surface.state,
      canAdvance,
      reason: canAdvance ? 'all migration gates satisfied' : 'surface already retired',
    };
  }

  advance(surfaceId: string): MigrationDecision {
    const decision = this.evaluate(surfaceId);
    if (!decision.canAdvance) {
      return decision;
    }

    const surface = this.#surfaces.get(surfaceId);
    if (!surface) {
      throw new Error(`Migration surface not found: ${surfaceId}`);
    }

    const currentIndex = STATE_ORDER.indexOf(surface.state);
    const nextState = STATE_ORDER[currentIndex + 1];
    if (!nextState) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'surface already retired',
      };
    }

    this.#surfaces.set(surfaceId, {
      ...surface,
      state: nextState,
      owner: nextState === 'cutover' || nextState === 'retired'
        ? 'modern-ts'
        : nextState === 'legacy'
          ? 'legacy-js'
          : 'hybrid',
    });

    return {
      surfaceId,
      state: nextState,
      canAdvance: nextState !== 'retired',
      reason: `advanced to ${nextState}`,
    };
  }

  rollback(surfaceId: string): MigrationDecision {
    const surface = this.#surfaces.get(surfaceId);
    if (!surface) {
      throw new Error(`Migration surface not found: ${surfaceId}`);
    }
    const index = STATE_ORDER.indexOf(surface.state);
    const previous = STATE_ORDER[Math.max(0, index - 1)];
    if (!previous || previous === surface.state) {
      return {
        surfaceId,
        state: surface.state,
        canAdvance: false,
        reason: 'surface already at initial state',
      };
    }
    const owner: MigrationOwner =
      previous === 'legacy' ? 'legacy-js' :
      previous === 'cutover' || previous === 'retired' ? 'modern-ts' :
      'hybrid';

    this.#surfaces.set(surfaceId, {
      ...surface,
      state: previous,
      owner,
    });
    return {
      surfaceId,
      state: previous,
      canAdvance: previous !== 'retired',
      reason: `rolled back to ${previous}`,
    };
  }

  surface(id: string): MigrationSurface | undefined {
    const value = this.#surfaces.get(id);
    return value
      ? { ...value, contractIds: [...value.contractIds] }
      : undefined;
  }

  surfaces(): readonly MigrationSurface[] {
    return [...this.#surfaces.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((value) => ({ ...value, contractIds: [...value.contractIds] }));
  }

  signals(): readonly MigrationSignal[] {
    return [...this.#signals.values()]
      .sort((a, b) => a.surfaceId.localeCompare(b.surfaceId))
      .map((value) => ({ ...value }));
  }

  blockingSurfaces(): readonly MigrationSurface[] {
    return this.surfaces().filter((surface) => surface.blocking && surface.state !== 'retired');
  }

  readyForRetirement(): readonly string[] {
    return this.surfaces()
      .filter((surface) => surface.state === 'cutover')
      .filter((surface) => this.evaluate(surface.id).canAdvance)
      .map((surface) => surface.id);
  }

  coverage(): {
    readonly total: number;
    readonly modern: number;
    readonly hybrid: number;
    readonly legacy: number;
    readonly retired: number;
    readonly ratio: number;
  } {
    const total = this.#surfaces.size;
    let modern = 0;
    let hybrid = 0;
    let legacy = 0;
    let retired = 0;

    for (const surface of this.#surfaces.values()) {
      if (surface.owner === 'modern-ts') modern += 1;
      if (surface.owner === 'hybrid') hybrid += 1;
      if (surface.owner === 'legacy-js') legacy += 1;
      if (surface.state === 'retired') retired += 1;
    }

    return {
      total,
      modern,
      hybrid,
      legacy,
      retired,
      ratio: total === 0 ? 1 : (modern + hybrid) / total,
    };
  }

  verifyNoDuplicateAuthority(): readonly string[] {
    return this.surfaces()
      .filter((surface) => surface.owner === 'hybrid')
      .filter((surface) => surface.state === 'canary' || surface.state === 'shadow')
      .filter((surface) => !surface.contractIds.some((id) => id.includes('single-authority')))
      .map((surface) => surface.id);
  }
}

export function createDefaultMigrationManifest(): readonly MigrationSurface[] {
  return [
    {
      id: 'bootstrap',
      kind: 'bootstrap',
      owner: 'hybrid',
      state: 'adapter',
      legacyPath: 'src/3d/game3d.js',
      modernPath: 'src/3d/modern/applicationKernelV3.ts',
      contractIds: ['bootstrap-lifecycle', 'single-authority-bootstrap'],
      risk: 'high',
      blocking: true,
    },
    {
      id: 'input',
      kind: 'input',
      owner: 'hybrid',
      state: 'shadow',
      legacyPath: 'src/3d/input.js',
      modernPath: 'src/3d/modern/inputPipelineV3.ts',
      contractIds: ['input-normalization', 'input-replay'],
      risk: 'medium',
      blocking: true,
    },
    {
      id: 'world',
      kind: 'world',
      owner: 'hybrid',
      state: 'canary',
      legacyPath: 'src/3d/world',
      modernPath: 'src/3d/modern/worldStreamingV3.ts',
      contractIds: ['world-residency', 'stream-bounds'],
      risk: 'high',
      blocking: true,
    },
    {
      id: 'render',
      kind: 'render',
      owner: 'hybrid',
      state: 'canary',
      legacyPath: 'src/3d/sceneManager.js',
      modernPath: 'src/3d/modern/renderBudgetV3.ts',
      contractIds: ['render-budget', 'frame-stability'],
      risk: 'high',
      blocking: true,
    },
    {
      id: 'save',
      kind: 'save',
      owner: 'hybrid',
      state: 'adapter',
      legacyPath: 'src/3d/save',
      modernPath: 'src/3d/modern/sessionStateV3.ts',
      contractIds: ['save-schema', 'checkpoint-rollback'],
      risk: 'medium',
      blocking: true,
    },
  ];
}
