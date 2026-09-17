import type { Tick, Vec2, Vec3 } from '../types.ts';

export type SettlementId = string & { readonly __settlementId: unique symbol };
export type FactionId = string & { readonly __factionId: unique symbol };
export type ResourceKind = 'food' | 'wood' | 'stone' | 'iron' | 'gold' | 'water' | 'knowledge' | 'influence';
export type ClimateBand = 'polar' | 'cold' | 'temperate' | 'dry' | 'hot';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type RelationTier = 'war' | 'hostile' | 'tense' | 'neutral' | 'friendly' | 'allied';
export type SettlementState = 'thriving' | 'stable' | 'strained' | 'starving' | 'besieged' | 'abandoned';
export type WorldEventType =
  | 'harvest'
  | 'shortage'
  | 'surplus'
  | 'trade'
  | 'migration'
  | 'famine'
  | 'epidemic'
  | 'drought'
  | 'blizzard'
  | 'storm'
  | 'discovery'
  | 'diplomacy'
  | 'war'
  | 'peace'
  | 'rebellion'
  | 'raid'
  | 'festival'
  | 'caravan';

export interface ResourceStock {
  readonly food: number;
  readonly wood: number;
  readonly stone: number;
  readonly iron: number;
  readonly gold: number;
  readonly water: number;
  readonly knowledge: number;
  readonly influence: number;
}

export interface ResourceDelta {
  readonly food?: number;
  readonly wood?: number;
  readonly stone?: number;
  readonly iron?: number;
  readonly gold?: number;
  readonly water?: number;
  readonly knowledge?: number;
  readonly influence?: number;
}

export interface PopulationState {
  readonly total: number;
  readonly workers: number;
  readonly soldiers: number;
  readonly farmers: number;
  readonly specialists: number;
  readonly children: number;
  readonly elders: number;
  readonly morale: number;
  readonly health: number;
  readonly migrationPressure: number;
}

export interface SettlementProfile {
  readonly id: SettlementId;
  readonly name: string;
  readonly position: Vec3;
  readonly climate: ClimateBand;
  readonly elevationMeters: number;
  readonly fertility: number;
  readonly waterAccess: number;
  readonly defensibility: number;
  readonly coastal: boolean;
  readonly connectedRoads: number;
  readonly strategicValue: number;
}

export interface SettlementEconomy {
  readonly stocks: ResourceStock;
  readonly production: ResourceStock;
  readonly consumption: ResourceStock;
  readonly prices: Readonly<Record<ResourceKind, number>>;
  readonly tradeCapacity: number;
  readonly treasury: number;
  readonly debt: number;
}

export interface SettlementSnapshot {
  readonly profile: SettlementProfile;
  readonly state: SettlementState;
  readonly population: PopulationState;
  readonly economy: SettlementEconomy;
  readonly security: number;
  readonly stability: number;
  readonly prosperity: number;
}

export interface FactionProfile {
  readonly id: FactionId;
  readonly name: string;
  readonly colorKey: string;
  readonly militaryPower: number;
  readonly economicPower: number;
  readonly diplomaticPower: number;
  readonly aggression: number;
  readonly caution: number;
  readonly honor: number;
  readonly settlements: readonly SettlementId[];
}

export interface FactionRelation {
  readonly from: FactionId;
  readonly to: FactionId;
  readonly score: number;
  readonly tier: RelationTier;
  readonly trust: number;
  readonly tension: number;
  readonly trade: number;
  readonly borderPressure: number;
  readonly casusBelli: number;
  readonly lastChangedTick: Tick;
}

export interface DiplomacyDecision {
  readonly from: FactionId;
  readonly to: FactionId;
  readonly action: 'declare-war' | 'offer-peace' | 'trade' | 'alliance' | 'threaten' | 'ignore';
  readonly score: number;
  readonly reason: string;
}

export interface BiomeCell {
  readonly key: string;
  readonly center: Vec2;
  readonly climate: ClimateBand;
  readonly fertility: number;
  readonly moisture: number;
  readonly temperature: number;
  readonly carryingCapacity: number;
  readonly wildlifeCapacity: number;
  readonly disturbance: number;
}

export interface WildlifePopulation {
  readonly species: string;
  readonly cellKey: string;
  readonly population: number;
  readonly health: number;
  readonly foodPressure: number;
  readonly migrationBias: Vec2;
}

export interface EcologyEvent {
  readonly type: 'regrowth' | 'depletion' | 'migration' | 'dieoff' | 'recovery';
  readonly cellKey: string;
  readonly species?: string;
  readonly amount: number;
  readonly reason: string;
}

export interface WorldEvent {
  readonly id: string;
  readonly tick: Tick;
  readonly type: WorldEventType;
  readonly source: string;
  readonly priority: 0 | 1 | 2 | 3 | 4;
  readonly subjects: readonly (SettlementId | FactionId | string)[];
  readonly payload: Readonly<Record<string, number | string | boolean>>;
  readonly checksum: number;
}

export interface WorldEventDecision {
  readonly type: WorldEventType;
  readonly source: string;
  readonly priority: 0 | 1 | 2 | 3 | 4;
  readonly subject: SettlementId | FactionId | string;
  readonly probability: number;
  readonly severity: number;
  readonly payload: Readonly<Record<string, number | string | boolean>>;
}

export interface LivingWorldConfig {
  readonly ticksPerDay: number;
  readonly daysPerSeason: number;
  readonly eventCapPerTick: number;
  readonly settlementCap: number;
  readonly factionCap: number;
  readonly ecologyCellCount: number;
  readonly maxMigrationPerTick: number;
  readonly maxTradeRoutes: number;
}

