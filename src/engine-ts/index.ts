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

import { RuntimeKernel } from './runtime.js';
import { TelemetryRegistry } from './telemetry.js';
import { RuntimeConfig, booleanRule, numericRule, stringRule } from './config.js';
import { buildPlatformProfile, probeCapabilities, choosePreferredBackend } from './capabilities.js';

export interface ModernEngineFacade {
  readonly runtime: RuntimeKernel;
  readonly telemetry: TelemetryRegistry;
  readonly config: RuntimeConfig;
  readonly platform: ReturnType<typeof buildPlatformProfile>;
  readonly backend: ReturnType<typeof choosePreferredBackend>;
  dispose(): void;
}

export const createModernEngineFacade = (): ModernEngineFacade => {
  const capabilities = probeCapabilities();
  const platform = buildPlatformProfile(capabilities);
  const config = new RuntimeConfig([
    numericRule('runtime.fixedStepHz', 60, 15, 120),
    numericRule('runtime.maxSubSteps', 5, 1, 12),
    numericRule('runtime.timeScale', 1, 0, 4),
    numericRule('render.pixelRatioCap', platform.pixelRatioCap, 0.5, 3),
    booleanRule('render.dynamicResolution', true),
    booleanRule('simulation.parallel', platform.supportsParallelSimulation),
    stringRule('runtime.backend', choosePreferredBackend(platform), false),
  ]);
  const runtime = new RuntimeKernel({ telemetrySamples: 4096, eventQueue: 4096, commandHistory: 4096 });
  const telemetry = new TelemetryRegistry(8192);
  runtime.initialize();
  return {
    runtime,
    telemetry,
    config,
    platform,
    backend: choosePreferredBackend(platform),
    dispose: () => { runtime.dispose(); telemetry.dispose(); },
  };
};
