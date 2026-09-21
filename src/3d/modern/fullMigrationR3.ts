import type { RuntimeEnvelope, RuntimeEvent, RuntimeTick } from './types.ts';

export interface MigrationModuleRecord {
  readonly id: string;
  readonly legacyPath: string;
  readonly modernPath: string;
  readonly owner: 'runtime' | 'world' | 'rendering' | 'network' | 'persistence' | 'tooling' | 'ui';
  readonly status: 'planned' | 'facaded' | 'migrated' | 'retired';
  readonly risk: 'low' | 'medium' | 'high';
}

export interface MigrationLedgerSnapshot {
  readonly version: 6;
  readonly generatedAtTick: number;
  readonly modules: readonly MigrationModuleRecord[];
  readonly legacyCount: number;
  readonly migratedCount: number;
  readonly coveragePercent: number;
}

export const R3_MIGRATION_MODULES = [
  { id: 'npc-runtime', legacyPath: 'src/3d/gameplay/npc.js', modernPath: 'src/3d/gameplay/npc.ts', owner: 'runtime', status: 'migrated', risk: 'high' },
  { id: 'wildlife-runtime', legacyPath: 'src/3d/gameplay/animals.js', modernPath: 'src/3d/gameplay/animals.ts', owner: 'runtime', status: 'migrated', risk: 'high' },
  { id: 'living-world-spawner', legacyPath: 'src/3d/gameplay/livingWorldSpawner.js', modernPath: 'src/3d/gameplay/livingWorldSpawner.ts', owner: 'runtime', status: 'migrated', risk: 'high' },
  { id: 'interaction-runtime', legacyPath: 'src/3d/gameplay/interaction.js', modernPath: 'src/3d/gameplay/interaction.ts', owner: 'runtime', status: 'migrated', risk: 'high' },
  { id: 'gameplay-config-animal', legacyPath: 'src/3d/gameplay/animalConfig.js', modernPath: 'src/3d/gameplay/animalConfig.ts', owner: 'runtime', status: 'migrated', risk: 'low' },
  { id: 'gameplay-config-interaction', legacyPath: 'src/3d/gameplay/interactionConfig.js', modernPath: 'src/3d/gameplay/interactionConfig.ts', owner: 'runtime', status: 'migrated', risk: 'medium' },
  { id: 'gameplay-config-npc', legacyPath: 'src/3d/gameplay/npcConfig.js', modernPath: 'src/3d/gameplay/npcConfig.ts', owner: 'runtime', status: 'migrated', risk: 'medium' },
  { id: 'gameplay-config-species', legacyPath: 'src/3d/gameplay/creatureSpeciesConfig.js', modernPath: 'src/3d/gameplay/creatureSpeciesConfig.ts', owner: 'runtime', status: 'migrated', risk: 'low' },
  { id: 'scene', legacyPath: 'src/3d/sceneManager.js', modernPath: 'src/3d/sceneManager.ts', owner: 'rendering', status: 'migrated', risk: 'high' },
  { id: 'game-loop', legacyPath: 'src/3d/game3d.js', modernPath: 'src/3d/game3d.ts', owner: 'runtime', status: 'migrated', risk: 'high' },
  { id: 'player', legacyPath: 'src/3d/gameplay/player.js', modernPath: 'src/3d/gameplay/player.ts', owner: 'runtime', status: 'migrated', risk: 'high' },
  { id: 'physics', legacyPath: 'src/3d/physics.js', modernPath: 'src/3d/physics.ts', owner: 'world', status: 'migrated', risk: 'high' },
  { id: 'input', legacyPath: 'src/3d/input.js', modernPath: 'src/3d/input.ts', owner: 'runtime', status: 'migrated', risk: 'medium' },
  { id: 'loop-helpers', legacyPath: 'src/3d/gameLoopHelpers.js', modernPath: 'src/3d/gameLoopHelpers.ts', owner: 'runtime', status: 'migrated', risk: 'medium' },
  { id: 'assets', legacyPath: 'src/3d/assetLoader.js', modernPath: 'src/3d/assetLoader.ts', owner: 'rendering', status: 'migrated', risk: 'medium' },
  { id: 'camera', legacyPath: 'src/3d/camera.js', modernPath: 'src/3d/camera.ts', owner: 'rendering', status: 'migrated', risk: 'medium' },
  { id: 'render-quality', legacyPath: 'src/3d/renderQuality.js', modernPath: 'src/3d/renderQuality.ts', owner: 'rendering', status: 'migrated', risk: 'medium' },
  { id: 'weather', legacyPath: 'src/3d/world/weather.js', modernPath: 'src/3d/world/weather.ts', owner: 'world', status: 'migrated', risk: 'medium' },
  { id: 'world-events', legacyPath: 'src/3d/gameplay/worldEvents.js', modernPath: 'src/3d/gameplay/worldEvents.ts', owner: 'runtime', status: 'migrated', risk: 'medium' },
  { id: 'world', legacyPath: 'src/3d/world/', modernPath: 'src/3d/modern/worldRuntimeR3.ts', owner: 'world', status: 'facaded', risk: 'high' },
  { id: 'save', legacyPath: 'src/3d/saveSystem.js', modernPath: 'src/3d/modern/saveRuntimeR3.ts', owner: 'persistence', status: 'facaded', risk: 'medium' },
  { id: 'audio', legacyPath: 'src/3d/audio.js', modernPath: 'src/3d/modern/audioRuntimeR3.ts', owner: 'runtime', status: 'facaded', risk: 'medium' },
  { id: 'network', legacyPath: 'src/3d/network/', modernPath: 'src/3d/modern/networkRuntimeR3.ts', owner: 'network', status: 'facaded', risk: 'high' },
  { id: 'editor', legacyPath: 'src/3d/editor/', modernPath: 'src/3d/modern/editorRuntimeR3.ts', owner: 'ui', status: 'planned', risk: 'high' },
  { id: 'tools', legacyPath: 'scripts/*.js', modernPath: 'scripts/*.ts', owner: 'tooling', status: 'facaded', risk: 'low' },
  { id: 'service-worker', legacyPath: 'service-worker.js', modernPath: 'service-worker.ts', owner: 'runtime', status: 'facaded', risk: 'medium' },
] as const satisfies readonly MigrationModuleRecord[];

export function createMigrationLedger(tick: RuntimeTick = 0): MigrationLedgerSnapshot {
  const legacyCount = R3_MIGRATION_MODULES.filter((module) => module.status !== 'retired').length;
  const migratedCount = R3_MIGRATION_MODULES.filter((module) => module.status === 'migrated' || module.status === 'retired').length;
  const coveragePercent = legacyCount === 0 ? 100 : Number(((migratedCount / legacyCount) * 100).toFixed(2));
  return {
    version: 6,
    generatedAtTick: tick,
    modules: [...R3_MIGRATION_MODULES],
    legacyCount,
    migratedCount,
    coveragePercent,
  };
}

export function createMigrationEvent(ledger: MigrationLedgerSnapshot, tick: number): RuntimeEvent {
  const payload: RuntimeEnvelope = {
    version: 6,
    kind: 'migration-ledger',
    tick,
    sequence: tick,
    payload: ledger,
  };
  return payload as RuntimeEvent;
}
