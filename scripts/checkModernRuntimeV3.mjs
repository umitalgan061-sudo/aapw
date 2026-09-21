#!/usr/bin/env node

/**
 * Modern Runtime V3 repository guard.
 *
 * This is a release-facing structural check, not a replacement for the full
 * type checker. It verifies that all V3 surfaces exist, that the barrel and
 * package scripts expose them, and that the simulation-oriented files do not
 * introduce ambient randomness or dynamic code execution.
 */

import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const requiredFiles = [
  'src/3d/modern/applicationKernelV3.ts',
  'src/3d/modern/assetOrchestratorV3.ts',
  'src/3d/modern/inputPipelineV3.ts',
  'src/3d/modern/migrationManagerV3.ts',
  'src/3d/modern/renderBudgetV3.ts',
  'src/3d/modern/sessionStateV3.ts',
  'src/3d/modern/telemetryV3.ts',
  'src/3d/modern/worldStreamingV3.ts',
  'tests/modern/runtimeV3.integration.test.ts',
];

const requiredExports = [
  'applicationKernelV3',
  'assetOrchestratorV3',
  'inputPipelineV3',
  'migrationManagerV3',
  'renderBudgetV3',
  'sessionStateV3',
  'telemetryV3',
  'worldStreamingV3',
];

const deterministicSurfaces = [
  'src/3d/modern/applicationKernelV3.ts',
  'src/3d/modern/inputPipelineV3.ts',
  'src/3d/modern/worldStreamingV3.ts',
  'src/3d/modern/sessionStateV3.ts',
  'src/3d/modern/migrationManagerV3.ts',
];

const limits = {
  maxSourceLines: 900,
  maxTestLines: 1200,
};

function fail(message) {
  console.error('[runtime-v3] FAIL:', message);
  process.exitCode = 1;
}

async function read(relative) {
  return readFile(path.join(ROOT, relative), 'utf8');
}

async function exists(relative) {
  try {
    await access(path.join(ROOT, relative));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let failures = 0;

  for (const file of requiredFiles) {
    if (!(await exists(file))) {
      fail(\`missing required file: \${file}\`);
      failures += 1;
    }
  }

  const index = await read('src/3d/modern/index.ts');
  for (const name of requiredExports) {
    const token = \`./\${name}\`;
    if (!index.includes(token)) {
      fail(\`modern barrel does not export \${token}\`);
      failures += 1;
    }
  }

  const packageText = await read('package.json');
  const packageJson = JSON.parse(packageText);
  for (const script of ['verify:runtime:v3', 'check:modern']) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      fail(\`package.json is missing script \${script}\`);
      failures += 1;
    }
  }

  for (const file of deterministicSurfaces) {
    const source = await read(file);
    const lines = source.split('\\n').length;
    if (lines > limits.maxSourceLines) {
      fail(\`\${file} exceeds \${limits.maxSourceLines} lines (\${lines})\`);
      failures += 1;
    }

    const banned = [
      /Math\\.random\\s*\\(/,
      /eval\\s*\\(/,
      /new\\s+Function\\s*\\(/,
      /globalThis\\.crypto\\.getRandomValues\\s*\\(/,
    ];
    for (const expression of banned) {
      if (expression.test(source)) {
        fail(\`unsafe or nondeterministic primitive \${expression} in \${file}\`);
        failures += 1;
      }
    }
  }

  const testSource = await read('tests/modern/runtimeV3.integration.test.ts');
  const testLines = testSource.split('\\n').length;
  if (testLines > limits.maxTestLines) {
    fail(\`V3 integration tests exceed \${limits.maxTestLines} lines (\${testLines})\`);
    failures += 1;
  }

  const requiredTestMarkers = [
    'ApplicationKernelV3',
    'InputPipelineV3',
    'AssetOrchestratorV3',
    'WorldStreamingV3',
    'RenderBudgetControllerV3',
    'SessionStateV3',
    'TelemetryV3',
    'MigrationManagerV3',
  ];

  for (const marker of requiredTestMarkers) {
    if (!testSource.includes(marker)) {
      fail(\`integration suite does not exercise \${marker}\`);
      failures += 1;
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        requiredFiles: requiredFiles.length,
        exportedV3Surfaces: requiredExports.length,
        deterministicSurfaces: deterministicSurfaces.length,
        testLines,
      },
      null,
      2,
    ),
  );
}

await main();
