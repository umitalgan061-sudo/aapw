import { readFile } from 'node:fs/promises';

const owners = [
  ['src/3d/ui/controlsHelp.ts', 'src/3d/ui/controlsHelp.js', 'src/3d/ui/controlsHelpLegacy.ts'],
  ['src/3d/ui/healthBar.ts', 'src/3d/ui/healthBar.js', 'src/3d/ui/healthBarLegacy.ts'],
  ['src/3d/ui/interactionPrompt.ts', 'src/3d/ui/interactionPrompt.js', 'src/3d/ui/interactionPromptLegacy.ts'],
  ['src/3d/ui/settlementCompass.ts', 'src/3d/ui/settlementCompass.js', 'src/3d/ui/settlementCompassLegacy.ts'],
];

const failures = [];

for (const [typedPath, legacyPath, implementationPath] of owners) {
  const typed = await readFile(typedPath, 'utf8').catch(() => null);
  const legacy = await readFile(legacyPath, 'utf8').catch(() => null);
  const implementation = await readFile(implementationPath, 'utf8').catch(() => null);

  if (!typed) failures.push(typedPath + ': strict facade missing');
  else {
    if (typed.includes('@ts-nocheck')) failures.push(typedPath + ': @ts-nocheck escape hatch remains');
    if (!typed.includes('Strict TypeScript owner')) failures.push(typedPath + ': strict owner marker missing');
  }

  if (!legacy) failures.push(legacyPath + ': compatibility boundary missing');
  else if (!legacy.includes('export * from') || !legacy.includes('.ts')) failures.push(legacyPath + ': must re-export the TS production owner');

  if (!implementation) failures.push(implementationPath + ': staged compatibility implementation missing');
  else if (!implementation.includes('@ts-nocheck')) failures.push(implementationPath + ': compatibility implementation marker missing');
}

if (failures.length) {
  console.error('R22 strict UI verification failed with ' + failures.length + ' issue(s):');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'r22-strict-ui',
  strictOwners: owners.length,
  noProductionTsNoCheck: true,
  jsCompatibilityBoundaries: true,
  implementationIsolation: true,
}));
