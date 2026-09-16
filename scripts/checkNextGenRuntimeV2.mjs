import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const required = [
  'src/3d/modern/nextgen/types.ts',
  'src/3d/modern/nextgen/deterministicRngV2.ts',
  'src/3d/modern/nextgen/actorSimulationV2.ts',
  'src/3d/modern/nextgen/interactionRuntimeV2.ts',
  'src/3d/modern/nextgen/inventoryRuntimeV2.ts',
  'src/3d/modern/nextgen/dialogueRuntimeV2.ts',
  'src/3d/modern/nextgen/networkTransportV2.ts',
  'src/3d/modern/nextgen/streamingOrchestratorV2.ts',
  'src/3d/modern/nextgen/renderFramePipelineV2.ts',
  'src/3d/modern/nextgen/runtimePolicyV2.ts',
  'src/3d/modern/nextgen/worldEventJournalV2.ts',
  'src/3d/modern/nextgen/saveSlotManagerV2.ts',
  'src/3d/modern/nextgen/workerSchedulerV2.ts',
  'src/3d/modern/nextgen/simulationCoordinatorV2.ts',
  'src/3d/modern/nextgen/assetLifecycleV2.ts',
  'src/3d/modern/nextgen/worldStateCodecV2.ts',
  'src/3d/modern/nextgen/nextgenRuntimeFacadeV2.ts',
  'src/3d/modern/nextgen/index.ts',
];

const errors = [];
for (const relative of required) {
  try {
    const source = await readFile(resolve(ROOT, relative), 'utf8');
    if (source.trim().length < 80) errors.push(`${relative}:too_small`);
    if (/\b(eval|Function)\s*\(/.test(source)) errors.push(`${relative}:dynamic_code`);
  } catch {
    errors.push(`${relative}:missing`);
  }
}

const facade = await readFile(resolve(ROOT, 'src/3d/modern/nextgen/nextgenRuntimeFacadeV2.ts'), 'utf8').catch(() => '');
for (const symbol of ['ActorSimulationV2', 'NetworkTransportV2', 'WorldStreamingOrchestratorV2', 'AdaptiveRenderPipelineV2', 'RuntimePolicyV2', 'WorldEventJournalV2']) {
  if (!facade.includes(symbol)) errors.push(`facade:missing_${symbol}`);
}

const index = await readFile(resolve(ROOT, 'src/3d/modern/nextgen/index.ts'), 'utf8').catch(() => '');
if (!index.includes("export * from './nextgenRuntimeFacadeV2.ts';")) errors.push('index:facade_export_missing');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`NextGen runtime structural guard passed (${required.length} required modules).`);
