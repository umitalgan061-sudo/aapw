import { readFile } from 'node:fs/promises';

const owners = [
  'src/3d/runtime/runtimeSignalAdapters.ts',
  'src/3d/runtime/deterministicRuntimeScheduler.ts',
  'src/3d/runtime/runtimeFeatureFlagRegistry.ts',
  'src/3d/runtime/runtimeHealthMonitor.ts',
  'src/3d/runtime/modernRuntimeDiagnostics.ts',
  'src/3d/runtime/platformCapabilityProbe.ts',
];
const failures = [];
for (const path of owners) {
  const source = await readFile(path, 'utf8').catch(() => null);
  if (!source) {
    failures.push(`${path}: missing`);
    continue;
  }
  if (/^\s*\/\/\s*@ts-nocheck\b/m.test(source)) failures.push(`${path}: TypeScript escape hatch remains`);
}
const facade = await readFile('src/3d/runtime/modernRuntimeFacade.ts', 'utf8').catch(() => '');
for (const specifier of ['./deterministicRuntimeScheduler.ts', './runtimeHealthMonitor.ts', './platformCapabilityProbe.ts']) {
  if (!facade.includes(`from '${specifier}'`)) failures.push(`modernRuntimeFacade.ts: typed import missing for ${specifier}`);
}
const diagnostics = await readFile('src/3d/runtime/modernRuntimeDiagnostics.ts', 'utf8').catch(() => '');
if (!diagnostics.includes("from './modernRuntimeContract.ts'")) failures.push('modernRuntimeDiagnostics.ts: typed contract import missing');
if (!diagnostics.includes("from './assetResidencyCache.ts'")) failures.push('modernRuntimeDiagnostics.ts: typed residency import missing');
if (failures.length) {
  console.error(`R21 strict runtime check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok:true, suite:'strict-runtime-core-r21', owners:owners.length, escapeHatches:0, directTypedRuntimeImports:3 }));
