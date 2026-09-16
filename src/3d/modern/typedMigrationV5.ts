import { RuntimeV4Facade } from './runtimeV4Facade';
import { MigrationRegistryV4, type MigrationSurfaceV4 } from './migrationV4';
import type { QualityTierV4 } from './runtimeContractsV4';

export type TypedCutoverStatusV5 = 'inventory' | 'typed-shadow' | 'parity' | 'promoted' | 'blocked';
export type SourceLanguageV5 = 'typescript' | 'javascript' | 'vendor';

export interface SourceModuleV5 {
  readonly path: string;
  readonly language: SourceLanguageV5;
  readonly surface: MigrationSurfaceV4;
  readonly criticality: 0 | 1 | 2 | 3 | 4;
  readonly browserBoundary: boolean;
  readonly legacyImportCount: number;
  readonly typedImportCount: number;
}

export interface TypedCutoverRecordV5 {
  readonly surface: MigrationSurfaceV4;
  readonly status: TypedCutoverStatusV5;
  readonly typedRatio: number;
  readonly legacyModules: number;
  readonly typedModules: number;
  readonly paritySamples: number;
  readonly lastDigest: string;
}

export interface TypedCutoverPlanV5 {
  readonly version: 5;
  readonly modules: readonly SourceModuleV5[];
  readonly records: readonly TypedCutoverRecordV5[];
  readonly strict: boolean;
  readonly generatedAt: 'source-controlled';
}

const SURFACES: readonly MigrationSurfaceV4[] = ['input', 'movement', 'camera', 'world', 'render', 'audio', 'assets', 'save', 'network', 'telemetry'];

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, finite(value, min)));
const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const classifySourceModuleV5 = (input: { path: string; surface: MigrationSurfaceV4; criticality?: 0 | 1 | 2 | 3 | 4; browserBoundary?: boolean; legacyImportCount?: number; typedImportCount?: number }): SourceModuleV5 => {
  const language: SourceLanguageV5 = input.path.startsWith('src/3d/vendor/') ? 'vendor' : /\.(ts|tsx)$/.test(input.path) ? 'typescript' : 'javascript';
  return Object.freeze({ path: input.path, language, surface: input.surface, criticality: input.criticality ?? 2, browserBoundary: input.browserBoundary ?? input.path.startsWith('src/3d/'), legacyImportCount: Math.max(0, Math.trunc(input.legacyImportCount ?? 0)), typedImportCount: Math.max(0, Math.trunc(input.typedImportCount ?? 0)) });
};

export const buildTypedCutoverPlanV5 = (modules: readonly SourceModuleV5[], strict = true): TypedCutoverPlanV5 => {
  const records = SURFACES.map((surface) => {
    const surfaceModules = modules.filter(module => module.surface === surface && module.language !== 'vendor');
    const typedModules = surfaceModules.filter(module => module.language === 'typescript').length;
    const legacyModules = surfaceModules.filter(module => module.language === 'javascript').length;
    const total = typedModules + legacyModules;
    const typedRatio = total > 0 ? typedModules / total : 0;
    const paritySamples = Math.min(32, Math.max(0, typedModules * 2));
    const status: TypedCutoverStatusV5 = typedRatio >= 1 ? 'promoted' : paritySamples > 0 ? (typedRatio >= 0.5 ? 'parity' : 'typed-shadow') : 'inventory';
    return Object.freeze({ surface, status, typedRatio, legacyModules, typedModules, paritySamples, lastDigest: digest({ surface, typedRatio, legacyModules, typedModules, paritySamples }) });
  });
  return Object.freeze({ version: 5, modules: Object.freeze([...modules]), records: Object.freeze(records), strict, generatedAt: 'source-controlled' });
};

export const assertTypedCutoverPlanV5 = (plan: TypedCutoverPlanV5): void => {
  if (plan.version !== 5) throw new Error('typed cutover plan version mismatch');
  if (plan.generatedAt !== 'source-controlled') throw new Error('typed cutover plan must be reproducible');
  const paths = new Set<string>();
  for (const module of plan.modules) {
    if (paths.has(module.path)) throw new Error(`duplicate source module ${module.path}`);
    paths.add(module.path);
    if (module.language === 'typescript' && /\.js$/.test(module.path)) throw new Error(`typescript module has js extension: ${module.path}`);
    if (module.language === 'javascript' && /\.ts$/.test(module.path)) throw new Error(`javascript module has ts extension: ${module.path}`);
    if (module.language !== 'vendor' && module.browserBoundary && module.path.includes('/vendor/')) throw new Error(`vendor module incorrectly marked as browser migration boundary: ${module.path}`);
  }
  for (const record of plan.records) {
    if (record.typedRatio < 0 || record.typedRatio > 1) throw new Error(`invalid typed ratio for ${record.surface}`);
    if (record.status === 'promoted' && record.legacyModules > 0) throw new Error(`${record.surface} marked promoted with legacy modules remaining`);
    if (plan.strict && record.status === 'promoted' && record.paritySamples === 0) throw new Error(`${record.surface} promoted without parity samples`);
  }
};

