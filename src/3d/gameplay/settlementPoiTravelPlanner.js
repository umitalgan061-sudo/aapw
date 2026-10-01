/**
 * Deterministic, read-only POI/fast-travel projection over caller-owned settlement data.
 * It intentionally does not mutate travel, map, route, save or settlement state.
 */

export const SETTLEMENT_POI_TRAVEL_PLANNER_VERSION = 1;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const bool = (value) => value === true;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const freeze = (value) => Object.freeze(value);

const normalizePoi = (poi, index) => {
  const id = text(poi?.id, `poi-${index + 1}`);
  return {
    id,
    label: text(poi?.label, id),
    type: text(poi?.type, 'unknown'),
    distance: Math.round(clamp(poi?.distance, 0, 999999) * 100) / 100,
    unlocked: bool(poi?.unlocked),
    discovered: bool(poi?.discovered),
    service: text(poi?.service, ''),
    destination: text(poi?.destination, id),
  };
};

const comparePoi = (a, b) => (
  Number(b.unlocked) - Number(a.unlocked)
  || Number(b.discovered) - Number(a.discovered)
  || a.distance - b.distance
  || a.id.localeCompare(b.id)
);

export function planSettlementPoiTravel(context = {}) {
  const player = context?.player ?? {};
  const travel = context?.travel ?? {};
  const maxPois = Math.round(clamp(context?.limits?.maxPois, 1, 24));
  const maxRoutes = Math.round(clamp(context?.limits?.maxRoutes, 1, 12));
  const fatigue = clamp(player.fatigue, 0, 100);
  const health = clamp(player.health, 0, 100);
  const copper = Math.round(clamp(player.copper, 0, 999999));
  const canTravel = bool(travel.enabled) && health > 0 && !bool(travel.locked);
  const source = text(travel.currentSettlement, 'unknown-settlement');
  const pois = Array.isArray(context?.pois)
    ? context.pois.slice(0, maxPois).map(normalizePoi).sort(comparePoi)
    : [];
  const baseCost = clamp(travel.baseCost, 0, 999999);
  const fatiguePerDistance = clamp(travel.fatiguePerDistance, 0, 100);
  const routes = pois.slice(0, maxRoutes).map((poi) => {
    const cost = Math.round((baseCost + poi.distance * clamp(travel.costPerDistance, 0, 9999)) * 100) / 100;
    const fatigueCost = Math.round(poi.distance * fatiguePerDistance * 100) / 100;
    const affordable = copper >= cost;
    const safe = health > 0 && fatigue + fatigueCost <= 100;
    const available = canTravel && poi.unlocked && poi.discovered && affordable && safe;
    let reason = 'ready';
    if (!canTravel) reason = 'travel-locked';
    else if (!poi.unlocked) reason = 'poi-locked';
    else if (!poi.discovered) reason = 'undiscovered';
    else if (!affordable) reason = 'insufficient-copper';
    else if (!safe) reason = 'fatigue-risk';
    return { ...poi, cost, fatigueCost, affordable, safe, available, reason };
  });
  const available = routes.filter((route) => route.available);
  const output = {
    version: SETTLEMENT_POI_TRAVEL_PLANNER_VERSION,
    sourceSettlement: source,
    player: { fatigue, health, copper },
    canTravel,
    pois,
    routes,
    summary: {
      poiCount: pois.length,
      routeCount: routes.length,
      availableCount: available.length,
      blockedCount: routes.length - available.length,
      recommendedDestination: available[0]?.destination ?? null,
    },
  };
  return freeze({ ...output, pois: freeze(pois), routes: freeze(routes), summary: freeze(output.summary), player: freeze(output.player) });
}

export function serializeSettlementPoiTravelPlan(plan) {
  return JSON.stringify(plan ?? null);
}
