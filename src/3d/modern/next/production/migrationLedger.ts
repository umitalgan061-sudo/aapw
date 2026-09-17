import { checksumP, type EventSinkP } from './contracts.ts';

export type MigrationLanguageP = 'typescript' | 'javascript' | 'vendor' | 'asset' | 'unknown';
export type MigrationStageP = 'inventory' | 'typed-contract' | 'shadow' | 'parity' | 'cutover' | 'retired' | 'blocked';
export type MigrationCriticalityP = 'critical' | 'high' | 'normal' | 'low';

export interface MigrationModuleP {
  readonly path: string;
  readonly language: MigrationLanguageP;
  readonly stage: MigrationStageP;
  readonly criticality: MigrationCriticalityP;
  readonly imports: readonly string[];
  readonly importedBy: readonly string[];
  readonly browserEntry: boolean;
  readonly generated: boolean;
  readonly vendor: boolean;
  readonly sizeBytes: number;
}

export interface MigrationLedgerStatsP {
  readonly totalModules: number;
  readonly typedModules: number;
  readonly legacyModules: number;
  readonly vendorModules: number;
  readonly browserEntries: number;
  readonly cutoverReady: number;
  readonly blocked: number;
  readonly typedRatio: number;
  readonly nonVendorTypedRatio: number;
  readonly checksum: number;
}

export interface MigrationGateResultP {
  readonly ok: boolean;
  readonly failures: readonly string[];
  readonly warnings: readonly string[];
  readonly stats: MigrationLedgerStatsP;
}

export interface MigrationLedgerConfigP {
  readonly allowlistedLegacy: readonly string[];
  readonly browserEntries: readonly string[];
  readonly generatedPrefixes: readonly string[];
  readonly minimumTypedRatio: number;
  readonly minimumCriticalTypedRatio: number;
}

export const DEFAULT_MIGRATION_CONFIG_P: MigrationLedgerConfigP = Object.freeze({
  allowlistedLegacy: Object.freeze(['src/3d/vendor/']),
  browserEntries: Object.freeze(['game3d.html', 'editor.html', 'rts.html']),
  generatedPrefixes: Object.freeze(['src/3d/vendor/', 'assets/']),
  minimumTypedRatio: 0.65,
  minimumCriticalTypedRatio: 0.9,
});

