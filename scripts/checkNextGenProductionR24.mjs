import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';

const required = [
  'src/3d/nextgen/kernelTypes.ts',
  'src/3d/nextgen/deterministicClock.ts',
  'src/3d/nextgen/inputHub.ts',
  'src/3d/nextgen/characterController.ts',
  'src/3d/nextgen/cameraRig.ts',
  'src/3d/nextgen/assetScheduler.ts',
  'src/3d/nextgen/worldStreamDirector.ts',
  'src/3d/nextgen/entityRegistry.ts',
  'src/3d/nextgen/combatDirector.ts',
  'src/3d/nextgen/npcBrain.ts',
  'src/3d/nextgen/questDirector.ts',
  'src/3d/nextgen/persistence.ts',
  'src/3d/nextgen/renderDirector.ts',
  'src/3d/nextgen/telemetry.ts',
  'src/3d/nextgen/recoverySupervisor.ts',
  'src/3d/nextgen/productionRuntime.ts',
  'src/3d/nextgen/productionBridge.ts',
  'src/3d/nextgen/index.ts',
];

for (const file of required) {
  await access(new URL('../' + file, import.meta.url));
}

const forbiddenPattern = /\b(Math\.random|Date\.now|@ts-nocheck|@ts-ignore|eval|new Function)\b/;
const sources = await Promise.all(
  required.filter((file) => file.endsWith('.ts')).map(async (file) => [
    file,
    await readFile(new URL('../' + file, import.meta.url), 'utf8'),
  ]),
);

for (const [file, source] of sources) {
  if (forbiddenPattern.test(source)) {
    throw new Error('R24 nextgen source contains forbidden primitive/escape hatch: ' + file);
  }
}

const totalLines = sources.reduce((sum, [, source]) => sum + source.split(/\r?\n/).length, 0);
if (totalLines < 3500) throw new Error('R24 source floor not reached: ' + totalLines);
console.log('NEXTGEN_PRODUCTION_R24_OK lines=' + totalLines + ' modules=' + required.length);
