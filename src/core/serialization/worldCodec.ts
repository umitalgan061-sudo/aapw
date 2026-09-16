import { deterministicDigest } from '../runtime/deterministicClock.ts';
import { freeze, revision, type KingdomState, type WorldState, type Result, err, ok } from '../domain/contracts.ts';

export interface EncodedWorld {
  readonly schema: 2;
  readonly worldId: string;
  readonly season: WorldState['season'];
  readonly selectedKingdom: string | null;
  readonly revision: number;
  readonly kingdoms: readonly EncodedKingdom[];
  readonly checksum: string;
}

export interface EncodedKingdom {
  readonly id: string;
  readonly name: string;
  readonly owner: string | null;
  readonly position: KingdomState['position'];
  readonly stats: KingdomState['stats'];
  readonly neighbors: readonly string[];
  readonly revision: number;
  readonly updatedAt: number;
}

export interface DecodeOptions {
  readonly maxKingdoms?: number;
  readonly maxNeighbors?: number;
  readonly requireChecksum?: boolean;
}

const sanitizeKingdom = (kingdom: KingdomState, maxNeighbors: number): EncodedKingdom => freeze({
  id: String(kingdom.id).slice(0, 128),
  name: kingdom.name.slice(0, 128),
  owner: kingdom.owner ? String(kingdom.owner).slice(0, 128) : null,
  position: freeze({ x: finite(kingdom.position.x), y: finite(kingdom.position.y) }),
  stats: freeze({
    army: finite(kingdom.stats.army),
    gold: finite(kingdom.stats.gold),
    morale: finite(kingdom.stats.morale),
    navy: finite(kingdom.stats.navy),
    technology: finite(kingdom.stats.technology),
    population: finite(kingdom.stats.population),
    supply: finite(kingdom.stats.supply),
    stability: finite(kingdom.stats.stability),
  }),
  neighbors: [...kingdom.neighbors].slice(0, maxNeighbors).map(String),
  revision: Math.max(0, Math.floor(Number(kingdom.revision))),
  updatedAt: Math.max(0, Math.floor(Number(kingdom.updatedAt))),
});

const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const encodeWorld = (world: WorldState, options: { readonly maxKingdoms?: number; readonly maxNeighbors?: number } = {}): EncodedWorld => {
  const maxKingdoms = Math.max(1, Math.floor(options.maxKingdoms ?? 10_000));
  const maxNeighbors = Math.max(0, Math.floor(options.maxNeighbors ?? 128));
  const kingdoms = [...world.kingdoms.values()]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .slice(0, maxKingdoms)
    .map((kingdom) => sanitizeKingdom(kingdom, maxNeighbors));
  const checksum = deterministicDigest({ schema: 2, worldId: world.worldId, season: world.season, selectedKingdom: world.selectedKingdom ? String(world.selectedKingdom) : null, revision: Number(world.revision), kingdoms });
  return freeze({ schema: 2, worldId: world.worldId.slice(0, 128), season: world.season, selectedKingdom: world.selectedKingdom ? String(world.selectedKingdom) : null, revision: Number(world.revision), kingdoms, checksum });
};

export const stringifyWorld = (world: WorldState): string => JSON.stringify(encodeWorld(world));

