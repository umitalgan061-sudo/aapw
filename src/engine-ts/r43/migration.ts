import { stableDigest } from './contracts.ts';

export type OwnershipStatus = 'typed' | 'compatibility' | 'legacy' | 'vendor';

export interface OwnershipEntry {
  readonly path: string;
  readonly ownerPath?: string;
  readonly status: OwnershipStatus;
  readonly reason: string;
  readonly critical: boolean;
  readonly migratedAt?: string;
}

export interface OwnershipSummary {
  readonly total: number;
  readonly typed: number;
  readonly compatibility: number;
  readonly legacy: number;
  readonly vendor: number;
  readonly typedCoverage: number;
  readonly criticalTypedCoverage: number;
  readonly digest: string;
}

export class OwnershipLedger {
  #entries = new Map<string, OwnershipEntry>();

  register(entry: OwnershipEntry): void {
    const path = normalizePath(entry.path);
    if (!path) throw new Error('Ownership path cannot be empty');
    this.#entries.set(path, Object.freeze({ ...entry, path }));
  }

  registerMany(entries: readonly OwnershipEntry[]): void {
    for (const entry of entries) this.register(entry);
  }

  get(path: string): OwnershipEntry | undefined {
    return this.#entries.get(normalizePath(path));
  }

  list(status?: OwnershipStatus): readonly OwnershipEntry[] {
    const entries = [...this.#entries.values()].filter((entry) => !status || entry.status === status);
    return Object.freeze(entries.sort((a, b) => a.path.localeCompare(b.path)));
  }

  summary(): OwnershipSummary {
    const entries = this.list();
    const count = (status: OwnershipStatus) => entries.filter((entry) => entry.status === status).length;
    const critical = entries.filter((entry) => entry.critical);
    const criticalTyped = critical.filter((entry) => entry.status === 'typed').length;
    return Object.freeze({
      total: entries.length,
      typed: count('typed'),
      compatibility: count('compatibility'),
      legacy: count('legacy'),
      vendor: count('vendor'),
      typedCoverage: entries.length === 0 ? 1 : count('typed') / entries.length,
      criticalTypedCoverage: critical.length === 0 ? 1 : criticalTyped / critical.length,
      digest: stableDigest(entries),
    });
  }

  migrationBacklog(): readonly OwnershipEntry[] {
    return Object.freeze(
      this.list().filter((entry) => entry.status === 'legacy' || entry.status === 'compatibility'),
    );
  }

  assertCriticalCoverage(minimum = 1): void {
    if (this.summary().criticalTypedCoverage < minimum) {
      throw new Error('Critical TypeScript ownership coverage is below threshold.');
    }
  }
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim();
}

export function createCoreR43OwnershipLedger(): OwnershipLedger {
  const ledger = new OwnershipLedger();
  ledger.registerMany([
    { path: 'src/3d/game3d.ts', ownerPath: 'src/3d/game3d.ts', status: 'typed', reason: 'production 3D runtime owner', critical: true },
    { path: 'src/3d/sceneManager.ts', ownerPath: 'src/3d/sceneManager.ts', status: 'typed', reason: 'production scene bootstrap owner', critical: true },
    { path: 'src/3d/physics.ts', ownerPath: 'src/3d/physics.ts', status: 'typed', reason: 'grounding and collision owner', critical: true },
    { path: 'src/3d/gameplay/player.ts', ownerPath: 'src/3d/gameplay/player.ts', status: 'typed', reason: 'player simulation owner', critical: true },
    { path: 'src/3d/gameplay/npc.ts', ownerPath: 'src/3d/gameplay/npc.ts', status: 'typed', reason: 'npc authority owner', critical: true },
    { path: 'src/3d/world/terrain.ts', ownerPath: 'src/3d/world/terrain.ts', status: 'typed', reason: 'terrain generation owner', critical: true },
    { path: 'src/3d/world/water.ts', ownerPath: 'src/3d/world/water.ts', status: 'typed', reason: 'water rendering owner', critical: true },
    { path: 'src/3d/rts/rtsGame.ts', ownerPath: 'src/3d/rts/rtsGame.ts', status: 'typed', reason: 'RTS runtime owner', critical: true },
    { path: 'src/3d/strict/r42/index.ts', status: 'typed', reason: 'strict runtime public surface', critical: true },
    { path: 'src/3d/vendor/three/three.module.js', status: 'vendor', reason: 'third-party vendored runtime', critical: false },
  ]);
  return ledger;
}
