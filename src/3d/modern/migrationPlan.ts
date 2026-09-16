/**
 * TypeScript-first migration map. Legacy JavaScript stays authoritative for world content until its
 * corresponding typed replacement has parity tests and an explicit runtime cut-over.
 */
export interface MigrationTarget {
  readonly legacy: string;
  readonly modern: string;
  readonly status: 'foundation' | 'adapting' | 'cut-over';
  readonly risk: 'low' | 'medium' | 'high';
  readonly contract: string;
}

export const MIGRATION_PLAN: readonly MigrationTarget[] = [
  { legacy: 'src/3d/eventBus.js', modern: 'src/3d/modern/eventBus.ts', status: 'foundation', risk: 'low', contract: 'TypedEventBus' },
  { legacy: 'src/3d/state.js', modern: 'src/3d/modern/stateStore.ts', status: 'foundation', risk: 'low', contract: 'ModernStateStore' },
  { legacy: 'src/3d/input.js', modern: 'src/3d/modern/inputRouter.ts', status: 'foundation', risk: 'medium', contract: 'InputRouter' },
  { legacy: 'src/3d/gameplay/player.js', modern: 'src/3d/modern/motionState.ts', status: 'foundation', risk: 'medium', contract: 'MotionStateMachine' },
  { legacy: 'src/3d/world/chunkManager.js', modern: 'src/3d/modern/streamingPlanner.ts', status: 'foundation', risk: 'high', contract: 'StreamingPlanner' },
  { legacy: 'src/3d/rendering/nextGenRenderOrchestrator.js', modern: 'src/3d/modern/runtime.ts', status: 'adapting', risk: 'high', contract: 'RuntimeServices' },
  { legacy: 'src/3d/assetLoader.js', modern: 'src/3d/modern/resourceRegistry.ts', status: 'foundation', risk: 'high', contract: 'ResourceRegistry' },
  { legacy: 'src/3d/game3d.js', modern: 'src/3d/modern/legacyBridge.ts', status: 'adapting', risk: 'high', contract: 'LegacyRuntimeBridge' },
];

export function migrationProgress(): { completed: number; total: number; ratio: number } {
  const completed = MIGRATION_PLAN.filter((item) => item.status === 'cut-over').length;
  return { completed, total: MIGRATION_PLAN.length, ratio: completed / MIGRATION_PLAN.length };
}
