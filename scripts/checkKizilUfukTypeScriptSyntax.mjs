import ts from 'typescript';
import { readFile } from 'node:fs/promises';

const files = process.argv.slice(2);
if (files.length === 0) throw new Error('No TypeScript files supplied');
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      verbatimModuleSyntax: true,
      allowImportingTsExtensions: true,
    },
    fileName: file,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    console.error('TypeScript syntax diagnostics for', file);
    for (const d of errors) console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    process.exitCode = 1;
  } else {
    console.log('[Kızıl Ufuk compile] PASS', file);
  }
}
