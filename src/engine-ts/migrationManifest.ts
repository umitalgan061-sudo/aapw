import type { EngineResult } from './types.js';
import { deepFreeze } from './validation.js';

export type MigrationStatus = 'legacy' | 'shadow' | 'ready' | 'cut-over' | 'retired';
export type MigrationRisk = 'low' | 'medium' | 'high' | 'critical';
export type MigrationSurface = 'entry' | 'world' | 'input' | 'assets' | 'audio' | 'ui' | 'simulation' | 'rendering' | 'persistence' | 'editor';

export interface MigrationModule {
  readonly id: string;
  readonly legacyPath: string;
  readonly modernPath: string;
  readonly surface: MigrationSurface;
  readonly status: MigrationStatus;
  readonly risk: MigrationRisk;
  readonly consumers: number;
  readonly contractVersion: number;
  readonly parityChecks: number;
  readonly owner: string;
  readonly notes?: readonly string[];
}

export interface MigrationTransition {
  readonly moduleId: string;
  readonly from: MigrationStatus;
  readonly to: MigrationStatus;
  readonly revision: number;
  readonly reason: string;
}

export interface MigrationReport {
  readonly total: number;
  readonly legacy: number;
  readonly shadow: number;
  readonly ready: number;
  readonly cutOver: number;
  readonly retired: number;
  readonly risky: number;
  readonly blocked: readonly string[];
  readonly coverage: number;
  readonly revision: number;
}

export interface MigrationGateOptions {
  readonly maxModules?: number;
  readonly maxTransitions?: number;
  readonly requireZeroConsumersForRetire?: boolean;
  readonly requireParityForCutOver?: boolean;
}

const STATUS_ORDER: readonly MigrationStatus[] = Object.freeze(['legacy', 'shadow', 'ready', 'cut-over', 'retired']);
const RISK_WEIGHT: Readonly<Record<MigrationRisk, number>> = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });

export class MigrationManifest {
  private readonly modules = new Map<string, MigrationModule>();
  private readonly transitions: MigrationTransition[] = [];
  private readonly maxModules: number;
  private readonly maxTransitions: number;
  private readonly requireZeroConsumers: boolean;
  private readonly requireParity: boolean;
  private revisionValue = 0;

  public constructor(options: MigrationGateOptions = {}) {
    this.maxModules = Math.max(16, Math.trunc(options.maxModules ?? 512));
    this.maxTransitions = Math.max(64, Math.trunc(options.maxTransitions ?? 4096));
    this.requireZeroConsumers = options.requireZeroConsumersForRetire ?? true;
    this.requireParity = options.requireParityForCutOver ?? true;
  }

  public get revision(): number { return this.revisionValue; }
  public register(module: MigrationModule): boolean {
    if (this.modules.size >= this.maxModules || !validModule(module) || this.modules.has(module.id)) return false;
    this.modules.set(module.id, deepFreeze({ ...module, notes: module.notes ? Object.freeze([...module.notes]) : undefined }));
    this.revisionValue += 1;
    return true;
  }

  public registerMany(modules: readonly MigrationModule[]): number { let count = 0; for (const module of modules) if (this.register(module)) count += 1; return count; }
  public get(id: string): MigrationModule | undefined { const module = this.modules.get(id); return module ? deepFreeze({ ...module }) : undefined; }
  public all(): readonly MigrationModule[] { return Object.freeze([...this.modules.values()].map(module => deepFreeze({ ...module }))); }

  public transition(id: string, target: MigrationStatus, reason: string): EngineResult<MigrationModule> {
    const current = this.modules.get(id);
    if (!current) return fail('MIGRATION_NOT_FOUND');
    const check = this.canTransition(current, target);
    if (!check.ok) return check;
    const next: MigrationModule = Object.freeze({ ...current, status: target });
    this.modules.set(id, next);
    this.revisionValue += 1;
    this.transitions.push(Object.freeze({ moduleId: id, from: current.status, to: target, revision: this.revisionValue, reason: reason || 'transition' }));
    while (this.transitions.length > this.maxTransitions) this.transitions.shift();
    return { ok: true, value: deepFreeze({ ...next }), meta: { status: 'ok', code: 'MIGRATION_TRANSITIONED' } };
  }

  public canTransition(module: MigrationModule, target: MigrationStatus): EngineResult<MigrationModule> {
    const fromIndex = STATUS_ORDER.indexOf(module.status);
    const toIndex = STATUS_ORDER.indexOf(target);
    if (fromIndex < 0 || toIndex < 0) return fail('MIGRATION_STATUS_INVALID');
    if (target === module.status) return fail('MIGRATION_NOOP');
    if (target === 'shadow' && module.status !== 'legacy') return fail('MIGRATION_SHADOW_ORDER');
    if (target === 'ready' && module.status !== 'shadow') return fail('MIGRATION_READY_ORDER');
    if (target === 'cut-over') {
      if (module.status !== 'ready') return fail('MIGRATION_CUTOVER_ORDER');
      if (this.requireParity && module.parityChecks <= 0) return fail('MIGRATION_PARITY_REQUIRED');
    }
    if (target === 'retired') {
      if (module.status !== 'cut-over') return fail('MIGRATION_RETIRE_ORDER');
      if (this.requireZeroConsumers && module.consumers > 0) return fail('MIGRATION_CONSUMERS_REMAIN');
    }
    if (toIndex < fromIndex) return fail('MIGRATION_BACKWARD_TRANSITION');
    return { ok: true, value: module, meta: { status: 'ok', code: 'MIGRATION_ALLOWED' } };
  }

