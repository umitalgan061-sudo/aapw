/**
 * AAPW Typed Legacy Boundary V18.
 *
 * One narrowly typed seam for legacy JavaScript modules. The boundary provides
 * capability checks, lifecycle calls, idempotent attachment and structured
 * failure reporting without forcing the legacy implementation to become typed
 * in the same commit.
 */

export type LegacyBoundaryStateV18 =
  | 'detached'
  | 'attached'
  | 'initialized'
  | 'failed'
  | 'disposed';

export type LegacyModuleCapabilityV18 =
  | 'init'
  | 'dispose'
  | 'shutdown'
  | 'snapshot'
  | 'health';

export interface LegacyBoundaryModuleV18 {
  readonly id: string;
  readonly version?: string;
  readonly init?: () => void | Promise<void>;
  readonly dispose?: () => void | Promise<void>;
  readonly shutdown?: () => void | Promise<void>;
  readonly snapshot?: () => unknown;
  readonly health?: () => unknown;
}

export interface LegacyBoundarySnapshotV18 {
  readonly id: string;
  readonly state: LegacyBoundaryStateV18;
  readonly capabilities: readonly LegacyModuleCapabilityV18[];
  readonly attachedAtMs: number | null;
  readonly initializedAtMs: number | null;
  readonly disposedAtMs: number | null;
  readonly lastError: string | null;
  readonly initCount: number;
  readonly disposeCount: number;
}

export interface LegacyBoundaryOptionsV18 {
  readonly clock?: () => number;
  readonly requireInit?: boolean;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\\s+/g, '-');
}

export class TypedLegacyBoundaryV18 {
  readonly #clock: () => number;
  readonly #requireInit: boolean;
  #module: LegacyBoundaryModuleV18 | null = null;
  #state: LegacyBoundaryStateV18 = 'detached';
  #attachedAtMs: number | null = null;
  #initializedAtMs: number | null = null;
  #disposedAtMs: number | null = null;
  #lastError: string | null = null;
  #initCount = 0;
  #disposeCount = 0;

  public constructor(options: LegacyBoundaryOptionsV18 = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#requireInit = options.requireInit ?? true;
  }

