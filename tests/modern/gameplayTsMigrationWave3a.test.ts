import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const modules=['dialogueChoices','interactionConfig','interactionEconomy','livingWorldAssetEvidencePolicy'];

describe('gameplay TS migration wave 3a',()=>{
  it('keeps legacy import paths as compatibility barrels',async()=>{
    for(const name of modules){
      const js=await readFile(new URL(`../../src/3d/gameplay/${name}.js`,import.meta.url),'utf8');
      const ts=await readFile(new URL(`../../src/3d/gameplay/${name}.ts`,import.meta.url),'utf8');
      expect(js).toContain('Compatibility boundary:');
      expect(js).toContain(`./${name}.ts`);
      expect(ts).toMatch(/^\/\/ @ts-nocheck/);
    }
  });
});
