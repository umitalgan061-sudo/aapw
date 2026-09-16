export type MigrationStatus = 'typed' | 'bridge' | 'legacy' | 'blocked';
export type MigrationPriority = 'critical' | 'high' | 'normal' | 'low';

export interface MigrationUnit {
  readonly id: string;
  readonly path: string;
  readonly owner: string;
  readonly status: MigrationStatus;
  readonly priority: MigrationPriority;
  readonly replacement: string;
  readonly risk: string;
  readonly notes: readonly string[];
}

export interface MigrationSummary {
  readonly total: number;
  readonly typed: number;
  readonly bridge: number;
  readonly legacy: number;
  readonly blocked: number;
  readonly completion: number;
}

export const MIGRATION_UNITS: readonly MigrationUnit[] = Object.freeze([
  { id: 'render-entry', path: 'src/3d/sceneManager.js', owner: 'render', status: 'bridge', priority: 'critical', replacement: 'src/3d/modern/v5/render.ts', risk: 'high', notes: ['Keep Three.js scene bootstrap unchanged while render planning moves to typed packets.'] },
  { id: 'game-loop', path: 'src/3d/game3d.js', owner: 'runtime', status: 'bridge', priority: 'critical', replacement: 'src/3d/modern/v5/runtime.ts', risk: 'high', notes: ['Fixed-step ownership is moved before per-frame presentation.'] },
  { id: 'physics', path: 'src/3d/physics.js', owner: 'world', status: 'bridge', priority: 'critical', replacement: 'src/3d/modern/v5/worldQuery.ts', risk: 'high', notes: ['Terrain remains the single height authority.'] },
  { id: 'asset-loader', path: 'src/3d/world/*.js', owner: 'assets', status: 'bridge', priority: 'high', replacement: 'src/3d/modern/v5/assetGraph.ts', risk: 'medium', notes: ['Keep existing asset URLs and authored materials; add validation first.'] },
  { id: 'player', path: 'src/3d/gameplay/*.js', owner: 'gameplay', status: 'bridge', priority: 'high', replacement: 'src/3d/modern/playerAuthority.ts', risk: 'high', notes: ['Authority transfer is deterministic and reversible.'] },
  { id: 'workers', path: 'src/3d/workers/*.js', owner: 'platform', status: 'bridge', priority: 'high', replacement: 'src/3d/modern/v5/workerBridge.ts', risk: 'medium', notes: ['Preserve message ordering and cancellation semantics.'] },
  { id: 'save', path: 'src/core/*Save*.js', owner: 'persistence', status: 'bridge', priority: 'high', replacement: 'src/3d/modern/v5/persistence.ts', risk: 'high', notes: ['Versioned envelopes prevent incompatible state restoration.'] },
  { id: 'input', path: 'src/3d/gameplay/*input*.js', owner: 'input', status: 'bridge', priority: 'high', replacement: 'src/3d/modern/v5/input.ts', risk: 'medium', notes: ['Keyboard, pointer and touch remain supported during cutover.'] },
  { id: 'network', path: 'src/3d/network/*.js', owner: 'network', status: 'bridge', priority: 'high', replacement: 'src/3d/modern/v5/network.ts', risk: 'high', notes: ['Snapshot and delta payloads are bounded before transport.'] },
  { id: 'ui', path: 'src/ui/**/*.js', owner: 'ui', status: 'legacy', priority: 'normal', replacement: 'future:src/ui/typed', risk: 'medium', notes: ['Keep visual UI stable until typed state bindings are complete.'] },
  { id: 'debug-scripts', path: 'scripts/**/*.js', owner: 'tooling', status: 'legacy', priority: 'low', replacement: 'future:scripts/**/*.ts', risk: 'low', notes: ['Convert deterministic and release-critical scripts first.'] },
  { id: 'service-worker', path: 'service-worker.js', owner: 'platform', status: 'legacy', priority: 'normal', replacement: 'future:service-worker.ts', risk: 'medium', notes: ['Retain worker semantics; use a dedicated build target.'] },
]);

export const migrationSummary = (units: readonly MigrationUnit[] = MIGRATION_UNITS): MigrationSummary => {
  const count = (status: MigrationStatus): number => units.filter((unit) => unit.status === status).length;
  const typed = count('typed');
  return {
    total: units.length,
    typed,
    bridge: count('bridge'),
    legacy: count('legacy'),
    blocked: count('blocked'),
    completion: units.length === 0 ? 1 : typed / units.length,
  };
};

export const criticalMigrationUnits = (): readonly MigrationUnit[] => MIGRATION_UNITS.filter((unit) => unit.priority === 'critical');
export const bridgeMigrationUnits = (): readonly MigrationUnit[] => MIGRATION_UNITS.filter((unit) => unit.status === 'bridge');
export const legacyMigrationUnits = (): readonly MigrationUnit[] => MIGRATION_UNITS.filter((unit) => unit.status === 'legacy');
