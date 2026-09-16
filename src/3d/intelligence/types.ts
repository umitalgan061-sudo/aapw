import type { Vec3 } from '../types/platform.js';

export type IntelligenceId = string & { readonly __intelligenceId: unique symbol };
export type ActorId = string & { readonly __actorId: unique symbol };
export type FactionId = string & { readonly __factionId: unique symbol };
export type MemoryId = string & { readonly __memoryId: unique symbol };
export type GoalId = string & { readonly __goalId: unique symbol };
export type WorldEventId = string & { readonly __worldEventId: unique symbol };
export type TickNumber = number & { readonly __tickNumber: unique symbol };

export type ActorStance = 'calm' | 'curious' | 'alert' | 'afraid' | 'hostile' | 'fleeing' | 'disabled';
export type RelationKind = 'ally' | 'friendly' | 'neutral' | 'suspicious' | 'hostile' | 'fearful';
export type StimulusKind = 'visual' | 'audio' | 'damage' | 'death' | 'movement' | 'interaction' | 'resource' | 'weather' | 'faction';
export type GoalKind = 'survive' | 'investigate' | 'patrol' | 'hunt' | 'gather' | 'protect' | 'flee' | 'assist' | 'rest' | 'travel' | 'idle';
export type IntentKind = 'move' | 'look' | 'attack' | 'defend' | 'interact' | 'communicate' | 'wait' | 'flee' | 'follow';
export type InterestTier = 'critical' | 'high' | 'normal' | 'low' | 'sleeping';
export type WorldEventKind = 'combat' | 'discovery' | 'resource' | 'weather' | 'faction' | 'quest' | 'travel' | 'ecology';
export type QuestState = 'hidden' | 'available' | 'active' | 'blocked' | 'completed' | 'failed';

export interface NumericRange { readonly min: number; readonly max: number; }
export interface ActorSnapshot {
  readonly id: ActorId;
  readonly position: Vec3;
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly faction: FactionId;
  readonly stance: ActorStance;
  readonly alive: boolean;
  readonly level: number;
  readonly tags: readonly string[];
}

export interface FactionProfile {
  readonly id: FactionId;
  readonly name: string;
  readonly power: number;
  readonly territoryTags: readonly string[];
  readonly relations: Readonly<Record<string, RelationKind>>;
  readonly preferredGoals: readonly GoalKind[];
  readonly hostileTags: readonly string[];
}

export interface Stimulus {
  readonly id: string;
  readonly kind: StimulusKind;
  readonly sourceId?: ActorId;
  readonly position: Vec3;
  readonly radius: number;
  readonly intensity: number;
  readonly tick: TickNumber;
  readonly tags: readonly string[];
  readonly expiresAt: TickNumber;
}

export interface PerceivedStimulus extends Stimulus {
  readonly confidence: number;
  readonly occluded: boolean;
  readonly salience: number;
}

export interface MemoryRecord {
  readonly id: MemoryId;
  readonly subjectId?: ActorId;
  readonly kind: StimulusKind;
  readonly position: Vec3;
  readonly intensity: number;
  readonly confidence: number;
  readonly createdTick: TickNumber;
  readonly lastObservedTick: TickNumber;
  readonly decayPerTick: number;
  readonly tags: readonly string[];
}

export interface GoalDefinition {
  readonly id: GoalId;
  readonly kind: GoalKind;
  readonly priority: number;
  readonly durationTicks: number;
  readonly prerequisites: readonly string[];
  readonly interruptible: boolean;
  readonly cooldownTicks: number;
  readonly utilityWeights: Readonly<Record<string, number>>;
}

export interface GoalInstance {
  readonly id: string;
  readonly definition: GoalDefinition;
  readonly actorId: ActorId;
  readonly createdTick: TickNumber;
  readonly deadlineTick: TickNumber;
  readonly progress: number;
  readonly blocked: boolean;
}

export interface Intent {
  readonly actorId: ActorId;
  readonly kind: IntentKind;
  readonly score: number;
  readonly position?: Vec3;
  readonly targetId?: ActorId;
  readonly goalId?: GoalId;
  readonly reason: string;
  readonly expiresTick: TickNumber;
}

