import type { Backend, QualityTier } from './runtimeContract.js';

export type SourceLanguage = 'javascript' | 'typescript';
export type MigrationStage = 'observe' | 'typecheck' | 'bridge' | 'native';
export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

export interface ModuleMigrationRecord {
  readonly path: string;
  readonly language: SourceLanguage;
  readonly stage: MigrationStage;
  readonly risk: RiskClass;
  readonly runtimeCritical: boolean;
  readonly hasExternalSideEffects: boolean;
  readonly testCoverage: number;
  readonly dependencyCount: number;
  readonly blockers: readonly string[];
}

export interface MigrationPolicy {
  readonly targetLanguage: 'typescript';
  readonly compilerMajor: 7;
  readonly maxRisk: RiskClass;
  readonly minimumCoverage: number;
  readonly allowJsBridge: boolean;
  readonly requireStrict: boolean;
  readonly forbiddenPatterns: readonly string[];
}

export interface MigrationGateResult {
  readonly passed: boolean;
  readonly migratedModules: number;
  readonly bridgeModules: number;
  readonly blockedModules: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export const DEFAULT_MIGRATION_POLICY: MigrationPolicy = Object.freeze({
  targetLanguage: 'typescript',
  compilerMajor: 7,
  maxRisk: 'high',
  minimumCoverage: 0.80,
  allowJsBridge: true,
  requireStrict: true,
  forbiddenPatterns: [
    'eval(',
    'new Function(',
    'document.write(',
    'innerHTML =',
    'localStorage.clear(',
  ],
});

const riskWeight: Record<RiskClass, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function isRiskAllowed(record: ModuleMigrationRecord, policy: MigrationPolicy): boolean {
  return riskWeight[record.risk] <= riskWeight[policy.maxRisk];
}

export function evaluateMigration(records: readonly ModuleMigrationRecord[], policy = DEFAULT_MIGRATION_POLICY): MigrationGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let migratedModules = 0;
  let bridgeModules = 0;
  let blockedModules = 0;

  for (const record of records) {
    if (!isRiskAllowed(record, policy)) {
      blockedModules += 1;
      errors.push(`${record.path}: risk ${record.risk} exceeds migration policy`);
      continue;
    }
    if (record.language === 'typescript' && record.stage === 'native') migratedModules += 1;
    if (record.language === 'javascript' && record.stage === 'bridge') bridgeModules += 1;
    if (record.testCoverage < policy.minimumCoverage && record.runtimeCritical) {
      warnings.push(`${record.path}: runtime-critical module is below coverage threshold`);
    }
    if (!policy.allowJsBridge && record.language === 'javascript') {
      errors.push(`${record.path}: JavaScript bridge is disabled`);
    }
    for (const blocker of record.blockers) {
      errors.push(`${record.path}: ${blocker}`);
    }
  }

  return {
    passed: errors.length === 0,
    migratedModules,
    bridgeModules,
    blockedModules,
    errors,
    warnings,
  };
}

export interface TypedRendererHandle {
  readonly backend: Backend;
  readonly tier: QualityTier;
  readonly render(frame: unknown): void | Promise<void>;
  readonly resize(width: number, height: number, pixelRatio: number): void;
  readonly dispose: () => void;
}

export function assertTypedRenderer(handle: unknown): asserts handle is TypedRendererHandle {
  if (!handle || typeof handle !== 'object') throw new TypeError('Renderer handle is not an object');
  const value = handle as Record<string, unknown>;
  if (value.backend !== 'webgpu' && value.backend !== 'webgl2') throw new TypeError('Renderer backend is invalid');
  if (typeof value.render !== 'function' || typeof value.resize !== 'function' || typeof value.dispose !== 'function') {
    throw new TypeError('Renderer handle does not satisfy typed contract');
  }
}