export interface CutoverEvidenceV5 {
  readonly surface: MigrationSurfaceV4;
  readonly legacy: unknown;
  readonly modern: unknown;
  readonly matched: boolean;
  readonly quality: QualityTierV4;
}

export class TypedCutoverCoordinatorV5 {
  readonly facade: RuntimeV4Facade;
  readonly migration: MigrationRegistryV4;
  readonly records = new Map<MigrationSurfaceV4, CutoverEvidenceV5[]>();
  private disposed = false;

  constructor(facade: RuntimeV4Facade) {
    this.facade = facade;
    this.migration = new MigrationRegistryV4(facade.id);
    for (const surface of SURFACES) this.records.set(surface, []);
  }

  sample(surface: MigrationSurfaceV4, legacy: unknown, modern: unknown): CutoverEvidenceV5 {
    this.ensureLive();
    const quality = this.facade.runtime.render.quality();
    const legacyText = JSON.stringify(legacy);
    const modernText = JSON.stringify(modern);
    const evidence = Object.freeze({ surface, legacy, modern, matched: digest(legacyText) === digest(modernText), quality });
    const samples = this.records.get(surface)!;
    samples.push(evidence);
    while (samples.length > 64) samples.shift();
    this.migration.record(surface, legacy, modern, 'system');
    return evidence;
  }

  promote(surface: MigrationSurfaceV4): boolean {
    this.ensureLive();
    return this.migration.promote(surface).ok;
  }

  status(surface: MigrationSurfaceV4): TypedCutoverStatusV5 {
    const record = this.migration.report().records.find(entry => entry.surface === surface);
    if (!record) return 'inventory';
    if (record.status === 'promoted') return 'promoted';
    if (record.status === 'blocked') return 'blocked';
    if (record.status === 'parity') return 'parity';
    return record.attempts > 0 ? 'typed-shadow' : 'inventory';
  }

  parityCount(surface: MigrationSurfaceV4): number { return this.records.get(surface)?.filter(sample => sample.matched).length ?? 0; }

  canPromote(surface: MigrationSurfaceV4, minimumSamples = 3): boolean {
    return this.parityCount(surface) >= Math.max(1, Math.trunc(minimumSamples)) && this.migration.status(surface) !== 'blocked';
  }

  report(): Readonly<Record<MigrationSurfaceV4, { status: TypedCutoverStatusV5; parity: number }>> {
    const output = {} as Record<MigrationSurfaceV4, { status: TypedCutoverStatusV5; parity: number }>;
    for (const surface of SURFACES) output[surface] = Object.freeze({ status: this.status(surface), parity: this.parityCount(surface) });
    return Object.freeze(output);
  }

  dispose(): void { this.disposed = true; this.records.clear(); }
  private ensureLive(): void { if (this.disposed) throw new Error('typed cutover coordinator disposed'); }
}

export interface TypedBoundaryPolicyV5 {
  readonly allowLegacyRuntime: boolean;
  readonly allowNewJavascript: boolean;
  readonly allowVendorJavascript: boolean;
  readonly minimumTypedRatio: number;
  readonly promotedSurfaces: readonly MigrationSurfaceV4[];
}

export const DEFAULT_TYPED_BOUNDARY_POLICY_V5: TypedBoundaryPolicyV5 = Object.freeze({
  allowLegacyRuntime: true,
  allowNewJavascript: false,
  allowVendorJavascript: true,
  minimumTypedRatio: 0.8,
  promotedSurfaces: Object.freeze([]),
});

export const validateBoundaryPolicyV5 = (plan: TypedCutoverPlanV5, policy: TypedBoundaryPolicyV5 = DEFAULT_TYPED_BOUNDARY_POLICY_V5): void => {
  assertTypedCutoverPlanV5(plan);
  if (!policy.allowNewJavascript && plan.modules.some(module => module.language === 'javascript' && module.criticality >= 3 && module.path.startsWith('src/engine-ts/'))) throw new Error('new high-criticality JavaScript is forbidden inside typed engine');
  for (const surface of policy.promotedSurfaces) {
    const record = plan.records.find(candidate => candidate.surface === surface);
    if (!record || record.status !== 'promoted') throw new Error(`promoted surface lacks a promoted record: ${surface}`);
  }
  const nonVendor = plan.modules.filter(module => module.language !== 'vendor');
  const typed = nonVendor.filter(module => module.language === 'typescript').length;
  const ratio = nonVendor.length > 0 ? typed / nonVendor.length : 1;
  if (ratio < clamp(policy.minimumTypedRatio)) throw new Error(`typed ratio below policy floor: ${ratio.toFixed(3)}`);
};