export interface DecisionContext {
  readonly tick: TickNumber;
  readonly actor: ActorSnapshot;
  readonly memories: readonly MemoryRecord[];
  readonly stimuli: readonly PerceivedStimulus[];
  readonly relationships: Readonly<Record<string, RelationKind>>;
  readonly nearbyActors: readonly ActorSnapshot[];
  readonly faction: FactionProfile;
  readonly weather: string;
  readonly timeOfDay: number;
  readonly danger: number;
}

export interface InterestCandidate {
  readonly id: string;
  readonly position: Vec3;
  readonly score: number;
  readonly tier: InterestTier;
  readonly reason: string;
  readonly tags: readonly string[];
}

export interface RegionInterest {
  readonly actorId: ActorId;
  readonly tick: TickNumber;
  readonly center: Vec3;
  readonly radius: number;
  readonly tier: InterestTier;
  readonly candidates: readonly InterestCandidate[];
}

export interface WorldEvent {
  readonly id: WorldEventId;
  readonly kind: WorldEventKind;
  readonly tick: TickNumber;
  readonly origin: Vec3;
  readonly radius: number;
  readonly intensity: number;
  readonly sourceFaction?: FactionId;
  readonly tags: readonly string[];
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export interface QuestNode {
  readonly id: string;
  readonly title: string;
  readonly prerequisites: readonly string[];
  readonly objectives: readonly QuestObjective[];
  readonly rewards: readonly QuestReward[];
}

export interface QuestObjective {
  readonly id: string;
  readonly kind: 'collect' | 'defeat' | 'discover' | 'interact' | 'escort' | 'visit' | 'survive';
  readonly target: string;
  readonly required: number;
}

export interface QuestReward {
  readonly id: string;
  readonly kind: 'item' | 'currency' | 'reputation' | 'unlock' | 'experience';
  readonly amount: number;
}

export interface QuestInstance {
  readonly id: string;
  readonly questId: string;
  readonly state: QuestState;
  readonly acceptedTick: TickNumber;
  readonly progress: Readonly<Record<string, number>>;
  readonly completedObjectives: readonly string[];
}

export interface EncounterDefinition {
  readonly id: string;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly weights: Readonly<Record<string, number>>;
  readonly biomeTags: readonly string[];
  readonly factionTags: readonly string[];
  readonly cooldownTicks: number;
  readonly maxParticipants: number;
}

export interface EncounterCandidate {
  readonly id: string;
  readonly position: Vec3;
  readonly definitionId: string;
  readonly score: number;
  readonly reason: string;
}

export interface IntelligenceConfig {
  readonly maxActorsPerTick: number;
  readonly maxStimuliPerActor: number;
  readonly maxMemoriesPerActor: number;
  readonly maxGoalsPerActor: number;
  readonly maxEvents: number;
  readonly maxQuestInstances: number;
  readonly maxInterestCandidates: number;
  readonly memoryHalfLifeTicks: number;
  readonly perceptionRadius: number;
  readonly decisionIntervalTicks: number;
  readonly eventRetentionTicks: number;
}

export interface IntelligenceMetrics {
  readonly tick: TickNumber;
  readonly actorsProcessed: number;
  readonly stimuliProcessed: number;
  readonly memoriesActive: number;
  readonly decisionsGenerated: number;
  readonly eventsAccepted: number;
  readonly questsUpdated: number;
  readonly encountersScored: number;
  readonly interestQueries: number;
  readonly budgetDrops: number;
}

export interface IntelligenceSnapshot {
  readonly version: '1.0.0';
  readonly tick: TickNumber;
  readonly actors: readonly ActorSnapshot[];
  readonly memories: readonly MemoryRecord[];
  readonly activeGoals: readonly GoalInstance[];
  readonly quests: readonly QuestInstance[];
  readonly events: readonly WorldEvent[];
  readonly metrics: IntelligenceMetrics;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function clampRange(value: number, range: NumericRange): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, value));
}

export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function safeTick(value: number): TickNumber {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Tick must be a non-negative safe integer');
  return value as TickNumber;
}

export function safeId<T extends string>(value: string, label: string): T {
  if (!value.trim()) throw new TypeError(`${label} must not be empty`);
  return value as T;
}
