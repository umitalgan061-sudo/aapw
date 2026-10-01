
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(
  new URL('..', import.meta.url).pathname,
);

const sources = [
  'src/3d/modern/r35/contracts.ts',
  'src/3d/modern/r35/worldSimulationR35.ts',
  'src/3d/modern/r35/questRuntimeR35.ts',
  'src/3d/modern/r35/inventoryRuntimeR35.ts',
  'src/3d/modern/r35/dialogueRuntimeR35.ts',
  'src/3d/modern/r35/saveRuntimeR35.ts',
  'src/3d/modern/r35/replayRuntimeR35.ts',
  'src/3d/modern/r35/accessibilityRuntimeR35.ts',
  'src/3d/modern/r35/contentRegistryR35.ts',
  'src/3d/modern/r35/telemetryRuntimeR35.ts',
  'src/3d/modern/r35/runtimeOrchestratorR35.ts',
  'src/3d/modern/r35/weatherRuntimeR35.ts',
  'src/3d/modern/r35/economyRuntimeR35.ts',
  'src/3d/modern/r35/craftingRuntimeR35.ts',
  'src/3d/modern/r35/combatRuntimeR35.ts',
  'src/3d/modern/r35/navigationRuntimeR35.ts',
  'src/3d/modern/r35/interactionRuntimeR35.ts',
  'src/3d/modern/r35/animationRuntimeR35.ts',
  'src/3d/modern/r35/localizationRuntimeR35.ts',
  'src/3d/modern/r35/photoModeRuntimeR35.ts',
  'src/3d/modern/r35/streamingRuntimeR35.ts',
  'src/3d/modern/r35/featureHubRuntimeR35.ts',
];

const tests = [
  'tests/modern/r35/worldQuestInventory.test.ts',
  'tests/modern/r35/orchestratorTelemetry.test.ts',
  'tests/modern/r35/featureSystemsR35.test.ts',
];

let totalLines = 0;

for (const file of [...sources, ...tests]) {
  const text = await readFile(
    resolve(root, file),
    'utf8',
  );
  totalLines += text.split('\n').length;
}

const forbidden = [
  'Math.random(',
  'Date.now(',
  'eval(',
  'new Function(',
];

for (const file of sources) {
  const text = await readFile(
    resolve(root, file),
    'utf8',
  );
  for (const token of forbidden) {
    if (text.includes(token)) {
      throw new Error(
        file + ': forbidden token ' + token,
      );
    }
  }
}

if (totalLines < 3000) {
  throw new Error(
    'R35 meaningful source/test line floor not met: '
    + totalLines,
  );
}

const indexText = await readFile(
  resolve(root, 'src/3d/modern/r35/index.ts'),
  'utf8',
);

for (const moduleName of [
  'weatherRuntimeR35',
  'economyRuntimeR35',
  'craftingRuntimeR35',
  'combatRuntimeR35',
  'navigationRuntimeR35',
  'interactionRuntimeR35',
  'animationRuntimeR35',
  'localizationRuntimeR35',
  'photoModeRuntimeR35',
  'streamingRuntimeR35',
  'featureHubRuntimeR35',
]) {
  if (!indexText.includes(moduleName)) {
    throw new Error(
      'R35 barrel export missing: ' + moduleName,
    );
  }
}

console.log(
  'R35 source-of-truth guard: PASS lines='
  + totalLines,
);
