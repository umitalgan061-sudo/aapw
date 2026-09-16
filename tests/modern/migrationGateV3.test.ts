import { describe, expect, it } from 'vitest';
import { assertV3MigrationReady, canPromote, classifyStage, evaluateV3Migration, riskFor } from '../../src/3d/modern/v3/migrationGate.js';

describe('runtime-v3 migration gate', () => {
  it('classifies typed modules as native only after evidence thresholds', () => {
    expect(classifyStage({ extension: '.ts', runtimeCritical: true, typedImports: 4, unsafeImports: 0, testCoverage: 1, parityEvidence: 1, recoveryEvidence: 1 })).toBe('native');
    expect(classifyStage({ extension: '.ts', runtimeCritical: true, typedImports: 4, unsafeImports: 0, testCoverage: 0.6, parityEvidence: 1, recoveryEvidence: 1 })).toBe('typed');
    expect(classifyStage({ extension: '.js', runtimeCritical: true, typedImports: 2, unsafeImports: 0, testCoverage: 1, parityEvidence: 1, recoveryEvidence: 1 })).toBe('bridge');
  });

  it('blocks critical JavaScript promotion to native ownership', () => {
    const legacy = { path: 'src/3d/game3d.js', extension: '.js' as const, runtimeCritical: true, sideEffects: true, typedImports: 0, unsafeImports: 0, testCoverage: 1, parityEvidence: 1, recoveryEvidence: 1, stage: 'bridge' as const, risk: 'critical' as const };
    expect(riskFor(legacy)).toBe('high');
    expect(canPromote(legacy, 'native')).toBe(false);
    const result = evaluateV3Migration([legacy]);
    expect(result.passed).toBe(false);
    expect(result.blockedModules).toBe(1);
  });

  it('accepts the checked-in V3 inventory', () => {
    expect(() => assertV3MigrationReady()).not.toThrow();
  });
});