const normalize = (path: string): string => path.replaceAll('\\', '/').replace(/^\.\//, '');
const isTs = (path: string): boolean => /\.(ts|tsx)$/.test(path);
const isJs = (path: string): boolean => /\.(js|jsx)$/.test(path);
const isVendor = (path: string, config: MigrationLedgerConfigP): boolean => config.allowlistedLegacy.some(prefix => path.startsWith(prefix));
const criticality = (path: string): MigrationCriticalityP => {
  if (/(^|\/)(game3d|editor|rts)\.(html|js|ts)$/.test(path)) return 'critical';
  if (/^src\/3d\/(gameplay|world|core|network|rendering)\//.test(path)) return 'high';
  if (/^src\/(engine|shared|ui)\//.test(path)) return 'normal';
  return 'low';
};

export function classifyModuleP(pathValue: string, sizeBytes = 0, config: MigrationLedgerConfigP = DEFAULT_MIGRATION_CONFIG_P): MigrationModuleP {
  const path = normalize(pathValue);
  const vendor = isVendor(path, config);
  const language: MigrationLanguageP = vendor ? 'vendor' : isTs(path) ? 'typescript' : isJs(path) ? 'javascript' : path.startsWith('assets/') ? 'asset' : 'unknown';
  const stage: MigrationStageP = language === 'typescript' ? 'cutover' : language === 'vendor' ? 'retired' : language === 'javascript' ? 'inventory' : 'inventory';
  return Object.freeze({ path, language, stage, criticality: criticality(path), imports: [], importedBy: [], browserEntry: config.browserEntries.includes(path), generated: config.generatedPrefixes.some(prefix => path.startsWith(prefix)), vendor, sizeBytes: Math.max(0, Math.trunc(sizeBytes)) });
}

export class TypeScriptMigrationLedgerP {
  readonly config: MigrationLedgerConfigP;
  readonly #modules = new Map<string, MigrationModuleP>();
  readonly #events?: EventSinkP;

  constructor(config: Partial<MigrationLedgerConfigP> = {}, events?: EventSinkP) {
    this.config = Object.freeze({
      allowlistedLegacy: Object.freeze([...(config.allowlistedLegacy ?? DEFAULT_MIGRATION_CONFIG_P.allowlistedLegacy)]),
      browserEntries: Object.freeze([...(config.browserEntries ?? DEFAULT_MIGRATION_CONFIG_P.browserEntries)]),
      generatedPrefixes: Object.freeze([...(config.generatedPrefixes ?? DEFAULT_MIGRATION_CONFIG_P.generatedPrefixes)]),
      minimumTypedRatio: Math.min(1, Math.max(0, config.minimumTypedRatio ?? DEFAULT_MIGRATION_CONFIG_P.minimumTypedRatio)),
      minimumCriticalTypedRatio: Math.min(1, Math.max(0, config.minimumCriticalTypedRatio ?? DEFAULT_MIGRATION_CONFIG_P.minimumCriticalTypedRatio)),
    });
    this.#events = events;
  }

  register(module: MigrationModuleP): void {
    const path = normalize(module.path);
    if (this.#modules.has(path)) throw new Error(`duplicate migration module: ${path}`);
    const normalized = Object.freeze({ ...module, path, imports: Object.freeze(module.imports.map(normalize).sort()), importedBy: Object.freeze(module.importedBy.map(normalize).sort()) });
    this.#modules.set(path, normalized);
  }

  registerMany(modules: readonly MigrationModuleP[]): void { for (const module of modules) this.register(module); }

  update(pathValue: string, patch: Partial<Omit<MigrationModuleP, 'path'>>): void {
    const path = normalize(pathValue);
    const current = this.#modules.get(path);
    if (!current) throw new Error(`migration module not found: ${path}`);
    this.#modules.set(path, Object.freeze({ ...current, ...patch, path, imports: Object.freeze([...(patch.imports ?? current.imports)].map(normalize).sort()), importedBy: Object.freeze([...(patch.importedBy ?? current.importedBy)].map(normalize).sort()) }));
  }

  link(importerValue: string, dependencyValue: string): void {
    const importer = normalize(importerValue);
    const dependency = normalize(dependencyValue);
    const source = this.#modules.get(importer);
    const target = this.#modules.get(dependency);
    if (!source || !target) return;
    this.update(importer, { imports: [...source.imports.filter(item => item !== dependency), dependency] });
    this.update(dependency, { importedBy: [...target.importedBy.filter(item => item !== importer), importer] });
  }

  stage(pathValue: string, next: MigrationStageP): void {
    const path = normalize(pathValue);
    const current = this.#modules.get(path);
    if (!current) throw new Error(`migration module not found: ${path}`);
    const allowed = canAdvance(current.stage, next);
    if (!allowed) throw new Error(`illegal migration stage transition ${current.stage} -> ${next} for ${path}`);
    this.update(path, { stage: next });
  }

  get(pathValue: string): MigrationModuleP | undefined { return this.#modules.get(normalize(pathValue)); }
  list(): readonly MigrationModuleP[] { return Object.freeze([...this.#modules.values()].sort((a, b) => a.path.localeCompare(b.path))); }

  stats(): MigrationLedgerStatsP {
    const modules = this.list();
    const nonGenerated = modules.filter(module => !module.generated || !module.vendor);
    const typed = modules.filter(module => module.language === 'typescript').length;
    const legacy = modules.filter(module => module.language === 'javascript').length;
    const vendor = modules.filter(module => module.vendor).length;
    const entries = modules.filter(module => module.browserEntry).length;
    const ready = modules.filter(module => module.stage === 'cutover' || module.stage === 'retired').length;
    const blocked = modules.filter(module => module.stage === 'blocked').length;
    const nonVendor = modules.filter(module => module.language !== 'vendor' && module.language !== 'asset');
    const nonVendorTyped = nonVendor.filter(module => module.language === 'typescript').length;
    return Object.freeze({ totalModules: modules.length, typedModules: typed, legacyModules: legacy, vendorModules: vendor, browserEntries: entries, cutoverReady: ready, blocked, typedRatio: modules.length ? typed / modules.length : 1, nonVendorTypedRatio: nonVendor.length ? nonVendorTyped / nonVendor.length : 1, checksum: checksumP(modules.map(module => ({ path: module.path, language: module.language, stage: module.stage, imports: module.imports }))) });
  }

  evaluate(strict = this.config.minimumTypedRatio > 0): MigrationGateResultP {
    const failures: string[] = [];
    const warnings: string[] = [];
    const modules = this.list();
    for (const module of modules) {
      if (module.vendor) continue;
      if (module.language === 'unknown' && /^(src|scripts)\//.test(module.path)) failures.push(`unknown source language: ${module.path}`);
      if (module.language === 'javascript' && module.criticality === 'critical' && module.stage === 'cutover') failures.push(`critical JavaScript incorrectly marked cutover: ${module.path}`);
      if (module.language === 'typescript' && module.path.endsWith('.js')) failures.push(`TypeScript module has JavaScript extension: ${module.path}`);
      if (module.stage === 'retired' && module.language === 'javascript') failures.push(`legacy JavaScript marked retired without implementation replacement: ${module.path}`);
      if (module.browserEntry && module.language === 'javascript') warnings.push(`browser boundary still references legacy implementation: ${module.path}`);
      for (const dependency of module.imports) {
        if (module.language === 'typescript' && isJs(dependency) && !isVendor(dependency, this.config)) failures.push(`${module.path} imports legacy JavaScript: ${dependency}`);
      }
    }
    const stats = this.stats();
    if (strict && stats.nonVendorTypedRatio < this.config.minimumTypedRatio) failures.push(`typed ratio below floor ${stats.nonVendorTypedRatio.toFixed(3)} < ${this.config.minimumTypedRatio.toFixed(3)}`);
    const critical = modules.filter(module => module.criticality === 'critical' && !module.vendor);
    const criticalTyped = critical.filter(module => module.language === 'typescript').length;
    const criticalRatio = critical.length ? criticalTyped / critical.length : 1;
    if (strict && criticalRatio < this.config.minimumCriticalTypedRatio) failures.push(`critical typed ratio below floor ${criticalRatio.toFixed(3)} < ${this.config.minimumCriticalTypedRatio.toFixed(3)}`);
    const result = Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures), warnings: Object.freeze(warnings), stats });
    this.#events?.emit('telemetry:health', Object.freeze({ state: result.ok ? 'healthy' : 'critical', score: Math.max(0, 100 - failures.length * 10), frameMs: 0, memoryMb: stats.totalModules / 1024, networkRttMs: 0, assetQueue: 0, workerQueue: 0, recommendations: Object.freeze(result.warnings) }));
    return result;
  }

  digest(): number { return this.stats().checksum; }
}

function canAdvance(current: MigrationStageP, next: MigrationStageP): boolean {
  if (current === next) return true;
  const order: readonly MigrationStageP[] = ['inventory', 'typed-contract', 'shadow', 'parity', 'cutover', 'retired'];
  if (current === 'blocked') return next === 'inventory' || next === 'typed-contract';
  if (next === 'blocked') return true;
  const currentIndex = order.indexOf(current);
  const nextIndex = order.indexOf(next);
  return currentIndex >= 0 && nextIndex >= 0 && (nextIndex === currentIndex + 1 || next === 'retired');
}

export interface ImportGraphNodeP { readonly path: string; readonly dependencies: readonly string[]; readonly dependents: readonly string[]; }

export function buildImportGraphP(modules: readonly MigrationModuleP[]): readonly ImportGraphNodeP[] {
  const map = new Map(modules.map(module => [module.path, module]));
  return Object.freeze(modules.map(module => Object.freeze({ path: module.path, dependencies: Object.freeze(module.imports.filter(path => map.has(path)).sort()), dependents: Object.freeze(module.importedBy.filter(path => map.has(path)).sort()) })).sort((a, b) => a.path.localeCompare(b.path)));
}
