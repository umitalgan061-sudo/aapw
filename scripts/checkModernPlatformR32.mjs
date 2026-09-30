import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'src/3d/modern/r32/contracts.ts',
  'src/3d/modern/r32/commandBus.ts',
  'src/3d/modern/r32/stateStore.ts',
  'src/3d/modern/r32/scheduler.ts',
  'src/3d/modern/r32/validation.ts',
  'src/3d/modern/r32/assetRuntime.ts',
  'src/3d/modern/r32/networkRuntime.ts',
  'src/3d/modern/r32/observability.ts',
  'src/3d/modern/r32/browserBridge.ts',
  'src/3d/modern/r32/migrationBoundary.ts',
  'src/3d/modern/r32/persistenceCoordinator.ts',
  'src/3d/modern/r32/securityBoundary.ts',
  'src/3d/modern/r32/inputPipeline.ts',
  'src/3d/modern/r32/recoveryController.ts',
  'src/3d/modern/r32/renderPipeline.ts',
  'src/3d/modern/r32/performanceGovernor.ts',
  'src/3d/modern/r32/entrypoint.ts',
  'src/3d/modern/r32/worldRuntime.ts',
  'src/3d/modern/r32/entityRegistry.ts',
  'src/3d/modern/r32/snapshotCodec.ts',
  'src/3d/modern/r32/platform.ts',
  'src/3d/modern/r32/index.ts',
  'tsconfig.modern-r32.json',
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
      '[R32] missing required file: ' +
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
        '[R32] forbidden primitive in ' +
        file +
        ': ' +
        entry.reason,
      );
    }
  }

  for (const line of source.split('\n')) {
    const match = line.match(
      /(?:from|import)\s*['"](
        \.\/
        [^'"]+
      )['"]/x,
    );

    if (
      match
      && !match[1].endsWith('.ts')
    ) {
      throw new Error(
        '[R32] relative TypeScript imports must use explicit .ts extensions: ' +
        file,
      );
    }
  }
}

const barrel = contents.get(
  'src/3d/modern/r32/index.ts',
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
      '[R32] missing barrel export: ' +
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

if (!rootBarrel.includes("./r32/index.ts")) {
  throw new Error(
    '[R32] root modern barrel does not expose the R32 platform.',
  );
}

const configSource = contents.get(
  'tsconfig.modern-r32.json',
) ?? '';

for (const requiredToken of [
  '"strict": true',
  '"allowJs": false',
  '"allowImportingTsExtensions": true',
  '"noEmit": true',
]) {
  if (!configSource.includes(requiredToken)) {
    throw new Error(
      '[R32] strict compiler contract missing: ' +
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
  'verify:r32',
  'typecheck:r32',
  'test:r32',
  'check:r32',
]) {
  if (
    typeof packageJson.scripts?.[scriptName]
    !== 'string'
  ) {
    throw new Error(
      '[R32] package script missing: ' +
      scriptName,
    );
  }
}

console.log(
  '[R32] production boundary verified: ' +
  requiredFiles.length +
  ' required files; ' +
  sourceFiles.length +
  ' TypeScript surfaces checked.',
);