export const decodeWorld = (input: unknown, options: DecodeOptions = {}): Result<WorldState> => {
  if (!input || typeof input !== 'object') return err({ code: 'WORLD_INVALID', message: 'World snapshot must be an object.' });
  const value = input as Partial<EncodedWorld>;
  if (value.schema !== 2 || typeof value.worldId !== 'string' || !Array.isArray(value.kingdoms)) return err({ code: 'WORLD_SCHEMA', message: 'Unsupported world snapshot schema.' });
  const maxKingdoms = Math.max(1, Math.floor(options.maxKingdoms ?? 10_000));
  if (value.kingdoms.length > maxKingdoms) return err({ code: 'WORLD_LIMIT', message: `World contains more than ${maxKingdoms} kingdoms.` });
  const selected = value.selectedKingdom ? String(value.selectedKingdom) : null;
  const encoded = value.kingdoms.map((kingdom) => normalizeEncodedKingdom(kingdom, options.maxNeighbors ?? 128));
  if (encoded.some((kingdom) => !kingdom.ok)) return err({ code: 'WORLD_KINGDOM_INVALID', message: 'One or more kingdom entries are malformed.' });
  const kingdoms = encoded.map((entry) => entry.value!).sort((a, b) => a.id.localeCompare(b.id));
  if (options.requireChecksum !== false) {
    const expected = deterministicDigest({ schema: 2, worldId: value.worldId, season: value.season, selectedKingdom: selected, revision: finite(value.revision), kingdoms });
    if (typeof value.checksum !== 'string' || value.checksum !== expected) return err({ code: 'WORLD_CHECKSUM', message: 'World snapshot checksum mismatch.' });
  }
  const known = new Set(kingdoms.map((kingdom) => kingdom.id));
  const map = new Map<string, KingdomState>();
  for (const kingdom of kingdoms) {
    const neighbors = kingdom.neighbors.filter((id) => known.has(id));
    map.set(kingdom.id, freeze({ ...kingdom, neighbors }) as KingdomState);
  }
  const selectedKingdom = selected && known.has(selected) ? selected : null;
  return ok(freeze({ schema: 2, worldId: value.worldId.slice(0, 128), season: normalizeSeason(value.season), kingdoms: map, selectedKingdom: selectedKingdom as WorldState['selectedKingdom'], revision: revision(finite(value.revision)) }));
};

const normalizeSeason = (season: unknown): WorldState['season'] => {
  const raw = season && typeof season === 'object' ? season as Record<string, unknown> : {};
  const phases: WorldState['season']['phase'][] = ['spring', 'summer', 'autumn', 'winter'];
  const phase = phases.includes(raw.phase as WorldState['season']['phase']) ? raw.phase as WorldState['season']['phase'] : 'spring';
  return freeze({ year: Math.max(1, Math.floor(finite(raw.year, 1))), turn: Math.max(1, Math.floor(finite(raw.turn, 1))), phase, day: Math.max(1, Math.min(30, Math.floor(finite(raw.day, 1)))), progress: Math.min(1, Math.max(0, finite(raw.progress))) });
};

const normalizeEncodedKingdom = (input: unknown, maxNeighbors: number): Result<KingdomState> => {
  if (!input || typeof input !== 'object') return err({ code: 'KINGDOM_INVALID', message: 'Kingdom entry must be an object.' });
  const value = input as Partial<EncodedKingdom>;
  if (typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string') return err({ code: 'KINGDOM_ID', message: 'Kingdom id and name are required.' });
  const position = value.position && typeof value.position === 'object' ? value.position : {};
  const stats = value.stats && typeof value.stats === 'object' ? value.stats : {};
  return ok(freeze({
    id: value.id.trim() as KingdomState['id'],
    name: value.name.trim().slice(0, 128),
    owner: value.owner ? value.owner.trim() as KingdomState['owner'] : null,
    position: freeze({ x: finite((position as { x?: unknown }).x), y: finite((position as { y?: unknown }).y) }),
    stats: freeze({
      army: Math.max(0, finite((stats as { army?: unknown }).army)),
      gold: Math.max(0, finite((stats as { gold?: unknown }).gold)),
      morale: clamp100((stats as { morale?: unknown }).morale, 50),
      navy: Math.max(0, finite((stats as { navy?: unknown }).navy)),
      technology: clamp100((stats as { technology?: unknown }).technology),
      population: Math.max(0, finite((stats as { population?: unknown }).population)),
      supply: clamp100((stats as { supply?: unknown }).supply, 100),
      stability: clamp100((stats as { stability?: unknown }).stability, 100),
    }),
    neighbors: Array.isArray(value.neighbors) ? value.neighbors.slice(0, Math.max(0, Math.floor(maxNeighbors))).filter((neighbor): neighbor is string => typeof neighbor === 'string').map((neighbor) => neighbor.slice(0, 128)) : [],
    revision: revision(finite(value.revision)),
    updatedAt: finite(value.updatedAt) as KingdomState['updatedAt'],
  }));
};

const clamp100 = (value: unknown, fallback = 0): number => Math.min(100, Math.max(0, finite(value, fallback)));

export const parseWorld = (serialized: string, options: DecodeOptions = {}): Result<WorldState> => {
  try { return decodeWorld(JSON.parse(serialized) as unknown, options); }
  catch (error) { return err({ code: 'WORLD_PARSE', message: error instanceof Error ? error.message : String(error) }); }
};
