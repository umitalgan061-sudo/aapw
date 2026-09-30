import { readFile } from 'node:fs/promises';

const strictCore = [
  'src/3d/config.ts',
  'src/3d/eventBus.ts',
  'src/3d/state.ts',
  'src/3d/gameplay/gameplayConfig.ts',
];

const failures = [];
for (const path of strictCore) {
  const content = await readFile(path, 'utf8').catch(() => null);
  if (!content) failures.push(`${path}: missing`);
  else {
    if (content.includes('@ts-nocheck')) failures.push(`${path}: @ts-nocheck is forbidden`);
    if (content.includes('@ts-ignore')) failures.push(`${path}: @ts-ignore is forbidden`);
  }
}

const tsconfig = JSON.parse(await readFile('tsconfig.strict-core.json', 'utf8'));
if (tsconfig.compilerOptions.allowJs !== false) failures.push('tsconfig.strict-core.json: allowJs must be false');

if (failures.length) {
  console.error(`Strict core gate failed with ${failures.length} issue(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Strict core gate passed: zero nocheck/ignore escape hatches in the critical TypeScript core.');
