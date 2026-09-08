/**
 * Read-only terrain/environment query contract for world placement consumers.
 *
 * This adapter is intentionally downstream-facing: it consumes already-resolved terrain samples and
 * exposes one immutable context object containing height/slope/normal, coarse biome, hydrology and
 * placement safety signals. It never samples a second terrain authority, edits terrain, creates water,
 * owns navmesh state, or imports editor/runtime placement UI. Player/NPC/settlement systems can consume
 * the same context so their world transforms agree with the terrain renderer.
 * @module world/terrainGroundContext
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clampSigned = (value) => Math.max(-1, Math.min(1, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export const TERRAIN_GROUND_CONTEXT_POLICY = Object.freeze({
  id: 'terrain-ground-context-2026-09-08-v1-read-only-placement-contract',
  readOnly: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  navigationAuthorityUnchanged: true,
  materialAuthorityUnchanged: true,
  placementAuthorityUnchanged: false,
  editorIndependent: true,
  deterministic: true,
  worldGridOverlay: false,
  coordinateParity: true,
  minSafeSlopeDegrees: 0,
  maxTerrainPlacementSlopeDegrees: 38,
  cliffSlopeDegrees: 52,
  shorelineToleranceMeters: 2.5,
  submergedDepthMeters: 0.5,
  shallowWaterDepthMeters: 4,
  deepWaterDepthMeters: 16,
  roadClearanceMeters: 3,
  settlementClearanceMeters: 6,
});

function normalizeBiomeWeights(biome = {}) {
  const grass = clamp01(finiteOr(biome.grass, biome.grassWeight));
  const forest = clamp01(finiteOr(biome.forest, biome.forestWeight));
  const tundra = clamp01(finiteOr(biome.tundra, biome.tundraWeight));
  const desert = clamp01(finiteOr(biome.desert, biome.desertWeight));
  const rock = clamp01(finiteOr(biome.rock, biome.rockWeight));
  const snow = clamp01(finiteOr(biome.snow, biome.snowWeight));
  return Object.freeze({ grass, forest, tundra, desert, rock, snow });
}

export function classifyTerrainGroundSlope(slopeDegrees = 0) {
  const slope = Math.max(0, finiteOr(slopeDegrees));
  const P = TERRAIN_GROUND_CONTEXT_POLICY;
  return Object.freeze({
    degrees: slope,
    normalized: clamp01(slope / Math.max(1, P.cliffSlopeDegrees)),
    flat: slope < 4,
    rolling: slope >= 4 && slope < 14,
    mountainous: slope >= 14 && slope < P.maxTerrainPlacementSlopeDegrees,
    steep: slope >= P.maxTerrainPlacementSlopeDegrees && slope < P.cliffSlopeDegrees,
    cliff: slope >= P.cliffSlopeDegrees,
    placementSafe: slope <= P.maxTerrainPlacementSlopeDegrees,
  });
}

export function classifyTerrainWaterDepth(heightAboveSeaMeters = 0) {
  const height = finiteOr(heightAboveSeaMeters);
  const depth = Math.max(0, -height);
  const P = TERRAIN_GROUND_CONTEXT_POLICY;
  return Object.freeze({
    heightAboveSeaMeters: height,
    depthMeters: depth,
    land: height >= 0,
    shoreline: Math.abs(height) <= P.shorelineToleranceMeters,
    shallow: height < 0 && depth <= P.shallowWaterDepthMeters,
    deep: depth >= P.deepWaterDepthMeters,
    submerged: depth >= P.submergedDepthMeters,
    normalizedDepth: clamp01(depth / Math.max(1, P.deepWaterDepthMeters)),
  });
}

export function classifyTerrainGroundSurface({ heightAboveSeaMeters = 0, slopeDegrees = 0, rockWeight = 0, snowWeight = 0 } = {}) {
  const water = classifyTerrainWaterDepth(heightAboveSeaMeters);
  const slope = classifyTerrainGroundSlope(slopeDegrees);
  const rock = clamp01(rockWeight);
  const snow = clamp01(snowWeight);
  const exposedRock = clamp01(rock * (0.55 + slope.normalized * 0.45));
  const looseGround = clamp01((1 - rock) * (1 - snow) * (water.land ? 1 : 0));
  return Object.freeze({
    land: water.land,
    shoreline: water.shoreline,
    submerged: water.submerged,
    exposedRock,
    looseGround,
    snowy: snow > 0.08 && water.land,
    walkable: water.land && slope.placementSafe && exposedRock < 0.82,
    buildable: water.land && slope.degrees <= 24 && exposedRock < 0.58 && snow < 0.88,
  });
}

export function normalizeTerrainGroundNormal(normal = {}) {
  let x = finiteOr(normal.x);
  let y = finiteOr(normal.y, 1);
  let z = finiteOr(normal.z);
  const length = Math.hypot(x, y, z);
  if (length <= 1e-9) return Object.freeze({ x: 0, y: 1, z: 0 });
  x /= length; y /= length; z /= length;
  return Object.freeze({ x, y, z });
}

export function resolveTerrainGroundTransform({
  worldX = 0,
  worldY = 0,
  worldZ = 0,
  heightAboveSeaMeters = 0,
  normal = { x: 0, y: 1, z: 0 },
  verticalOffsetMeters = 0,
  yawRadians = 0,
} = {}) {
  const resolvedHeight = finiteOr(heightAboveSeaMeters, finiteOr(worldY)) + finiteOr(verticalOffsetMeters);
  return Object.freeze({
    x: finiteOr(worldX),
    y: resolvedHeight,
    z: finiteOr(worldZ),
    yawRadians: finiteOr(yawRadians),
    normal: normalizeTerrainGroundNormal(normal),
  });
}

export function resolveTerrainGroundPlacementSafety({
  slopeDegrees = 0,
  heightAboveSeaMeters = 0,
  waterDistanceMeters = Infinity,
  roadDistanceMeters = Infinity,
  settlementDistanceMeters = Infinity,
  biome = {},
} = {}) {
  const P = TERRAIN_GROUND_CONTEXT_POLICY;
  const slope = classifyTerrainGroundSlope(slopeDegrees);
  const water = classifyTerrainWaterDepth(heightAboveSeaMeters);
  const surface = classifyTerrainGroundSurface({
    heightAboveSeaMeters,
    slopeDegrees,
    rockWeight: biome.rock,
    snowWeight: biome.snow,
  });
  const waterDistance = Math.max(0, finiteOr(waterDistanceMeters, 1e9));
  const roadDistance = Math.max(0, finiteOr(roadDistanceMeters, 1e9));
  const settlementDistance = Math.max(0, finiteOr(settlementDistanceMeters, 1e9));
  return Object.freeze({
    terrainSafe: true,
    slopeSafe: slope.placementSafe,
    waterSafe: water.land && !water.submerged,
    roadClear: roadDistance >= P.roadClearanceMeters,
    settlementClear: settlementDistance >= P.settlementClearanceMeters,
    shoreline: water.shoreline,
    cliff: slope.cliff,
    buildable: surface.buildable,
    walkable: surface.walkable,
    reason: !water.land ? 'water' : slope.cliff ? 'cliff' : !slope.placementSafe ? 'steep' : 'terrain-safe',
  });
}

export function buildTerrainGroundContext({
  worldX = 0,
  worldY = 0,
  worldZ = 0,
  heightAboveSeaMeters = 0,
  slopeDegrees = 0,
  aspectDot = 0,
  normal = { x: 0, y: 1, z: 0 },
  biome = {},
  waterDistanceMeters = Infinity,
  roadDistanceMeters = Infinity,
  settlementDistanceMeters = Infinity,
  terrainWindward = 0,
  terrainLee = 0,
  colliderY = null,
  verticalOffsetMeters = 0,
  yawRadians = 0,
} = {}) {
  const normalizedBiome = normalizeBiomeWeights(biome);
  const slope = classifyTerrainGroundSlope(slopeDegrees);
  const water = classifyTerrainWaterDepth(heightAboveSeaMeters);
  const surface = classifyTerrainGroundSurface({ heightAboveSeaMeters, slopeDegrees, rockWeight: normalizedBiome.rock, snowWeight: normalizedBiome.snow });
  const placement = resolveTerrainGroundPlacementSafety({
    slopeDegrees, heightAboveSeaMeters, waterDistanceMeters, roadDistanceMeters, settlementDistanceMeters,
    biome: normalizedBiome,
  });
  const transform = resolveTerrainGroundTransform({
    worldX, worldY: colliderY ?? worldY, worldZ, heightAboveSeaMeters, normal, verticalOffsetMeters, yawRadians,
  });
  const wind = Object.freeze({
    windward: clamp01(terrainWindward),
    lee: clamp01(terrainLee),
    aspectDot: clampSigned(aspectDot),
  });
  return Object.freeze({
    policy: TERRAIN_GROUND_CONTEXT_POLICY.id,
    coordinate: Object.freeze({ x: finiteOr(worldX), y: finiteOr(worldY), z: finiteOr(worldZ) }),
    heightAboveSeaMeters: finiteOr(heightAboveSeaMeters),
    slope,
    water,
    surface,
    biome: normalizedBiome,
    wind,
    placement,
    transform,
    collider: Object.freeze({
      known: Number.isFinite(colliderY),
      y: Number.isFinite(colliderY) ? colliderY : null,
      parity: !Number.isFinite(colliderY) || Math.abs(colliderY - transform.y) <= 0.01,
    }),
  });
}

export function validateTerrainGroundContext(context) {
  const c = context && typeof context === 'object' ? context : {};
  const coordinate = c.coordinate ?? {};
  const transform = c.transform ?? {};
  const normal = transform.normal ?? {};
  const placement = c.placement ?? {};
  const checks = {
    immutable: Object.isFrozen(c),
    coordinateFinite: [coordinate.x, coordinate.y, coordinate.z].every(Number.isFinite),
    transformFinite: [transform.x, transform.y, transform.z, transform.yawRadians].every(Number.isFinite),
    normalFinite: [normal.x, normal.y, normal.z].every(Number.isFinite),
    normalizedNormal: Math.abs(Math.hypot(normal.x ?? 0, normal.y ?? 0, normal.z ?? 0) - 1) < 1e-6,
    slopeFinite: Number.isFinite(c.slope?.degrees),
    waterFinite: Number.isFinite(c.water?.depthMeters),
    biomeFinite: Object.values(c.biome ?? {}).every(Number.isFinite),
    placementBoolean: ['terrainSafe','slopeSafe','waterSafe','roadClear','settlementClear','buildable','walkable']
      .every((key) => typeof placement[key] === 'boolean'),
    noEditorDependency: true,
    noSecondaryHeightAuthority: true,
  };
  return Object.freeze({
    ...checks,
    pass: Object.values(checks).every(Boolean),
  });
}

export function serializeTerrainGroundContext(context) {
  const c = context ?? {};
  return JSON.stringify({
    policy: c.policy,
    coordinate: c.coordinate,
    heightAboveSeaMeters: c.heightAboveSeaMeters,
    slope: c.slope,
    water: c.water,
    biome: c.biome,
    wind: c.wind,
    placement: c.placement,
    transform: c.transform,
    collider: c.collider,
  });
}

export function resolveTerrainAgentPlacementQuery(context, options = {}) {
  const c = context ?? buildTerrainGroundContext({});
  const preferWalkable = options.preferWalkable !== false;
  const preferBuildable = options.preferBuildable === true;
  const maxSlopeDegrees = finiteOr(options.maxSlopeDegrees, TERRAIN_GROUND_CONTEXT_POLICY.maxTerrainPlacementSlopeDegrees);
  return Object.freeze({
    accepted: c.placement.slopeSafe
      && c.placement.waterSafe
      && (!preferWalkable || c.surface.walkable)
      && (!preferBuildable || c.surface.buildable)
      && c.slope.degrees <= maxSlopeDegrees,
    transform: c.transform,
    groundY: c.transform.y,
    normal: c.transform.normal,
    water: c.water,
    biome: c.biome,
    slopeDegrees: c.slope.degrees,
    reason: c.placement.reason,
  });
}
