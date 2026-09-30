import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const sourcePath = 'service-worker.ts';
const outputPath = 'service-worker.js';
const source = await readFile(sourcePath, 'utf8');

const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.None,
    removeComments: false,
  },
  fileName: sourcePath,
});

await writeFile(outputPath, result.outputText, 'utf8');
console.log('Service worker generated from service-worker.ts -> service-worker.js');
