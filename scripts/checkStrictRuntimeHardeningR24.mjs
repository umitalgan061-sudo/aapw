import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const strictOwners = [
  'src/3d/audio/audioGraphSafetyMonitor.ts',
  'src/3d/audio/spatialAudioRegistry.ts',
  'src/3d/audio/audioCueRouter.ts',
  'src/3d/audio/audioManager.ts',
  'src/3d/rendering/renderHealthSupervisor.ts',
  'src/3d/rendering/gpuPressureModel.ts',
  'src/3d/rendering/dynamicResolutionGovernor.ts',
  'src/3d/rendering/renderPassBudgetPlanner.ts',
];

const failures = [];
for (const file of strictOwners) {
  const source = await readFile(file, 'utf8').catch(() => null);
  if (!source) {
    failures.push(`${file}: missing`);
    continue;
  }
  if (source.includes('@ts-nocheck')) failures.push(`${file}: @ts-nocheck escape hatch remains`);
}

const audioManager = await readFile('src/3d/audio/audioManager.ts', 'utf8');
if (audioManager.includes('as {triggerCue?:Function')) {
  failures.push('audioManager.ts: untyped Function director cast remains');
}
if (!audioManager.includes('getAudioGraphHealth')) failures.push('audioManager.ts: graph health API missing');

const orchestrator = await readFile('src/3d/rendering/nextGenRenderOrchestrator.ts', 'utf8');
if (!orchestrator.includes("from './renderHealthSupervisor.ts'")) {
  failures.push('nextGenRenderOrchestrator.ts: strict render health supervisor not wired');
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      result.push(...await walk(full));
    } else {
      result.push(full);
    }
  }
  return result;
}

for (const file of await walk('src')) {
  if (!file.endsWith('.js') || file.endsWith('.legacy.js') || file.includes('/vendor/')) continue;
  const tsPath = file.slice(0, -3) + '.ts';
  try {
    await readFile(tsPath, 'utf8');
  } catch {
    failures.push(`${file}: missing TypeScript production sibling ${tsPath}`);
  }
}

if (failures.length) {
  console.error(`R24 strict runtime gate failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'strict-runtime-hardening-r24',
  strictOwners: strictOwners.length,
  noProductionTsNoCheck: true,
  productionJsPaired: true,
  audioGraphTelemetry: true,
  renderHealthSupervisor: true,
}));
