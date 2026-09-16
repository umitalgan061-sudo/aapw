import { readFile } from 'node:fs/promises';

const files = [
  'src/3d/modern/runtimeContractsV4.ts',
  'src/3d/modern/commandBusV4.ts',
  'src/3d/modern/schedulerV4.ts',
  'src/3d/modern/spatialIndexV4.ts',
  'src/3d/modern/assetStreamingV4.ts',
  'src/3d/modern/networkReplicationV4.ts',
  'src/3d/modern/renderPipelineV4.ts',
  'src/3d/modern/inputCommandV4.ts',
  'src/3d/modern/ecsSystemsV4.ts',
  'src/3d/modern/observabilityV4.ts',
  'src/3d/modern/performanceBudgetV4.ts',
  'src/3d/modern/runtimeOrchestratorV4.ts',
  'src/3d/modern/runtimeV4Facade.ts',
  'src/3d/modern/migrationV4.ts',
  'src/3d/modern/releaseGateV4.ts',
];

const forbidden = [/Math\\.random\\s*\\(/, /\\beval\\s*\\(/, /new\\s+Function\\s*\\(/];
const requiredExports = ['RuntimeOrchestratorV4', 'RuntimeV4Facade', 'CommandBusV4', 'SchedulerV4', 'SpatialIndexV4', 'AssetStreamingV4', 'NetworkReplicationV4', 'RenderPipelineV4', 'InputCommandRouterV4'];

let totalLines = 0;
let failures = 0;
for (const file of files) {
  let content;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    console.error(`missing: ${file}`);
    failures += 1;
    continue;
  }
  const lines = content.split(/\\r?\\n/).length;
  totalLines += lines;
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      console.error(`forbidden primitive in ${file}: ${pattern}`);
      failures += 1;
    }
  }
  if (!file.includes('runtimeContractsV4') && file.endsWith('V4.ts')) {
    const exportsSomething = /export\\s+(?:class|function|interface|type|const)\\s+/.test(content);
    if (!exportsSomething) {
      console.error(`no public export found in ${file}`);
      failures += 1;
    }
  }
}

const index = await readFile('src/3d/modern/index.ts', 'utf8');
for (const name of requiredExports) {
  if (!index.includes(name)) {
    console.error(`index does not expose ${name}`);
    failures += 1;
  }
}

const result = {
  version: 4,
  checkedFiles: files.length,
  totalLines,
  requiredExports,
  forbiddenPrimitiveHits: failures,
  deterministic: failures === 0,
};
console.log(JSON.stringify(result, null, 2));
if (failures > 0) process.exit(1);
