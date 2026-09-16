import type { ModuleMigrationRecord, MigrationGateResult, MigrationStage, RiskClass } from '../../types/platform.js';
import { V3_SCHEMA_VERSION, type V3MigrationStage } from './runtimeContracts.js';

export interface V3ModuleRecord {
  readonly path: string;
  readonly extension: '.ts' | '.js';
  readonly runtimeCritical: boolean;
  readonly sideEffects: boolean;
  readonly typedImports: number;
  readonly unsafeImports: number;
  readonly testCoverage: number;
  readonly parityEvidence: number;
  readonly recoveryEvidence: number;
  readonly stage: V3MigrationStage;
  readonly risk: RiskClass;
}

export interface V3MigrationPolicy {
  readonly minimumCoverage: number;
  readonly minimumParity: number;
  readonly minimumRecovery: number;
  readonly allowJsForNonCritical: boolean;
  readonly forbidCriticalJsAtStage: V3MigrationStage;
}

export const DEFAULT_V3_MIGRATION_POLICY: V3MigrationPolicy = Object.freeze({ minimumCoverage: 0.85, minimumParity: 0.9, minimumRecovery: 0.8, allowJsForNonCritical: true, forbidCriticalJsAtStage: 'native' });
const stageRank: Record<V3MigrationStage, number> = Object.freeze({ observe: 0, bridge: 1, typed: 2, native: 3 });
const riskRank: Record<RiskClass, number> = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

export function classifyStage(module: Pick<V3ModuleRecord, 'extension' | 'runtimeCritical' | 'typedImports' | 'unsafeImports' | 'testCoverage' | 'parityEvidence' | 'recoveryEvidence'>): V3MigrationStage {
  if (module.extension === '.js') return module.runtimeCritical && module.typedImports > 0 ? 'bridge' : 'observe';
  if (module.unsafeImports > 0 || module.testCoverage < 0.5) return 'typed';
  if (module.parityEvidence < 0.9 || module.recoveryEvidence < 0.8) return 'typed';
  return 'native';
}

export function riskFor(module: V3ModuleRecord): RiskClass {
  const pressure = (module.runtimeCritical ? 2 : 0) + (module.sideEffects ? 1 : 0) + Math.min(2, module.unsafeImports);
  if (pressure >= 4) return 'critical';
  if (pressure >= 3) return 'high';
  if (pressure >= 2) return 'medium';
  return 'low';
}

export function canPromote(module: V3ModuleRecord, target: V3MigrationStage, policy: V3MigrationPolicy = DEFAULT_V3_MIGRATION_POLICY): boolean {
  if (stageRank[module.stage] > stageRank[target]) return true;
  if (module.unsafeImports > 0) return false;
  if (module.testCoverage < policy.minimumCoverage) return false;
  if (module.parityEvidence < policy.minimumParity) return false;
  if (module.recoveryEvidence < policy.minimumRecovery && module.runtimeCritical) return false;
  if (module.extension === '.js' && module.runtimeCritical && stageRank[target] >= stageRank[policy.forbidCriticalJsAtStage]) return false;
  if (module.extension === '.js' && !module.runtimeCritical && !policy.allowJsForNonCritical) return false;
  return true;
}

export function evaluateV3Migration(modules: readonly V3ModuleRecord[], policy: V3MigrationPolicy = DEFAULT_V3_MIGRATION_POLICY): MigrationGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let migratedModules = 0;
  let bridgeModules = 0;
  let blockedModules = 0;
  for (const module of modules) {
    const derived = classifyStage(module);
    if (derived === 'native') migratedModules += 1;
    if (derived === 'bridge') bridgeModules += 1;
    if (!canPromote(module, derived, policy)) { blockedModules += 1; errors.push(`${module.path}: promotion blocked at ${derived}`); }
    if (module.extension === '.js' && module.runtimeCritical) warnings.push(`${module.path}: critical JS remains behind an adapter`);
    if (riskRank[module.risk] >= riskRank.high) warnings.push(`${module.path}: risk=${module.risk}`);
  }
  return Object.freeze({ passed: errors.length === 0 && blockedModules === 0, migratedModules, bridgeModules, blockedModules, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
}

const toPlatformStage = (stage: V3MigrationStage): MigrationStage => stage === 'typed' ? 'typecheck' : stage;

export function toPlatformRecord(module: V3ModuleRecord): ModuleMigrationRecord {
  const language: ModuleMigrationRecord['language'] = module.extension === '.ts' ? 'typescript' : 'javascript';
  return Object.freeze({ path: module.path, language, stage: toPlatformStage(module.stage), risk: module.risk, runtimeCritical: module.runtimeCritical, hasExternalSideEffects: module.sideEffects, testCoverage: module.testCoverage, dependencyCount: module.typedImports + module.unsafeImports, blockers: Object.freeze(module.unsafeImports > 0 ? ['unsafe-imports'] : []) });
}

export function buildDefaultV3Inventory(): readonly V3ModuleRecord[] {
  return Object.freeze([
    { path: 'src/3d/modern/v3/runtimeContracts.ts', extension: '.ts', runtimeCritical: true, sideEffects: false, typedImports: 5, unsafeImports: 0, testCoverage: 1, parityEvidence: 1, recoveryEvidence: 1, stage: 'native', risk: 'low' },
    { path: 'src/3d/modern/v3/runtimeKernel.ts', extension: '.ts', runtimeCritical: true, sideEffects: false, typedImports: 6, unsafeImports: 0, testCoverage: 0.95, parityEvidence: 0.92, recoveryEvidence: 0.9, stage: 'native', risk: 'medium' },
    { path: 'src/3d/modern/v3/browserFrameSource.ts', extension: '.ts', runtimeCritical: true, sideEffects: true, typedImports: 3, unsafeImports: 0, testCoverage: 0.9, parityEvidence: 0.9, recoveryEvidence: 0.85, stage: 'native', risk: 'medium' },
    { path: 'src/3d/modern/v3/legacyGameAdapter.ts', extension: '.ts', runtimeCritical: true, sideEffects: true, typedImports: 2, unsafeImports: 0, testCoverage: 0.95, parityEvidence: 0.95, recoveryEvidence: 0.9, stage: 'bridge', risk: 'high' },
    { path: 'src/3d/game3d.js', extension: '.js', runtimeCritical: true, sideEffects: true, typedImports: 0, unsafeImports: 0, testCoverage: 0.8, parityEvidence: 0.9, recoveryEvidence: 0.8, stage: 'bridge', risk: 'critical' },
  ]);
}

export function assertV3MigrationReady(modules = buildDefaultV3Inventory(), policy: V3MigrationPolicy = DEFAULT_V3_MIGRATION_POLICY): void {
  const result = evaluateV3Migration(modules, policy);
  if (!result.passed) throw new Error(`V3 migration gate failed: ${result.errors.join('; ')}`);
  if (V3_SCHEMA_VERSION < 1) throw new Error('Unsupported V3 schema version');
}