export const DEFAULT_LIVING_WORLD_CONFIG: LivingWorldConfig = {
  ticksPerDay: 60 * 60,
  daysPerSeason: 30,
  eventCapPerTick: 64,
  settlementCap: 512,
  factionCap: 32,
  ecologyCellCount: 1024,
  maxMigrationPerTick: 64,
  maxTradeRoutes: 256,
};

export interface TradeRoute {
  readonly id: string;
  readonly from: SettlementId;
  readonly to: SettlementId;
  readonly distanceMeters: number;
  readonly capacity: number;
  readonly risk: number;
  readonly preferredResource: ResourceKind;
  readonly active: boolean;
}

export interface TradeTransfer {
  readonly route: string;
  readonly resource: ResourceKind;
  readonly amount: number;
  readonly value: number;
  readonly from: SettlementId;
  readonly to: SettlementId;
}

export interface MigrationTransfer {
  readonly from: SettlementId;
  readonly to: SettlementId;
  readonly population: number;
  readonly reason: 'food' | 'safety' | 'work' | 'climate' | 'war';
}

export interface LivingWorldFrame {
  readonly tick: Tick;
  readonly day: number;
  readonly season: Season;
  readonly year: number;
  readonly settlements: readonly SettlementSnapshot[];
  readonly factions: readonly FactionProfile[];
  readonly relations: readonly FactionRelation[];
  readonly trade: readonly TradeTransfer[];
  readonly migration: readonly MigrationTransfer[];
  readonly ecology: readonly EcologyEvent[];
  readonly events: readonly WorldEvent[];
}

export interface LivingWorldHealth {
  readonly score: number;
  readonly settlementStability: number;
  readonly foodSecurity: number;
  readonly diplomaticStability: number;
  readonly ecologicalIntegrity: number;
  readonly activeCrises: number;
  readonly warnings: readonly string[];
}

export interface LivingWorldDiagnostics {
  readonly settlementCount: number;
  readonly factionCount: number;
  readonly relationCount: number;
  readonly routeCount: number;
  readonly population: number;
  readonly eventCount: number;
  readonly ecologyCells: number;
  readonly frameDigest: number;
}

export function settlementId(value: string): SettlementId {
  if (!value.trim()) throw new RangeError('Settlement id cannot be empty');
  return value.trim() as SettlementId;
}

export function factionId(value: string): FactionId {
  if (!value.trim()) throw new RangeError('Faction id cannot be empty');
  return value.trim() as FactionId;
}

export function emptyResources(): ResourceStock {
  return { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, water: 0, knowledge: 0, influence: 0 };
}

export function addResources(base: ResourceStock, delta: ResourceDelta): ResourceStock {
  return {
    food: Math.max(0, base.food + (delta.food ?? 0)),
    wood: Math.max(0, base.wood + (delta.wood ?? 0)),
    stone: Math.max(0, base.stone + (delta.stone ?? 0)),
    iron: Math.max(0, base.iron + (delta.iron ?? 0)),
    gold: Math.max(0, base.gold + (delta.gold ?? 0)),
    water: Math.max(0, base.water + (delta.water ?? 0)),
    knowledge: Math.max(0, base.knowledge + (delta.knowledge ?? 0)),
    influence: Math.max(0, base.influence + (delta.influence ?? 0)),
  };
}

export function resourceValue(stock: ResourceStock, prices: SettlementEconomy['prices']): number {
  return (Object.keys(stock) as ResourceKind[]).reduce((sum, kind) => sum + stock[kind] * prices[kind], 0);
}

export function climateMultiplier(climate: ClimateBand, season: Season): number {
  const table: Record<ClimateBand, Record<Season, number>> = {
    polar: { winter: 0.45, spring: 0.7, summer: 0.9, autumn: 0.6 },
    cold: { winter: 0.65, spring: 0.85, summer: 1.05, autumn: 0.8 },
    temperate: { winter: 0.75, spring: 1.1, summer: 1.2, autumn: 0.95 },
    dry: { winter: 0.8, spring: 0.95, summer: 0.65, autumn: 0.9 },
    hot: { winter: 0.95, spring: 1.05, summer: 0.8, autumn: 1.0 },
  };
  return table[climate][season];
}

export function relationTier(score: number): RelationTier {
  if (score <= -80) return 'war';
  if (score <= -45) return 'hostile';
  if (score <= -15) return 'tense';
  if (score < 25) return 'neutral';
  if (score < 70) return 'friendly';
  return 'allied';
}

export function seasonForTick(tick: number, config: LivingWorldConfig = DEFAULT_LIVING_WORLD_CONFIG): Season {
  const seasonIndex = Math.floor(tick / (config.ticksPerDay * config.daysPerSeason)) % 4;
  return (['winter', 'spring', 'summer', 'autumn'] as const)[seasonIndex] ?? 'winter';
}

export function yearForTick(tick: number, config: LivingWorldConfig = DEFAULT_LIVING_WORLD_CONFIG): number {
  return 1 + Math.floor(tick / (config.ticksPerDay * config.daysPerSeason * 4));
}

export function dayForTick(tick: number, config: LivingWorldConfig = DEFAULT_LIVING_WORLD_CONFIG): number {
  return Math.floor(tick / config.ticksPerDay) + 1;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function clamp100(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function safePopulation(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export function digestNumbers(values: readonly number[]): number {
  let hash = 2166136261;
  for (const value of values) {
    const scaled = Math.round(value * 1000);
    hash ^= scaled;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function direction(a: Vec3, b: Vec3): Vec3 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz);
  if (length <= Number.EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: dx / length, y: dy / length, z: dz / length };
}
