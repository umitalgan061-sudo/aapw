import { readFile } from 'node:fs/promises';

const strictOwners = [
  'src/3d/gameplay/livingWorldStimulusWorkBudget.ts',
  'src/3d/gameplay/livingWorldFaunaActivityBudget.ts',
  'src/3d/gameplay/livingWorldRuntimeKernel.ts',
];

const failures = [];
for (const path of strictOwners) {
  const source = await readFile(path, 'utf8').catch(() => null);
  if (!source) {
    failures.push(`${path}: missing`);
    continue;
  }
  if (source.includes('@ts-nocheck')) failures.push(`${path}: @ts-nocheck is forbidden`);
  if (source.includes('.legacy.js')) failures.push(`${path}: legacy implementation import is forbidden`);
  if (source.includes('Math.random(')) failures.push(`${path}: ambient nondeterminism detected`);
  if (source.includes('Date.now(')) failures.push(`${path}: wall-clock dependency detected`);
}

const population = await readFile('src/3d/gameplay/livingWorldFaunaPopulationDirector.ts', 'utf8');
if (!population.includes("from './livingWorldRuntimeKernel.ts'")) {
  failures.push('livingWorldFaunaPopulationDirector.ts: runtime kernel is not connected');
}
if (!population.includes('workBudget')) {
  failures.push('livingWorldFaunaPopulationDirector.ts: work budget output is missing');
}

if (failures.length) {
  console.error(`R11 AI ownership gate failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('R11 AI ownership gate passed.');
