import { readFile } from 'node:fs/promises';

const strictFiles = [
  'src/app/rootApplicationRuntime.ts',
  'src/3d/modern/deterministic.ts',
  'src/3d/modern/runtimeKernel.ts',
  'src/3d/modern/runtimeLifecycle.ts',
  'src/3d/modern/modernRuntimeFacade.ts',
  'src/3d/strict/runtimeHardeningV25.ts',
  'src/3d/rendering/renderFramePacket.ts',
];

const failures = [];
for (const file of strictFiles) {
  const source = await readFile(file, 'utf8').catch(() => null);
  if (!source) {
    failures.push(`${file}: missing`);
    continue;
  }
  if (/^\s*\/\/\s*@ts-nocheck/m.test(source) || /^\s*\/\*\s*@ts-nocheck/m.test(source)) {
    failures.push(`${file}: @ts-nocheck is forbidden in strict-core scope`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('R14 strict-core ownership gate passed.');
