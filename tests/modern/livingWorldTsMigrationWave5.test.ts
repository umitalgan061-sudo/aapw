import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const modules=[
'livingWorldStimulusAdapter','livingWorldStimulusRolePolicy','worldShelterContext',
'livingWorldStimulusAudit','settlementCampaignTelemetry','settlementCampaignSaveSlots','worldOpportunityEvidence',
];

describe('Living World TypeScript migration wave 5',()=>{
  it('keeps legacy module paths as TS compatibility barrels',async()=>{
    for(const name of modules){
      const js=await readFile(new URL(`../../src/3d/gameplay/${name}.js`,import.meta.url),'utf8');
      const ts=await readFile(new URL(`../../src/3d/gameplay/${name}.ts`,import.meta.url),'utf8');
      expect(js).toContain('Compatibility boundary:');
      expect(js).toContain(`./${name}.ts`);
      expect(ts).toMatch(/^\/\/ @ts-nocheck/);
    }
  });
});
