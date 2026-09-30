import { readFile } from 'node:fs/promises';

const facade = await readFile('src/3d/modern/modernRuntimeFacade.ts', 'utf8');
const supervisor = await readFile('src/3d/strict/runtimeHardeningV25.ts', 'utf8');
const workflow = await readFile('.github/workflows/runtime-hardening-r25.yml', 'utf8');
const tsconfig = await readFile('tsconfig.runtime-hardening-r25.json', 'utf8');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const failures = [];

for (const token of [
  "RuntimeHardeningSupervisorV25",
  "hardening.observeFrame",
  "hardening: this.hardening.snapshot()",
]) {
  if (!facade.includes(token)) failures.push(`modernRuntimeFacade.ts: missing ${token}`);
}
for (const token of [
  'class RuntimeHardeningSupervisorV25',
  'guardAsync',
  'recordFailure',
  'observeFrame',
  'failureWindowMs',
]) {
  if (!supervisor.includes(token)) failures.push(`runtimeHardeningV25.ts: missing ${token}`);
}
if (facade.includes('this.kernel.profile.maxEntities')) failures.push('modernRuntimeFacade.ts: stale maxEntities access remains');
if (facade.includes('.stats().pending') || facade.includes('.stats().loading')) failures.push('modernRuntimeFacade.ts: invalid AssetRuntimeStats field remains');
if (!workflow.includes('npm run typecheck:runtime-hardening-r25')) failures.push('workflow: strict TypeScript check missing');
if (!workflow.includes('npm run test:runtime-hardening-r25')) failures.push('workflow: regression test missing');
if (!tsconfig.includes('runtimeHardeningV25.ts')) failures.push('tsconfig: hardening source is not included');
if (!packageJson.scripts?.['check:runtime-hardening-r25']) failures.push('package.json: V25 aggregate check is missing');

if (failures.length) {
  console.error('V25 runtime hardening gate failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('V25 runtime hardening gate passed.');
