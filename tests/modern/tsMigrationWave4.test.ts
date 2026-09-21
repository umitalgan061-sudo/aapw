import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const modules=[
  ['auroraRealism','../../src/3d/'],
  ['animalConfig','../../src/3d/gameplay/'],
  ['interactionFieldReadiness','../../src/3d/gameplay/'],
];

describe('TypeScript migration wave 4',()=>{
  it('keeps legacy JS surfaces as compatibility barrels',async()=>{
    for(const [name,prefix] of modules){
      const js=await readFile(new URL(`${prefix}${name}.js`,import.meta.url),'utf8');
      const ts=await readFile(new URL(`${prefix}${name}.ts`,import.meta.url),'utf8');
      expect(js).toContain('Compatibility boundary:');
      expect(js).toContain(`./${name}.ts`);
      expect(ts).toMatch(/^\/\/ @ts-nocheck/);
    }
  });
});
