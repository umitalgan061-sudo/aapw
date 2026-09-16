import {
  advanceSeason,
  freeze,
  makeDefaultSeason,
  makeRevision,
  normalizeVec2,
  revision,
  type KingdomId,
  type KingdomState,
  type PlayerId,
  type Revision,
  type WorldState,
  kingdomId,
  playerId,
  validateStats,
} from '../domain/contracts.ts';
import { ImmutableStore } from '../state/immutableStore.ts';

export type WorldAction =
  | { readonly type: 'world/selectKingdom'; readonly kingdomId: KingdomId | null }
  | { readonly type: 'world/advance'; readonly days?: number }
  | { readonly type: 'kingdom/upsert'; readonly kingdom: KingdomState }
  | { readonly type: 'kingdom/remove'; readonly kingdomId: KingdomId }
  | { readonly type: 'kingdom/transfer'; readonly kingdomId: KingdomId; readonly owner: PlayerId | null }
  | { readonly type: 'kingdom/mutateStats'; readonly kingdomId: KingdomId; readonly patch: Partial<KingdomState['stats']> }
  | { readonly type: 'world/reset'; readonly worldId?: string };

export const createEmptyWorld = (worldId = 'westeros'): WorldState => freeze({
  schema: 2,
  worldId,
  season: makeDefaultSeason(),
  kingdoms: new Map(),
  selectedKingdom: null,
  revision: revision(0),
});

const cloneKingdom = (kingdom: KingdomState, patch: Partial<KingdomState> = {}): KingdomState => freeze({
  ...kingdom,
  ...patch,
  position: normalizeVec2(patch.position ?? kingdom.position),
  stats: validateStats(patch.stats ?? kingdom.stats),
});

export const worldReducer = (state: WorldState, action: WorldAction): WorldState => {
  switch (action.type) {
    case 'world/selectKingdom':
      return action.kingdomId === null || state.kingdoms.has(action.kingdomId)
        ? freeze({ ...state, selectedKingdom: action.kingdomId, revision: makeRevision(state.revision) })
        : state;
    case 'world/advance':
      return freeze({ ...state, season: advanceSeason(state.season, action.days ?? 1), revision: makeRevision(state.revision) });
    case 'kingdom/upsert': {
      const next = new Map(state.kingdoms);
      const current = next.get(action.kingdom.id);
      const kingdom = current && Number(current.revision) >= Number(action.kingdom.revision)
        ? current
        : cloneKingdom(action.kingdom, { revision: revision(Number(action.kingdom.revision)) });
      next.set(kingdom.id, kingdom);
      return freeze({ ...state, kingdoms: next, revision: makeRevision(state.revision) });
    }
    case 'kingdom/remove': {
      if (!state.kingdoms.has(action.kingdomId)) return state;
      const next = new Map(state.kingdoms);
      next.delete(action.kingdomId);
      return freeze({ ...state, kingdoms: next, selectedKingdom: state.selectedKingdom === action.kingdomId ? null : state.selectedKingdom, revision: makeRevision(state.revision) });
    }
    case 'kingdom/transfer': {
      const current = state.kingdoms.get(action.kingdomId);
      if (!current || current.owner === action.owner) return state;
      const next = new Map(state.kingdoms);
      next.set(action.kingdomId, cloneKingdom(current, { owner: action.owner, revision: makeRevision(current.revision) }));
      return freeze({ ...state, kingdoms: next, revision: makeRevision(state.revision) });
    }
    case 'kingdom/mutateStats': {
      const current = state.kingdoms.get(action.kingdomId);
      if (!current) return state;
      const stats = validateStats({ ...current.stats, ...action.patch });
      if (JSON.stringify(stats) === JSON.stringify(current.stats)) return state;
      const next = new Map(state.kingdoms);
      next.set(action.kingdomId, cloneKingdom(current, { stats, revision: makeRevision(current.revision) }));
      return freeze({ ...state, kingdoms: next, revision: makeRevision(state.revision) });
    }
    case 'world/reset': return createEmptyWorld(action.worldId ?? state.worldId);
  }
};

export interface SeedKingdomInput {
  readonly id: string;
  readonly name: string;
  readonly owner?: string | null;
  readonly x?: number;
  readonly y?: number;
  readonly stats?: Partial<KingdomState['stats']>;
  readonly neighbors?: readonly string[];
}

export const seedKingdom = (input: SeedKingdomInput, atRevision = 1): KingdomState => freeze({
  id: kingdomId(input.id),
  name: input.name.trim() || 'Unnamed Kingdom',
  owner: input.owner ? playerId(input.owner) : null,
  position: normalizeVec2({ x: input.x, y: input.y }),
  stats: validateStats(input.stats ?? {}),
  neighbors: (input.neighbors ?? []).map(kingdomId),
  revision: revision(atRevision),
  updatedAt: Date.now() as KingdomState['updatedAt'],
});

export const createWorldStore = (worldId = 'westeros'): ImmutableStore<WorldState, WorldAction> =>
  new ImmutableStore(createEmptyWorld(worldId), worldReducer);

export const worldSummary = (world: WorldState) => {
  let army = 0;
  let gold = 0;
  let navy = 0;
  let population = 0;
  let averageMorale = 0;
  for (const kingdom of world.kingdoms.values()) {
    army += kingdom.stats.army;
    gold += kingdom.stats.gold;
    navy += kingdom.stats.navy;
    population += kingdom.stats.population;
    averageMorale += kingdom.stats.morale;
  }
  const count = world.kingdoms.size;
  return freeze({
    worldId: world.worldId,
    revision: world.revision,
    kingdoms: count,
    army,
    gold,
    navy,
    population,
    averageMorale: count ? Number((averageMorale / count).toFixed(2)) : 0,
    season: world.season,
    selectedKingdom: world.selectedKingdom,
  });
};
