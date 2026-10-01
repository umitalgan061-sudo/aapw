import { describe, expect, it } from 'vitest';
import { migrateWorldSnapshot, migrateSaveEnvelope } from '../../../src/3d/strict/r37/runtimeMigration.ts';
import { QualityPolicyR37 } from '../../../src/3d/strict/r37/qualityPolicy.ts';
import { CommandBusR37 } from '../../../src/3d/strict/r37/commandBus.ts';

describe('R37 migration/quality/command lifecycle', () => {
  it('migrates a legacy world payload into schema 37', () => {
    const result = migrateWorldSnapshot({
      version: 1,
      seed: 77,
      tick: 4,
      entities: [{ id: 'legacy-player', position: { x: 1, y: 2, z: 3 } }],
      flags: { tutorial: true },
      values: { gold: 12 },
    });
    expect(result.snapshot.version).toBe(37);
    expect(result.snapshot.entities[0]?.data.migrated).toBe(true);
    expect(result.report.changed).toBe(true);

    const save = migrateSaveEnvelope({ schema: 4, world: { version: 4, entities: [] } });
    expect(save.schema).toBe(37);
  });

  it('keeps mobile and reduced-motion policy bounded', () => {
    const policy = new QualityPolicyR37();
    expect(policy.resolve('ultra', { coarsePointer: true }).tier).toBe('low');
    expect(policy.resolve('ultra', { reducedMotion: true }).tier).toBe('balanced');
    expect(policy.nextLower('high')).toBe('balanced');
    expect(policy.nextHigher('high')).toBe('ultra');
  });

  it('fully resets command history', () => {
    const commands = new CommandBusR37();
    commands.dispatch({ tick: 1, kind: 'custom', source: 'test', payload: {} });
    commands.emit(1, 'custom:event', 'test');
    commands.clear();
    expect(commands.recentCommands()).toHaveLength(0);
    expect(commands.recentEvents()).toHaveLength(0);
    expect(commands.checksum()).toBe('[]');
  });
});
