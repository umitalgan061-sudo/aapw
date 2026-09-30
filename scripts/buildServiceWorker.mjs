import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const sourcePath = 'service-worker.ts';
const outputPath = 'service-worker.js';
const source = await readFile(sourcePath, 'utf8');
const sourceHash = createHash('sha256').update(source, 'utf8').digest('hex');

const result = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.None,
    removeComments: false,
  },
  fileName: sourcePath,
});

const artifact = [
  `/* generated-from: ${sourcePath}; source-sha256: ${sourceHash} */`,
  result.outputText.replace(/^\/\* generated-from:[\s\S]*?\*\/\s*/u, ''),
].join('\n');

await writeFile(outputPath, artifact, 'utf8');

const emittedHash = createHash('sha256').update(source, 'utf8').digest('hex');
if (emittedHash !== sourceHash) throw new Error('service-worker source hash changed during generation');

console.log(`Service worker generated deterministically from ${sourcePath} -> ${outputPath} (source-sha256=${sourceHash})`);
