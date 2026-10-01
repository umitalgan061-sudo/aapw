export type SettlementTravelService = 'stable' | 'tavern' | 'market' | 'farm' | 'barracks' | 'blacksmith';

export type SettlementTravelReason =
  | 'allowed'
  | 'unsupported-service'
  | 'unsupported-action'
  | 'service-closed'
  | 'quest-locked'
  | 'destination-locked'
  | 'player-unavailable'
  | 'insufficient-copper'
  | 'insufficient-stamina'
  | 'invalid-distance';

export interface SettlementTravelRequest {
  readonly service: SettlementTravelService | string;
  readonly action: string;
  readonly serviceOpen?: boolean;
  readonly requiredQuestIds?: readonly string[];
  readonly completedQuestIds?: readonly string[];
  readonly destinationUnlocked?: boolean;
  readonly playerAvailable?: boolean;
  readonly distanceMeters?: number;
  readonly copper?: number;
  readonly stamina?: number;
  readonly copperPerKilometer?: number;
  readonly staminaPerKilometer?: number;
}

export interface SettlementTravelPlan {
  readonly kind: 'settlement-travel-plan';
  readonly service: SettlementTravelService | null;
  readonly action: string | null;
  readonly allowed: boolean;
  readonly reason: SettlementTravelReason;
  readonly missingQuestIds: readonly string[];
  readonly distanceMeters: number;
  readonly copperCost: number;
  readonly staminaCost: number;
  readonly travelMinutes: number;
}

const TRAVEL_ACTION = 'travel';
const TRAVEL_SERVICES = new Set<SettlementTravelService>(['stable']);

function clampNonNegative(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))].sort();
}

function freezePlan(plan: SettlementTravelPlan): SettlementTravelPlan {
  return Object.freeze({ ...plan, missingQuestIds: Object.freeze([...plan.missingQuestIds]) });
}

export function planSettlementServiceTravel(request: SettlementTravelRequest): SettlementTravelPlan {
  const service = TRAVEL_SERVICES.has(request.service as SettlementTravelService)
    ? (request.service as SettlementTravelService)
    : null;
  const action = typeof request.action === 'string' ? request.action : null;
  const distanceMeters = clampNonNegative(request.distanceMeters);
  const copperPerKilometer = clampNonNegative(request.copperPerKilometer, 2);
  const staminaPerKilometer = clampNonNegative(request.staminaPerKilometer, 1);
  const copper = clampNonNegative(request.copper);
  const stamina = clampNonNegative(request.stamina);
  const requiredQuestIds = normalizeIds(request.requiredQuestIds);
  const completedQuestIds = new Set(normalizeIds(request.completedQuestIds));
  const missingQuestIds = requiredQuestIds.filter((id) => !completedQuestIds.has(id));
  const copperCost = Math.ceil((distanceMeters / 1000) * copperPerKilometer);
  const staminaCost = Math.ceil((distanceMeters / 1000) * staminaPerKilometer);
  const travelMinutes = Math.max(1, Math.ceil(distanceMeters / 250));

  let reason: SettlementTravelReason = 'allowed';
  if (!service) reason = 'unsupported-service';
  else if (action !== TRAVEL_ACTION) reason = 'unsupported-action';
  else if (request.playerAvailable === false) reason = 'player-unavailable';
  else if (request.serviceOpen === false) reason = 'service-closed';
  else if (missingQuestIds.length > 0) reason = 'quest-locked';
  else if (request.destinationUnlocked === false) reason = 'destination-locked';
  else if (!Number.isFinite(request.distanceMeters) || distanceMeters <= 0) reason = 'invalid-distance';
  else if (copper < copperCost) reason = 'insufficient-copper';
  else if (stamina < staminaCost) reason = 'insufficient-stamina';

  return freezePlan({
    kind: 'settlement-travel-plan',
    service,
    action,
    allowed: reason === 'allowed',
    reason,
    missingQuestIds,
    distanceMeters,
    copperCost,
    staminaCost,
    travelMinutes,
  });
}

export function applySettlementServiceTravel(
  plan: SettlementTravelPlan,
  player: { copper: number; stamina: number; worldMinutes: number },
): { copper: number; stamina: number; worldMinutes: number } {
  if (!plan.allowed) return { ...player };
  return {
    copper: Math.max(0, player.copper - plan.copperCost),
    stamina: Math.max(0, player.stamina - plan.staminaCost),
    worldMinutes: Math.max(0, player.worldMinutes + plan.travelMinutes),
  };
}