  public transitionsSince(revision = 0): readonly MigrationTransition[] { return Object.freeze(this.transitions.filter(item => item.revision > revision).map(item => deepFreeze({ ...item }))); }

  public report(): MigrationReport {
    let legacy = 0; let shadow = 0; let ready = 0; let cutOver = 0; let retired = 0; let risky = 0; let covered = 0; let possible = 0;
    const blocked: string[] = [];
    for (const module of this.modules.values()) {
      if (module.status === 'legacy') legacy += 1;
      if (module.status === 'shadow') shadow += 1;
      if (module.status === 'ready') ready += 1;
      if (module.status === 'cut-over') cutOver += 1;
      if (module.status === 'retired') retired += 1;
      if (RISK_WEIGHT[module.risk] >= 3) risky += 1;
      possible += Math.max(1, module.consumers + 1);
      covered += Math.min(module.consumers + 1, module.parityChecks + (module.status === 'cut-over' || module.status === 'retired' ? module.consumers + 1 : 0));
      if (module.status === 'ready' && this.requireParity && module.parityChecks <= 0) blocked.push(module.id);
      if (module.status === 'cut-over' && this.requireZeroConsumers && module.consumers > 0) blocked.push(module.id);
      if (module.status === 'legacy' && RISK_WEIGHT[module.risk] >= 4) blocked.push(module.id);
    }
    return Object.freeze({ total: this.modules.size, legacy, shadow, ready, cutOver, retired, risky, blocked: Object.freeze([...new Set(blocked)].sort()), coverage: possible ? covered / possible : 1, revision: this.revisionValue });
  }

  public highestRisk(limit = 16): readonly MigrationModule[] {
    return Object.freeze([...this.modules.values()].sort((a, b) => RISK_WEIGHT[b.risk] - RISK_WEIGHT[a.risk] || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.id.localeCompare(b.id)).slice(0, Math.max(0, Math.trunc(limit))).map(module => deepFreeze({ ...module })));
  }

  public assertCutOverReady(id: string): EngineResult<void> {
    const module = this.modules.get(id);
    if (!module) return fail('MIGRATION_NOT_FOUND');
    if (module.status !== 'ready') return fail('MIGRATION_NOT_READY');
    if (this.requireParity && module.parityChecks <= 0) return fail('MIGRATION_PARITY_REQUIRED');
    return { ok: true, meta: { status: 'ok', code: 'CUTOVER_READY' } };
  }
}

export const defaultMigrationManifest = (): MigrationManifest => {
  const manifest = new MigrationManifest();
  manifest.registerMany([
    module('game3d-entry', 'src/3d/game3d.html-inline', 'src/3d/game3dEntry.ts', 'entry', 'medium', 2, 8, 'runtime'),
    module('event-bus', 'src/3d/eventBus.js', 'src/engine-ts/eventBus.ts', 'world', 'high', 34, 128, 'runtime'),
    module('state', 'src/3d/state.js', 'src/engine-ts/snapshot.ts', 'simulation', 'high', 28, 96, 'runtime'),
    module('input', 'src/3d/input.js', 'src/engine-ts/inputRouter.ts', 'input', 'high', 17, 64, 'runtime'),
    module('asset-loader', 'src/3d/assetLoader.js', 'src/engine-ts/assetRegistry.ts', 'assets', 'high', 21, 72, 'content'),
    module('chunk-streaming', 'src/3d/chunkStreaming.js', 'src/engine-ts/streaming.ts', 'world', 'high', 12, 48, 'world'),
    module('quality', 'src/3d/quality.js', 'src/engine-ts/quality.ts', 'rendering', 'medium', 9, 32, 'rendering'),
    module('render-packet', 'src/3d/gameLoopHelpers.js', 'src/engine-ts/renderPacket.ts', 'rendering', 'medium', 14, 40, 'rendering'),
    module('save', 'src/3d/state.js', 'src/engine-ts/saveSystem.ts', 'persistence', 'critical', 6, 24, 'runtime'),
  ]);
  return manifest;
};

const module = (id: string, legacyPath: string, modernPath: string, surface: MigrationSurface, risk: MigrationRisk, consumers: number, parityChecks: number, owner: string): MigrationModule => Object.freeze({ id, legacyPath, modernPath, surface, status: 'shadow', risk, consumers, contractVersion: 2, parityChecks, owner });
const validModule = (module: MigrationModule): boolean => Boolean(module.id && module.legacyPath && module.modernPath && module.owner) && STATUS_ORDER.includes(module.status) && RISK_WEIGHT[module.risk] > 0 && Number.isInteger(module.consumers) && module.consumers >= 0 && Number.isInteger(module.parityChecks) && module.parityChecks >= 0;
const fail = <T>(code: string): EngineResult<T> => ({ ok: false, meta: { status: 'rejected', code } });
