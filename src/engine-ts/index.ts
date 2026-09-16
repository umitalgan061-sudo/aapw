export * from './types.js';
export * from './deterministic.js';
export * from './collections.js';
export * from './eventBus.js';
export * from './ecs.js';
export * from './scheduler.js';
export * from './spatial.js';
export * from './runtime.js';
export * from './protocol.js';
export * from './stateMachine.js';
export * from './telemetry.js';
export * from './config.js';
export * from './capabilities.js';
export * from './commandBuffer.js';
export * from './memory.js';
export * from './graph.js';
export * from './validation.js';
export * from './snapshot.js';
export * from './migration.js';
export * from './clock.js';
export * from './workerBridge.js';
export * from './replay.js';
export * from './diagnostics.js';
export * from './resourceScheduler.js';
export * from './saveSystem.js';
export * from './streaming.js';
export * from './quality.js';
export * from './inputRouter.js';
export * from './assetRegistry.js';
export * from './renderPacket.js';
export * from './migrationManifest.js';
export * from './modernGameRuntime.js';

import { RuntimeKernel } from './runtime.js';
import { TelemetryRegistry } from './telemetry.js';
import { RuntimeConfig, booleanRule, numericRule, stringRule } from './config.js';
import { buildPlatformProfile, probeCapabilities, choosePreferredBackend } from './capabilities.js';
import { AdaptiveQualityController, deriveInitialQuality } from './quality.js';
import { AssetRegistry } from './assetRegistry.js';
import { InputRouter, createDefaultInputRouter } from './inputRouter.js';
import { MigrationManifest, defaultMigrationManifest } from './migrationManifest.js';
import { ResourceScheduler } from './resourceScheduler.js';
import { SaveSystem, MemorySaveBackend, LocalStorageBackend } from './saveSystem.js';
import { StreamingPlanner } from './streaming.js';

export interface ModernEngineFacade {
  readonly runtime: RuntimeKernel;
  readonly telemetry: TelemetryRegistry;
  readonly config: RuntimeConfig;
  readonly platform: ReturnType<typeof buildPlatformProfile>;
  readonly backend: ReturnType<typeof choosePreferredBackend>;
  readonly resources: ResourceScheduler;
  readonly assets: AssetRegistry;
  readonly input: InputRouter;
  readonly streaming: StreamingPlanner;
  readonly quality: AdaptiveQualityController;
  readonly saves: SaveSystem;
  readonly migration: MigrationManifest;
  dispose(): void;
}

export const createModernEngineFacade = (): ModernEngineFacade => {
  const capabilities = probeCapabilities();
  const platform = buildPlatformProfile(capabilities);
  const backend = choosePreferredBackend(platform);
  const initialQuality = deriveInitialQuality(capabilities);
  const config = new RuntimeConfig([
    numericRule('runtime.fixedStepHz', 60, 15, 120),
    numericRule('runtime.maxSubSteps', 5, 1, 12),
    numericRule('runtime.timeScale', 1, 0, 4),
    numericRule('render.pixelRatioCap', platform.pixelRatioCap, 0.5, 3),
    booleanRule('render.dynamicResolution', true),
    booleanRule('simulation.parallel', platform.supportsParallelSimulation),
    stringRule('runtime.backend', backend, false),
    stringRule('render.quality.initial', initialQuality, true),
  ]);
  const runtime = new RuntimeKernel({ telemetrySamples: 4096, eventQueue: 4096, commandHistory: 4096 });
  const telemetry = new TelemetryRegistry(8192);
  const resources = new ResourceScheduler();
  const assets = new AssetRegistry({ budget: { maxBytes: initialQuality === 'ultra' ? 1024 ** 3 : 768 * 1024 ** 2 } });
  const input = createDefaultInputRouter();
  const streaming = new StreamingPlanner({ scheduler: resources });
  const quality = new AdaptiveQualityController({ initialTier: initialQuality });
  const saves = new SaveSystem(createDurableSaveBackend());
  const migration = defaultMigrationManifest();
  runtime.initialize();
  return { runtime, telemetry, config, platform, backend, resources, assets, input, streaming, quality, saves, migration, dispose: () => { runtime.dispose(); telemetry.dispose(); assets.dispose(); input.dispose(); streaming.dispose(); resources.dispose(); } };
};

const createDurableSaveBackend = () => {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) { try { return new LocalStorageBackend(globalThis.localStorage); } catch { /* fallback */ } }
  return new MemorySaveBackend();
};
