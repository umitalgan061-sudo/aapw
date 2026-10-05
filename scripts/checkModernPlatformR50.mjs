import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'src/3d/modern/r50/contracts.ts',
  'src/3d/modern/r50/commandBus.ts',
  'src/3d/modern/r50/stateStore.ts',
  'src/3d/modern/r50/scheduler.ts',
  'src/3d/modern/r50/validation.ts',
  'src/3d/modern/r50/assetRuntime.ts',
  'src/3d/modern/r50/networkRuntime.ts',
  'src/3d/modern/r50/observability.ts',
  'src/3d/modern/r50/browserBridge.ts',
  'src/3d/modern/r50/migrationBoundary.ts',
  'src/3d/modern/r50/persistenceCoordinator.ts',
  'src/3d/modern/r50/securityBoundary.ts',
  'src/3d/modern/r50/inputPipeline.ts',
  'src/3d/modern/r50/recoveryController.ts',
  'src/3d/modern/r50/renderPipeline.ts',
  'src/3d/modern/r50/performanceGovernor.ts',
  'src/3d/modern/r50/entrypoint.ts',
  'src/3d/modern/r50/worldRuntime.ts',
  'src/3d/modern/r50/entityRegistry.ts',
  'src/3d/modern/r50/snapshotCodec.ts',
  'src/3d/modern/r50/platform.ts',
  'src/3d/modern/r50/index.ts',
  'tsconfig.modern-r50.json',
];

const sourceFiles = requiredFiles.filter(
  (file) => file.endsWith('.ts'),
);

const forbiddenPatterns = [
  {
    pattern: /\bMath\.random\s*\(/,
    reason: 'ambient random source',
  },
  {
    pattern: /\bDate\.now\s*\(/,
    reason: 'wall clock source',
  },
  {
    pattern: /\beval\s*\(/,
    reason: 'dynamic code evaluation',
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    reason: 'dynamic code generation',
  },
];

const sourceRoot = new URL('../', import.meta.url);

for (const file of requiredFiles) {
  try {
    await access(new URL(file, sourceRoot));
  } catch (error) {
    throw new Error(
      '[R50] missing required file: ' +
      file +
      '; ' +
      String(error),
    );
  }
}

const contents = new Map();

for (const file of sourceFiles) {
  const source = await readFile(
    new URL(file, sourceRoot),
    'utf8',
  );

  contents.set(file, source);

  for (const entry of forbiddenPatterns) {
    if (entry.pattern.test(source)) {
      throw new Error(
        '[R50] forbidden primitive in ' +
        file +
        ': ' +
        entry.reason,
      );
    }
  }

  for (const line of source.split('\n')) {
    const match = line.match(/(?:from|import)\s*['"](\.\/[^'"]+)['"]/);

    if (
      match
      && !match[1].endsWith('.ts')
    ) {
      throw new Error(
        '[R50] relative TypeScript imports must use explicit .ts extensions: ' +
        file,
      );
    }
  }
}

const barrel = contents.get(
  'src/3d/modern/r50/index.ts',
) ?? '';

const requiredExports = [
  './contracts.ts',
  './commandBus.ts',
  './stateStore.ts',
  './scheduler.ts',
  './validation.ts',
  './assetRuntime.ts',
  './networkRuntime.ts',
  './persistenceCoordinator.ts',
  './securityBoundary.ts',
  './inputPipeline.ts',
  './recoveryController.ts',
  './renderPipeline.ts',
  './performanceGovernor.ts',
  './worldRuntime.ts',
  './entityRegistry.ts',
  './snapshotCodec.ts',
  './platform.ts',
];

for (const requiredExport of requiredExports) {
  if (!barrel.includes(requiredExport)) {
    throw new Error(
      '[R50] missing barrel export: ' +
      requiredExport,
    );
  }
}

const rootBarrel = await readFile(
  new URL(
    'src/3d/modern/index.ts',
    sourceRoot,
  ),
  'utf8',
);

if (!rootBarrel.includes("./r50/index.ts")) {
  throw new Error(
    '[R50] root modern barrel does not expose the R50 platform.',
  );
}

const configSource = contents.get(
  'tsconfig.modern-r50.json',
) ?? '';

for (const requiredToken of [
  '"strict": true',
  '"allowJs": false',
  '"allowImportingTsExtensions": true',
  '"noEmit": true',
]) {
  if (!configSource.includes(requiredToken)) {
    throw new Error(
      '[R50] strict compiler contract missing: ' +
      requiredToken,
    );
  }
}

const packageSource = await readFile(
  new URL('package.json', sourceRoot),
  'utf8',
);

const packageJson = JSON.parse(
  packageSource,
);

for (const scriptName of [
  'verify:r50',
  'typecheck:r50',
  'test:r50',
  'check:r50',
]) {
  if (
    typeof packageJson.scripts?.[scriptName]
    !== 'string'
  ) {
    throw new Error(
      '[R50] package script missing: ' +
      scriptName,
    );
  }
}


const toolchainRequirements = [
  ['engines.node', String(packageJson.engines?.node ?? ''), '>=24.21.0'],
  ['devDependencies.typescript', String(packageJson.devDependencies?.typescript ?? ''), '^7.'],
  ['devDependencies.vite', String(packageJson.devDependencies?.vite ?? ''), '^8.'],
];

for (const [label, actual, expected] of toolchainRequirements) {
  if (!actual.includes(expected)) {
    throw new Error(
      '[R50] toolchain requirement missing: ' +
      label + ' must include ' + expected + '; found ' + actual,
    );
  }
}

for (const [file, source] of contents) {
  if (/[@]ts-nocheck|[@]ts-ignore/.test(source)) {
    throw new Error(
      '[R50] TypeScript escape hatch forbidden in production surface: ' +
      file,
    );
  }
}

console.log(
  '[R50] production boundary verified: '
  requiredFiles.length +
  ' required files; ' +
  sourceFiles.length +
  ' TypeScript surfaces checked.',
);
