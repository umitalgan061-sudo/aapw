#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const appRoot = join(root, 'src', '3d', 'modern', 'app');
const failures = [];

const fail = (message) => failures.push(message);
const requiredFiles = [
  'appTypes.ts',
  'appConfig.ts',
  'inputCommandSystem.ts',
  'frameScheduler.ts',
  'performanceGovernor.ts',
  'assetCatalog.ts',
  'saveSlotManager.ts',
  'networkSession.ts',
  'worldQueryService.ts',
  'telemetryPipeline.ts',
  'accessibilityProfile.ts',
  'errorBoundary.ts',
  'applicationKernel.ts',
  'applicationHost.ts',
  'index.ts',
];

const checks = [
  { name: 'no-eval', pattern: /\beval\s*\(/g, message: 'runtime application code must not call eval' },
  { name: 'no-function-constructor', pattern: /\bnew\s+Function\s*\(/g, message: 'runtime application code must not construct dynamic functions' },
  { name: 'no-math-random', pattern: /\bMath\.random\s*\(/g, message: 'application simulation boundary must remain deterministic' },
  { name: 'no-direct-document-write', pattern: /document\.write\s*\(/g, message: 'application host must not use document.write' },
];

const main = async () => {
  const entries = await readdir(appRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts')).map((entry) => entry.name).sort();
  for (const required of requiredFiles) if (!files.includes(required)) fail('missing required application runtime file: ' + required);

  let lineCount = 0;
  let byteCount = 0;
  for (const file of files) {
    const path = join(appRoot, file);
    const source = await readFile(path, 'utf8');
    lineCount += source.split(/\r?\n/).length;
    byteCount += Buffer.byteLength(source);
    for (const check of checks) { if (check.pattern.test(source)) fail(file + ': ' + check.message); check.pattern.lastIndex = 0; }
  }

  const barrel = await readFile(join(appRoot, 'index.ts'), 'utf8');
  for (const required of requiredFiles.filter((file) => file !== 'index.ts')) {
    const exportName = './' + required.replace(/\.ts$/, '.ts');
    if (!barrel.includes(exportName)) fail('application barrel does not export ' + exportName);
  }

  if (lineCount < 900) fail('application runtime layer is unexpectedly small; expected a substantive typed platform surface');
  if (byteCount < 40_000) fail('application runtime layer is unexpectedly small in bytes');

  const packageFile = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageFile.scripts?.['verify:application'] !== 'node scripts/checkModernApplicationRuntime.mjs') fail('package.json is missing verify:application script');

  const workflow = await readFile(join(root, '.github', 'workflows', 'modern-typescript-platform.yml'), 'utf8');
  if (!workflow.includes('npm run verify:application')) fail('CI workflow must execute verify:application');

  if (failures.length) {
    console.error('Modern application runtime validation failed:');
    for (const message of failures) console.error(' - ' + message);
    process.exitCode = 1;
    return;
  }
  console.log('Modern application runtime validation passed.');
  console.log('Typed files:', files.length);
  console.log('Lines:', lineCount);
  console.log('Bytes:', byteCount);
  console.log('Required contracts:', requiredFiles.length);
};

await main();
