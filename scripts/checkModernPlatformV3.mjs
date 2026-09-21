import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import process from 'node:process';

const requiredFiles = [
  'src/3d/modern/ecsRuntimeV3.ts',
  'src/3d/modern/engineKernelV3.ts',
  'src/3d/modern/assetPipelineV3.ts',
  'src/3d/modern/performanceRuntimeV3.ts',
  'src/3d/modern/worldQueryV3.ts',
  'src/3d/modern/saveRuntimeV3.ts',
  'src/3d/modern/workerRuntimeV3.ts',
  'src/3d/modern/securityRuntimeV3.ts',
  'src/3d/modern/networkStateV3.ts',
  'src/3d/modern/observabilityV3.ts',
  'src/3d/modern/runtimeFacadeV3.ts',
];

const bannedPatterns = [
  /Math\.random\(/,
  /new Function\(/,
  /eval\(/,
  /document\.cookie/,
  /localStorage\./,
];

const failures = [];
for (const path of requiredFiles) {
  if (!existsSync(path)) failures.push(`${path}: missing`);
  else {
    const source = await readFile(path, 'utf8');
    if (source.trim().length < 200) failures.push(`${path}: unexpectedly small`);
    for (const pattern of bannedPatterns) if (pattern.test(source)) failures.push(`${path}: banned primitive ${pattern}`);
  }
}

const packageSource = JSON.parse(await readFile('package.json', 'utf8'));
if (packageSource.scripts?.['verify:modern:v3'] !== 'node scripts/checkModernPlatformV3.mjs') failures.push('package.json: missing v3 verification script');

if (failures.length) {
  console.error('Modern platform v3 verification failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Modern platform v3 verification passed: ${requiredFiles.length} runtime surfaces checked.`);
}