  public attach(module: LegacyBoundaryModuleV18): void {
    if (this.#state === 'attached' || this.#state === 'initialized') {
      if (this.#module?.id === module.id) return;
      throw new Error('Legacy boundary already owns another module.');
    }

    if (!module.id.trim()) {
      throw new TypeError('Legacy boundary module id is required.');
    }

    if (this.#requireInit && typeof module.init !== 'function') {
      throw new TypeError(`Legacy module has no init capability: ${module.id}`);
    }

    this.#module = module;
    this.#state = 'attached';
    this.#attachedAtMs = this.#clock();
    this.#initializedAtMs = null;
    this.#disposedAtMs = null;
    this.#lastError = null;
  }

  public async initialize(): Promise<void> {
    if (!this.#module) {
      throw new Error('Legacy boundary is detached.');
    }

    if (this.#state === 'initialized') return;
    if (this.#state === 'disposed') {
      throw new Error('Legacy boundary cannot initialize after disposal.');
    }

    try {
      await this.#module.init?.();
      this.#state = 'initialized';
      this.#initializedAtMs = this.#clock();
      this.#initCount += 1;
      this.#lastError = null;
    } catch (error) {
      this.#state = 'failed';
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public async dispose(): Promise<void> {
    if (!this.#module || this.#state === 'disposed' || this.#state === 'detached') {
      this.#state = 'disposed';
      this.#disposedAtMs ??= this.#clock();
      return;
    }

    try {
      await (this.#module.shutdown ?? this.#module.dispose)?.();
      this.#disposeCount += 1;
      this.#state = 'disposed';
      this.#disposedAtMs = this.#clock();
    } catch (error) {
      this.#state = 'failed';
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public detach(): void {
    this.#module = null;
    this.#state = 'detached';
    this.#attachedAtMs = null;
    this.#initializedAtMs = null;
    this.#disposedAtMs = null;
    this.#lastError = null;
  }

  public hasCapability(
    capability: LegacyModuleCapabilityV18,
  ): boolean {
    if (!this.#module) return false;

    switch (capability) {
      case 'init':
        return typeof this.#module.init === 'function';
      case 'dispose':
        return typeof this.#module.dispose === 'function';
      case 'shutdown':
        return typeof this.#module.shutdown === 'function';
      case 'snapshot':
        return typeof this.#module.snapshot === 'function';
      case 'health':
        return typeof this.#module.health === 'function';
      default:
        return false;
    }
  }

  public capabilities(): readonly LegacyModuleCapabilityV18[] {
    if (!this.#module) return freeze([]);

    const candidates: readonly LegacyModuleCapabilityV18[] = [
      'init',
      'dispose',
      'shutdown',
      'snapshot',
      'health',
    ];

    return freeze(candidates.filter((capability) => this.hasCapability(capability)));
  }

  public callSnapshot(): unknown {
    return this.#module?.snapshot?.();
  }

  public callHealth(): unknown {
    return this.#module?.health?.();
  }

  public snapshot(): LegacyBoundarySnapshotV18 {
    return freeze({
      id: normalize(this.#module?.id ?? ''),
      state: this.#state,
      capabilities: this.capabilities(),
      attachedAtMs: this.#attachedAtMs,
      initializedAtMs: this.#initializedAtMs,
      disposedAtMs: this.#disposedAtMs,
      lastError: this.#lastError,
      initCount: this.#initCount,
      disposeCount: this.#disposeCount,
    });
  }
}

export interface LegacyContractRegistrationV18 {
  readonly id: string;
  readonly sourcePath: string;
  readonly typedBoundary: string;
  readonly state: 'compatibility' | 'shadow' | 'validated';
  readonly risk: 'low' | 'medium' | 'high' | 'critical';
  readonly dependencies: readonly string[];
}

export class LegacyContractRegistryV18 {
  readonly #contracts = new Map<string, LegacyContractRegistrationV18>();
  #revision = 0;

  public register(contract: LegacyContractRegistrationV18): void {
    const id = normalize(contract.id);
    if (!id) throw new TypeError('Legacy contract id is required.');
    if (!contract.sourcePath) throw new TypeError(`Legacy source path missing: ${id}`);
    if (!contract.typedBoundary.endsWith('.ts')) {
      throw new TypeError(`Typed boundary must be TypeScript: ${id}`);
    }

    this.#contracts.set(
      id,
      freeze({
        ...contract,
        id,
        dependencies: freeze(
          [...new Set(contract.dependencies.map(normalize).filter(Boolean))],
        ),
      }),
    );
    this.#revision += 1;
  }

  public list(): readonly LegacyContractRegistrationV18[] {
    return freeze(
      [...this.#contracts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    );
  }

  public validate(): readonly string[] {
    const failures: string[] = [];

    for (const contract of this.#contracts.values()) {
      for (const dependency of contract.dependencies) {
        if (!this.#contracts.has(dependency)) {
          failures.push(`${contract.id}: missing dependency ${dependency}`);
        }
      }
    }

    return freeze([...new Set(failures)].sort());
  }

  public snapshot(): Readonly<{
    revision: number;
    count: number;
    compatibility: number;
    shadow: number;
    validated: number;
    blockers: readonly string[];
  }> {
    const contracts = this.list();
    const blockers = this.validate();

    return freeze({
      revision: this.#revision,
      count: contracts.length,
      compatibility: contracts.filter((item) => item.state === 'compatibility').length,
      shadow: contracts.filter((item) => item.state === 'shadow').length,
      validated: contracts.filter((item) => item.state === 'validated').length,
      blockers,
    });
  }
}

export function createDefaultLegacyContractRegistryV18(): LegacyContractRegistryV18 {
  const registry = new LegacyContractRegistryV18();

  registry.register({
    id: 'game3d.entry',
    sourcePath: 'src/3d/game3d.js',
    typedBoundary: 'src/3d/modern/runtimeApplicationV18.ts',
    state: 'validated',
    risk: 'critical',
    dependencies: [],
  });

  registry.register({
    id: 'scene.bootstrap',
    sourcePath: 'src/3d/sceneManager.js',
    typedBoundary: 'src/3d/modern/runtimeTopologyV18.ts',
    state: 'shadow',
    risk: 'critical',
    dependencies: ['game3d.entry'],
  });

  registry.register({
    id: 'camera.control',
    sourcePath: 'src/3d/camera.js',
    typedBoundary: 'src/3d/modern/renderPolicyV18.ts',
    state: 'compatibility',
    risk: 'high',
    dependencies: ['scene.bootstrap'],
  });

  registry.register({
    id: 'asset.loading',
    sourcePath: 'src/3d/assetLoader.js',
    typedBoundary: 'src/3d/modern/assetLifecycleV18.ts',
    state: 'shadow',
    risk: 'high',
    dependencies: ['game3d.entry'],
  });

  registry.register({
    id: 'input.routing',
    sourcePath: 'src/3d/game3d.js',
    typedBoundary: 'src/3d/modern/inputPipelineV18.ts',
    state: 'shadow',
    risk: 'medium',
    dependencies: ['game3d.entry'],
  });

  return registry;
}
