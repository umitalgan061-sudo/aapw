import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const modules=[
'EditorGamePatchPreviewGate','EditorInstanceEditCoordinatorSafe','EditorInstancePointerOwnership','EditorInstanceLifecycleSafety',
];

describe('Editor TypeScript migration wave 11',()=>{
 it('keeps legacy JS paths as compatibility barrels',async()=>{
  for(const name of modules){
   const js=await readFile(new URL(`../../src/3d/editor/${name}.js`,import.meta.url),'utf8');
   const ts=await readFile(new URL(`../../src/3d/editor/${name}.ts`,import.meta.url),'utf8');
   expect(js).toContain('Compatibility boundary:');
   expect(js).toContain(`./${name}.ts`);
   expect(ts).toMatch(/^\/\/ @ts-nocheck/);
  }
 });
});
