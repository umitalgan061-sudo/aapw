import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS = [
  { legacy: 'src/3d/auroraRealism.js', modern: 'src/3d/auroraRealism.ts' },
  { legacy: 'src/3d/gameplay/animalConfig.js', modern: 'src/3d/gameplay/animalConfig.ts' },
  { legacy: 'src/3d/gameplay/interactionFieldReadiness.js', modern: 'src/3d/gameplay/interactionFieldReadiness.ts' },
  { legacy: 'src/3d/gameplay/livingWorldStimulusAdapter.js', modern: 'src/3d/gameplay/livingWorldStimulusAdapter.ts' },
  { legacy: 'src/3d/gameplay/livingWorldStimulusAudit.js', modern: 'src/3d/gameplay/livingWorldStimulusAudit.ts' },
  { legacy: 'src/3d/gameplay/livingWorldStimulusRolePolicy.js', modern: 'src/3d/gameplay/livingWorldStimulusRolePolicy.ts' },
  { legacy: 'src/3d/gameplay/settlementCampaignSaveSlots.js', modern: 'src/3d/gameplay/settlementCampaignSaveSlots.ts' },
  { legacy: 'src/3d/gameplay/settlementCampaignTelemetry.js', modern: 'src/3d/gameplay/settlementCampaignTelemetry.ts' },
  { legacy: 'src/3d/gameplay/worldOpportunityEvidence.js', modern: 'src/3d/gameplay/worldOpportunityEvidence.ts' },
  { legacy: 'src/3d/gameplay/worldShelterContext.js', modern: 'src/3d/gameplay/worldShelterContext.ts' },
  { legacy: 'src/3d/gameplay/livingWorldEcologyPolicy.js', modern: 'src/3d/gameplay/livingWorldEcologyPolicy.ts' },
  { legacy: 'src/3d/gameplay/livingWorldEventDirectorAdapter.js', modern: 'src/3d/gameplay/livingWorldEventDirectorAdapter.ts' },
  { legacy: 'src/3d/gameplay/livingWorldFaunaActivityBudget.js', modern: 'src/3d/gameplay/livingWorldFaunaActivityBudget.ts' },
  { legacy: 'src/3d/gameplay/livingWorldFaunaHabitatBalancer.js', modern: 'src/3d/gameplay/livingWorldFaunaHabitatBalancer.ts' },
  { legacy: 'src/3d/gameplay/livingWorldFaunaSignalRouter.js', modern: 'src/3d/gameplay/livingWorldFaunaSignalRouter.ts' },
  { legacy: 'src/3d/gameplay/livingWorldGroupAiPolicy.js', modern: 'src/3d/gameplay/livingWorldGroupAiPolicy.ts' },
  { legacy: 'src/3d/gameplay/livingWorldGroupDirectorAdapter.js', modern: 'src/3d/gameplay/livingWorldGroupDirectorAdapter.ts' },
];

describe('TypeScript production migration wave 7', () => {
  it('has a TypeScript owner and a minimal legacy barrel for every migrated surface', () => {
    for (const entry of MIGRATIONS) {
      const modern = readFileSync(resolve(ROOT, entry.modern), 'utf8');
      const legacy = readFileSync(resolve(ROOT, entry.legacy), 'utf8');
      expect(modern.startsWith('// @ts-nocheck\n')).toBe(true);
      expect(legacy).toContain(`export * from './${entry.legacy.split('/').pop().replace(/\.js$/,'.ts')}';`);
      expect(legacy.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(4);
    }
  });

  it('keeps the two current modern runtime blocker fixes present', () => {
    const interest = readFileSync(resolve(ROOT, 'src/3d/modern/production-v7/interestManager.ts'), 'utf8');
    const combat = readFileSync(resolve(ROOT, 'src/3d/modern/combatAuthority.ts'), 'utf8');
    expect(interest).not.toContain('typeof this.#distances');
    expect(combat).toContain('const dt = clamp(deltaMs, 0, 5000);');
  });
});
