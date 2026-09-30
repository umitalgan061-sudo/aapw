export interface R15QualityGateSnapshot {
  readonly version: 15;
  readonly strictCoreFiles: readonly string[];
  readonly renderPacketStrict: boolean;
  readonly orchestratorBoundaryValidation: boolean;
  readonly immutablePacket: boolean;
  readonly boundedPacket: boolean;
}

export const R15_STRICT_CORE_FILES = Object.freeze([
  'src/app/rootApplicationRuntime.ts',
  'src/3d/modern/deterministic.ts',
  'src/3d/modern/runtimeKernel.ts',
  'src/3d/modern/runtimeLifecycle.ts',
  'src/3d/modern/modernRuntimeFacade.ts',
  'src/3d/strict/runtimeHardeningV25.ts',
  'src/3d/rendering/renderFramePacket.ts',
]);

export function createR15QualityGateSnapshot(): R15QualityGateSnapshot {
  return Object.freeze({
    version: 15,
    strictCoreFiles: R15_STRICT_CORE_FILES,
    renderPacketStrict: true,
    orchestratorBoundaryValidation: true,
    immutablePacket: true,
    boundedPacket: true,
  });
}
