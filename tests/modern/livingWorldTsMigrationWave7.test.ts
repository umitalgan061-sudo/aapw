import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
const modules=[
'livingWorldDirectorScenarioArbitration','livingWorldDirectorScenarioBridge',
'livingWorldDirectorScenarioContract','livingWorldDirectorScenarioPolicy','livingWorldFaunaEncounterDirector',
];
describe('Living World TypeScript migration wave 7',()=>{
  it('keeps legacy JS paths as compatibility barrels',async()=>{
    for(const name of modules){
      const js=await readFile(new URL(`../../src/3d/gameplay/${name}.js`,import.meta.url),'utf8');
      const ts=await readFile(new URL(`../../src/3d/gameplay/${name}.ts`,import.meta.url),'utf8');
      expect(js).toContain('Compatibility boundary:');
      expect(js).toContain(`./${name}.ts`);
      expect(ts).toMatch(/^\/\/ @ts-nocheck/);
    }
  });
});
