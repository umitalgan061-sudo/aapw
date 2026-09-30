import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { R32_TOOLING_MIGRATION, toolingMigrationCoverage } from '../../src/3d/modern/migrationLedgerR32.ts';

describe('R32 tooling migration', () => {
  it('tracks eight production TypeScript QA owners at full migration coverage', () => {
    expect(R32_TOOLING_MIGRATION.version).toBe(32);
    expect(R32_TOOLING_MIGRATION.scripts).toHaveLength(8);
    expect(R32_TOOLING_MIGRATION.scripts.every((entry) => entry.status === 'migrated')).toBe(true);
    expect(toolingMigrationCoverage()).toBe(100);
  });

  it('keeps compatibility launchers and browser artifact source traceable', async () => {
    for (const entry of R32_TOOLING_MIGRATION.scripts) {
      const ts = await readFile(entry.source, 'utf8');
      const js = await readFile(entry.compatibilitySurface, 'utf8');
      expect(ts).toContain('// @ts-nocheck');
      expect(js).toContain(entry.source.split('/').pop());
      expect(js).toContain('--experimental-strip-types');
    }

    const worker = await readFile(R32_TOOLING_MIGRATION.browserArtifact.source, 'utf8');
    const artifact = await readFile(R32_TOOLING_MIGRATION.browserArtifact.output, 'utf8');
    expect(worker.length).toBeGreaterThan(0);
    expect(artifact).toContain('service-worker.ts');
  });
});
