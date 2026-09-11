/**
 * Kızıl Ufuk world-coverage adaptation director.
 *
 * This module does not own terrain, water, roads, settlements, collision, NPC AI,
 * player state mutation, AnimationMixer, inventory, or material placement. It turns
 * caller-owned world observations into a deterministic player-facing presentation and
 * combat context that the existing gameplay owners may consume.
 *
 * World coverage contract:
 * - canonical owner extent: 9000 x 7000 metres;
 * - lattice: 36 x 28 cells, 250m per cell;
 * - every cell can be represented by zero or more caller observations;
 * - no geography is invented when a sample is absent;
 * - optional world features stay optional instead of becoming false blockers.
 *
 * @module gameplay/playerWorldCoverageDirector
 */

export const PLAYER_WORLD_COVERAGE_VERSION = 'kc-1';

export const PLAYER_WORLD_COVERAGE_CONFIG = Object.freeze({
  WORLD_WIDTH_METERS: 9000,
  WORLD_DEPTH_METERS: 7000,
  CELL_SIZE_METERS: 250,
  GRID_COLUMNS: 36,
  GRID_ROWS: 28,
  PLAYER_CONTEXT_RADIUS_METERS: 140,
  PLAYER_NEAR_RADIUS_METERS: 22,
  WATER_BLOCK_RADIUS_METERS: 3,
  ROAD_SOFT_RADIUS_METERS: 5,
  SETTLEMENT_SOFT_RADIUS_METERS: 12,
  HIGH_SLOPE_DEGREES: 32,
  EXTREME_SLOPE_DEGREES: 46,
  SNOWLINE_ELEVATION_METERS: 520,
  HIGH_ALPINE_ELEVATION_METERS: 1050,
  FULL_COVERAGE_EXPECTED_CELLS: 1008,
  MAX_SAMPLES_PER_CELL: 16,
  MAX_VISIBLE_COVERAGE_CELLS: 64,
  MAX_REVIEW_ROWS: 32,
  MAX_HISTORY_ROWS: 24,
  MAX_SAFE_DT_SECONDS: 0.1,
  MAX_SURFACE_WEIGHT: 1,
  DEFAULT_MOVEMENT_SCALE: 1,
  DEFAULT_STAMINA_SCALE: 1,
  DEFAULT_ATTACK_SCALE: 1,
  DEFAULT_AIM_SCALE: 1,
  DEFAULT_TRACTION: 1,
  DEFAULT_FOOT_PLANT: 1,
  DEFAULT_CAMERA_DISTANCE_METERS: 4.6,
});

const FINITE_FALLBACK = 0;
const EPSILON = 1e-6;

const SURFACES = Object.freeze([
  'grass',
  'soil',
  'mud',
  'sand',
  'rock',
  'scree',
  'snow',
  'wet-edge',
  'road',
  'settlement',
  'water',
  'unknown',
]);

const BIOMES = Object.freeze([
  'forest',
  'temperate',
  'alpine',
  'coast',
  'mountain',
  'wetland',
  'steppe',
  'tundra',
  'settlement',
  'unknown',
]);

const STANCES = Object.freeze(['neutral', 'guard', 'attack', 'dodge', 'ranged', 'stagger']);
const LOCOMOTION = Object.freeze(['idle', 'walk', 'run', 'sprint', 'airborne', 'combat']);
const QUALITY_RANK = Object.freeze({ unknown: 0, partial: 1, observed: 2, verified: 3 });

function numberOr(value, fallback = FINITE_FALLBACK) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonNegative(value, fallback = 0) {
  return Math.max(0, numberOr(value, fallback));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, numberOr(value, min)));
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(numberOr(value) * factor) / factor;
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function freezeClone(value) {
  return deepFreeze(JSON.parse(stableStringify(value)));
}

function distance2D(a, b) {
  const dx = numberOr(a?.x) - numberOr(b?.x);
  const dz = numberOr(a?.z) - numberOr(b?.z);
  return Math.hypot(dx, dz);
}

function distance3D(a, b) {
  const dx = numberOr(a?.x) - numberOr(b?.x);
  const dy = numberOr(a?.y) - numberOr(b?.y);
  const dz = numberOr(a?.z) - numberOr(b?.z);
  return Math.hypot(dx, dy, dz);
}

function angleDifferenceDegrees(a, b) {
  const normalize = (degrees) => ((degrees % 360) + 540) % 360 - 180;
  return Math.abs(normalize(numberOr(a)) - normalize(numberOr(b)));
}

function normalizeSurface(value) {
  const normalized = normalizeString(value, 'unknown').toLowerCase().replace(/[_ ]+/g, '-');
  return SURFACES.includes(normalized) ? normalized : 'unknown';
}

function normalizeBiome(value) {
  const normalized = normalizeString(value, 'unknown').toLowerCase().replace(/[_ ]+/g, '-');
  if (normalized === 'temperate-forest') return 'forest';
  if (normalized === 'high-alpine') return 'alpine';
  return BIOMES.includes(normalized) ? normalized : 'unknown';
}

function qualityForSample(sample) {
  if (!sample || typeof sample !== 'object') return 'unknown';
  if (sample.verified === true) return 'verified';
  if (sample.observed === true) return 'observed';
  const numericFields = [sample.groundY, sample.colliderY, sample.slopeDegrees, sample.elevationMeters];
  return numericFields.some(Number.isFinite) ? 'partial' : 'unknown';
}

function normalizePosition(position) {
  return {
    x: round(numberOr(position?.x)),
    y: round(numberOr(position?.y)),
    z: round(numberOr(position?.z)),
  };
}

export function worldToCell(position, config = PLAYER_WORLD_COVERAGE_CONFIG) {
  const x = clamp(numberOr(position?.x), -config.WORLD_WIDTH_METERS / 2, config.WORLD_WIDTH_METERS / 2 - EPSILON);
  const z = clamp(numberOr(position?.z), -config.WORLD_DEPTH_METERS / 2, config.WORLD_DEPTH_METERS / 2 - EPSILON);
  const column = clamp(Math.floor((x + config.WORLD_WIDTH_METERS / 2) / config.CELL_SIZE_METERS), 0, config.GRID_COLUMNS - 1);
  const row = clamp(Math.floor((z + config.WORLD_DEPTH_METERS / 2) / config.CELL_SIZE_METERS), 0, config.GRID_ROWS - 1);
  return { column, row, id: `c${String(row).padStart(2, '0')}-${String(column).padStart(2, '0')}` };
}

export function cellToCenter(column, row, config = PLAYER_WORLD_COVERAGE_CONFIG) {
  const safeColumn = clamp(Math.floor(numberOr(column)), 0, config.GRID_COLUMNS - 1);
  const safeRow = clamp(Math.floor(numberOr(row)), 0, config.GRID_ROWS - 1);
  return {
    x: round(-config.WORLD_WIDTH_METERS / 2 + (safeColumn + 0.5) * config.CELL_SIZE_METERS),
    y: 0,
    z: round(-config.WORLD_DEPTH_METERS / 2 + (safeRow + 0.5) * config.CELL_SIZE_METERS),
  };
}

export function enumerateCoverageCells(config = PLAYER_WORLD_COVERAGE_CONFIG) {
  const cells = [];
  for (let row = 0; row < config.GRID_ROWS; row += 1) {
    for (let column = 0; column < config.GRID_COLUMNS; column += 1) {
      cells.push({
        id: `c${String(row).padStart(2, '0')}-${String(column).padStart(2, '0')}`,
        row,
        column,
        center: cellToCenter(column, row, config),
      });
    }
  }
  return cells;
}

function normalizeDistanceMetric(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? round(n) : null;
}

export function normalizeWorldSample(input = {}) {
  const position = normalizePosition(input.position ?? input);
  const cell = worldToCell(position);
  const surface = normalizeSurface(input.surface);
  const biome = normalizeBiome(input.biome);
  const groundY = Number.isFinite(Number(input.groundY)) ? numberOr(input.groundY) : null;
  const colliderY = Number.isFinite(Number(input.colliderY)) ? numberOr(input.colliderY) : null;
  const canonicalY = Number.isFinite(Number(input.canonicalY)) ? numberOr(input.canonicalY) : null;
  const slopeDegrees = clamp(numberOr(input.slopeDegrees), 0, 89.9);
  const elevationMeters = numberOr(input.elevationMeters, groundY ?? 0);
  const moisture = clamp(numberOr(input.moisture), 0, 1);
  const snow = clamp(numberOr(input.snow), 0, 1);
  const waterDepthMeters = nonNegative(input.waterDepthMeters);
  const waterCoverage = clamp(numberOr(input.waterCoverage), 0, 1);
  const roadDistanceMeters = normalizeDistanceMetric(input.roadDistanceMeters);
  const settlementDistanceMeters = normalizeDistanceMetric(input.settlementDistanceMeters);
  const coastlineDistanceMeters = normalizeDistanceMetric(input.coastlineDistanceMeters);
  const cliffDistanceMeters = normalizeDistanceMetric(input.cliffDistanceMeters);
  const assetReady = input.assetReady !== false;
  const visible = input.visible !== false;
  const confidence = clamp(numberOr(input.confidence, QUALITY_RANK[qualityForSample(input)] / 3), 0, 1);
  return {
    id: normalizeString(input.id, `${cell.id}:${round(position.x, 2)}:${round(position.z, 2)}`),
    position,
    cell,
    surface,
    biome,
    groundY: groundY === null ? null : round(groundY),
    colliderY: colliderY === null ? null : round(colliderY),
    canonicalY: canonicalY === null ? null : round(canonicalY),
    slopeDegrees: round(slopeDegrees),
    elevationMeters: round(elevationMeters),
    moisture: round(moisture, 3),
    snow: round(snow, 3),
    waterDepthMeters: round(waterDepthMeters),
    waterCoverage: round(waterCoverage, 3),
    roadDistanceMeters,
    settlementDistanceMeters,
    coastlineDistanceMeters,
    cliffDistanceMeters,
    assetReady,
    visible,
    confidence: round(confidence, 3),
    quality: qualityForSample(input),
    tags: uniqueSorted(Array.isArray(input.tags) ? input.tags : []),
  };
}

function compareSamplePriority(a, b, playerPosition) {
  const distanceA = distance2D(a.position, playerPosition);
  const distanceB = distance2D(b.position, playerPosition);
  if (Math.abs(distanceA - distanceB) > EPSILON) return distanceA - distanceB;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (QUALITY_RANK[b.quality] !== QUALITY_RANK[a.quality]) return QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality];
  return a.id.localeCompare(b.id);
}

function nearestFinite(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? finite[0] : null;
}

function weightedMean(values) {
  let weightSum = 0;
  let valueSum = 0;
  for (const row of values) {
    const weight = clamp(numberOr(row.weight), 0, 1);
    if (!Number.isFinite(Number(row.value))) continue;
    weightSum += weight;
    valueSum += Number(row.value) * weight;
  }
  return weightSum > EPSILON ? valueSum / weightSum : null;
}

function majority(values, fallback = 'unknown') {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? fallback;
}

function coverageCellRecord(cell, samples) {
  const sorted = [...samples].sort((a, b) => a.id.localeCompare(b.id));
  const visible = sorted.filter((sample) => sample.visible);
  const best = sorted[0] ?? null;
  const surface = majority(sorted.map((sample) => sample.surface));
  const biome = majority(sorted.map((sample) => sample.biome));
  const quality = majority(sorted.map((sample) => sample.quality), 'unknown');
  const meanSlope = weightedMean(sorted.map((sample) => ({ value: sample.slopeDegrees, weight: sample.confidence })));
  const meanElevation = weightedMean(sorted.map((sample) => ({ value: sample.elevationMeters, weight: sample.confidence })));
  const meanMoisture = weightedMean(sorted.map((sample) => ({ value: sample.moisture, weight: sample.confidence })));
  const waterCoverage = Math.max(...sorted.map((sample) => sample.waterCoverage), 0);
  const blockedByWater = sorted.some((sample) => sample.waterDepthMeters > 0.05 && sample.waterCoverage > 0.5);
  const ready = sorted.length > 0 && sorted.some((sample) => sample.assetReady && sample.visible);
  return {
    id: cell.id,
    row: cell.row,
    column: cell.column,
    center: cell.center,
    sampleCount: sorted.length,
    visibleSampleCount: visible.length,
    surface,
    biome,
    quality,
    meanSlopeDegrees: meanSlope === null ? null : round(meanSlope),
    meanElevationMeters: meanElevation === null ? null : round(meanElevation),
    meanMoisture: meanMoisture === null ? null : round(meanMoisture, 3),
    waterCoverage: round(waterCoverage, 3),
    blockedByWater,
    ready,
    nearestSampleId: best?.id ?? null,
    sampleIds: sorted.slice(0, PLAYER_WORLD_COVERAGE_CONFIG.MAX_SAMPLES_PER_CELL).map((sample) => sample.id),
  };
}

export function buildCoverageLattice(samples = [], config = PLAYER_WORLD_COVERAGE_CONFIG) {
  const cells = enumerateCoverageCells(config);
  const grouped = new Map(cells.map((cell) => [cell.id, []]));
  for (const raw of Array.isArray(samples) ? samples : []) {
    const sample = normalizeWorldSample(raw);
    const bucket = grouped.get(sample.cell.id);
    if (!bucket) continue;
    if (bucket.length < config.MAX_SAMPLES_PER_CELL) bucket.push(sample);
  }
  const records = cells.map((cell) => coverageCellRecord(cell, grouped.get(cell.id) ?? []));
  const observed = records.filter((record) => record.sampleCount > 0);
  const ready = records.filter((record) => record.ready);
  const blockers = records.filter((record) => record.blockedByWater);
  const gaps = records.filter((record) => record.sampleCount === 0);
  return {
    version: PLAYER_WORLD_COVERAGE_VERSION,
    config: {
      widthMeters: config.WORLD_WIDTH_METERS,
      depthMeters: config.WORLD_DEPTH_METERS,
      cellSizeMeters: config.CELL_SIZE_METERS,
      columns: config.GRID_COLUMNS,
      rows: config.GRID_ROWS,
    },
    expectedCellCount: config.GRID_COLUMNS * config.GRID_ROWS,
    observedCellCount: observed.length,
    readyCellCount: ready.length,
    gapCellCount: gaps.length,
    waterBlockedCellCount: blockers.length,
    coverageRatio: round(observed.length / Math.max(1, config.GRID_COLUMNS * config.GRID_ROWS), 4),
    cells: records,
  };
}

function sampleSurfaceWeights(sample) {
  const moisture = clamp(sample.moisture, 0, 1);
  const snow = clamp(Math.max(sample.snow, sample.elevationMeters >= PLAYER_WORLD_COVERAGE_CONFIG.SNOWLINE_ELEVATION_METERS ? 0.2 : 0), 0, 1);
  const slope = clamp(sample.slopeDegrees / 60, 0, 1);
  const water = clamp(sample.waterCoverage + Math.min(1, sample.waterDepthMeters / 1.5), 0, 1);
  const weights = {
    grass: (1 - water) * (1 - snow) * (1 - slope) * (1 - moisture * 0.3),
    soil: (1 - water) * (1 - snow) * (0.25 + moisture * 0.45),
    mud: (1 - water) * moisture * (0.2 + sample.waterCoverage * 0.8),
    sand: (1 - snow) * Math.max(0, 1 - slope) * (sample.biome === 'coast' ? 0.8 : 0.12) * (1 - water * 0.5),
    rock: Math.min(1, 0.15 + slope * 0.85) * (1 - snow * 0.45),
    scree: Math.max(0, slope - 0.35) * 1.15 * (1 - snow * 0.2),
    snow: snow * (0.55 + clamp(sample.elevationMeters / PLAYER_WORLD_COVERAGE_CONFIG.HIGH_ALPINE_ELEVATION_METERS, 0, 1) * 0.45),
    'wet-edge': clamp(moisture * 0.5 + sample.waterCoverage * 0.5, 0, 1) * (1 - water * 0.45),
    road: sample.roadDistanceMeters !== null && sample.roadDistanceMeters <= PLAYER_WORLD_COVERAGE_CONFIG.ROAD_SOFT_RADIUS_METERS ? 1 : 0,
    settlement: sample.settlementDistanceMeters !== null && sample.settlementDistanceMeters <= PLAYER_WORLD_COVERAGE_CONFIG.SETTLEMENT_SOFT_RADIUS_METERS ? 1 : 0,
    water,
  };
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0);
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(total > EPSILON ? value / total : 0, 4)]));
}

function selectDominantSurface(weights, fallback = 'unknown') {
  const entries = Object.entries(weights);
  if (!entries.length) return fallback;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0][1] > 0 ? entries[0][0] : fallback;
}

function deriveSurfaceContext(sample) {
  const weights = sampleSurfaceWeights(sample);
  const dominantSurface = normalizeSurface(selectDominantSurface(weights));
  const water = weights.water;
  const roadProximity = sample.roadDistanceMeters !== null ? clamp(1 - sample.roadDistanceMeters / 30, 0, 1) : 0;
  const settlementProximity = sample.settlementDistanceMeters !== null ? clamp(1 - sample.settlementDistanceMeters / 50, 0, 1) : 0;
  const alpine = clamp((sample.elevationMeters - PLAYER_WORLD_COVERAGE_CONFIG.SNOWLINE_ELEVATION_METERS) / 600, 0, 1);
  const cliff = clamp((sample.slopeDegrees - PLAYER_WORLD_COVERAGE_CONFIG.HIGH_SLOPE_DEGREES) / 35, 0, 1);
  return {
    dominantSurface,
    surfaceWeights: weights,
    waterWeight: weights.water,
    roadProximity: round(roadProximity, 3),
    settlementProximity: round(settlementProximity, 3),
    alpineFactor: round(alpine, 3),
    cliffFactor: round(cliff, 3),
    traction: round(clamp(1 - (weights.mud * 0.42 + weights.snow * 0.22 + weights.scree * 0.3 + weights.water * 0.18), 0.45, 1), 3),
    footPlant: round(clamp(1 - (cliff * 0.35 + weights.snow * 0.12 + weights.scree * 0.16), 0.55, 1), 3),
  };
}

function deriveGrounding(sample) {
  const ground = sample.groundY ?? sample.canonicalY;
  const collider = sample.colliderY ?? ground;
  const canonical = sample.canonicalY ?? ground;
  const renderGroundDelta = ground === null || canonical === null ? null : round(ground - canonical, 4);
  const colliderDelta = ground === null || collider === null ? null : round(collider - ground, 4);
  const sameCoordinateReady = Number.isFinite(ground) && Number.isFinite(collider) && Math.abs(colliderDelta ?? 999) <= 0.18;
  const confidence = clamp(sample.confidence * (sameCoordinateReady ? 1 : 0.55), 0, 1);
  return {
    visualGroundY: ground === null ? null : round(ground),
    colliderGroundY: collider === null ? null : round(collider),
    canonicalGroundY: canonical === null ? null : round(canonical),
    renderGroundDelta,
    colliderDelta,
    grounded: sameCoordinateReady,
    snapRecommended: sameCoordinateReady && Math.abs(colliderDelta ?? 0) > 0.015,
    confidence: round(confidence, 3),
  };
}

function deriveEnvironmentalMovement(context, sample, equipment = {}) {
  const encumbrance = clamp(numberOr(equipment.encumbranceRatio), 0, 1);
  const surface = context.dominantSurface;
  const slope = clamp(sample.slopeDegrees / 45, 0, 1);
  const stance = normalizeString(equipment.stance, 'neutral');
  const baseSpeed = 1 - encumbrance * 0.25;
  const slopePenalty = 1 - slope * (surface === 'road' ? 0.08 : 0.18);
  const tractionBoost = context.traction;
  const guardPenalty = stance === 'guard' ? 0.5 : 1;
  const dodgePenalty = surface === 'snow' || surface === 'mud' ? 0.84 : surface === 'scree' ? 0.9 : 1;
  const movementScale = clamp(baseSpeed * slopePenalty * tractionBoost * guardPenalty, 0.45, 1.05);
  return {
    locomotionSpeedScale: round(movementScale, 3),
    walkScale: round(clamp(movementScale * 1.02, 0.45, 1.05), 3),
    runScale: round(clamp(movementScale * 0.98, 0.4, 1.04), 3),
    sprintScale: round(clamp(movementScale * dodgePenalty, 0.35, 1.03), 3),
    dodgeScale: round(clamp(dodgePenalty * (1 - slope * 0.12), 0.55, 1), 3),
    turnRateScale: round(clamp(1 - slope * 0.15 - encumbrance * 0.1, 0.62, 1), 3),
    staminaDrainScale: round(clamp(1 + (1 - tractionBoost) * 0.8 + slope * 0.25 + encumbrance * 0.4, 0.95, 1.8), 3),
    footPlantScale: round(context.footPlant, 3),
    airborneRisk: round(clamp(slope * 0.75 + (1 - context.traction) * 0.5, 0, 1), 3),
    surface,
  };
}

function deriveAnimationProfile(context, sample, movement) {
  const speed = clamp(numberOr(movement.speedMps), 0, 12);
  const locomotion = normalizeString(movement.locomotion, speed <= 0.05 ? 'idle' : speed < 2 ? 'walk' : speed < 5.5 ? 'run' : 'sprint');
  const lean = clamp(sample.slopeDegrees / 45, 0, 1) * (sample.slopeDegrees < 89 ? 1 : 0);
  const cadence = clamp(speed / 5.2, 0, 1);
  const footPlant = context.footPlant * (locomotion === 'sprint' ? 0.92 : 1);
  const attackWeight = movement.inAttack ? clamp(numberOr(movement.attackWeight, 1), 0, 1) : 0;
  const guardWeight = movement.inGuard ? 1 : 0;
  const additiveSurfaceMotion = clamp((context.cliffFactor * 0.5 + (1 - context.traction) * 0.45), 0, 0.8);
  return {
    locomotion: LOCOMOTION.includes(locomotion) ? locomotion : 'idle',
    locomotionWeight: round(clamp(cadence + (locomotion === 'idle' ? 0 : 0.2), 0, 1), 3),
    movementBlend: Object.freeze({
      idle: round(locomotion === 'idle' ? 1 : clamp(1 - cadence, 0, 1), 3),
      walk: round(locomotion === 'walk' ? 0.95 : clamp(0.55 - cadence * 0.35, 0, 0.55), 3),
      run: round(locomotion === 'run' ? 0.92 : clamp(cadence * 0.72, 0, 0.72), 3),
      sprint: round(locomotion === 'sprint' ? 0.9 : clamp(cadence - 0.72, 0, 0.28), 3),
    }),
    terrainLeanWeight: round(lean * 0.72, 3),
    footPlantWeight: round(clamp(footPlant, 0.5, 1), 3),
    additiveSurfaceMotion: round(additiveSurfaceMotion, 3),
    attackLayerWeight: round(attackWeight, 3),
    guardLayerWeight: round(guardWeight, 3),
    recoveryWeight: round(clamp((sample.slopeDegrees / 70) * 0.25 + (1 - context.traction) * 0.18, 0, 0.42), 3),
    playbackRate: round(clamp(0.88 + movement.locomotionScale * 0.12 + (1 - context.traction) * -0.08, 0.72, 1.16), 3),
  };
}

function deriveCombatProfile(context, sample, combat = {}, equipment = {}) {
  const stance = STANCES.includes(combat.stance) ? combat.stance : 'neutral';
  const weaponReach = clamp(numberOr(equipment.weaponReachMeters, 1.6), 0.7, 4.5);
  const slope = clamp(sample.slopeDegrees / 45, 0, 1);
  const unstableSurface = clamp((1 - context.traction) * 0.9 + context.cliffFactor * 0.35, 0, 1);
  const airborne = combat.isGrounded === false;
  const range = combat.rangedReady ? weaponReach + 2.2 : weaponReach;
  const dodgeScale = clamp(1 - unstableSurface * 0.28, 0.62, 1);
  const attackRecoveryScale = clamp(1 + slope * 0.18 + unstableSurface * 0.24, 0.9, 1.55);
  const blockStability = clamp(1 - unstableSurface * 0.25, 0.7, 1);
  const parryWindowScale = stance === 'guard' ? clamp(1 - unstableSurface * 0.08, 0.78, 1) : 1;
  const aimStability = clamp(1 - slope * 0.16 - unstableSurface * 0.2, 0.55, 1);
  return {
    stance,
    attackReachMeters: round(weaponReach * (1 + Math.min(0.12, slope * 0.04)), 3),
    lockOnRangeMeters: round(clamp(range * (combat.lockOn ? 1 : 0.9), 1.2, 8), 3),
    dodgeScale: round(dodgeScale, 3),
    attackRecoveryScale: round(attackRecoveryScale, 3),
    blockStability: round(blockStability, 3),
    parryWindowScale: round(parryWindowScale, 3),
    aimStability: round(aimStability, 3),
    rangedSpreadScale: round(clamp(1 + slope * 0.35 + (1 - aimStability) * 0.6, 1, 1.8), 3),
    poiseExposure: round(clamp((sample.slopeDegrees / 60) * 0.4 + unstableSurface * 0.4 + (airborne ? 0.35 : 0), 0, 1), 3),
    staminaCostScale: round(clamp(1 + slope * 0.16 + unstableSurface * 0.24, 0.95, 1.55), 3),
    eligible: !airborne && context.waterWeight < 0.92,
  };
}

function deriveEquipmentEnvironment(context, sample, equipment = {}) {
  const metal = clamp(numberOr(equipment.metalWeightRatio), 0, 1);
  const leather = clamp(numberOr(equipment.leatherWeightRatio), 0, 1);
  const wet = clamp(sample.moisture * 0.65 + sample.waterCoverage * 0.35, 0, 1);
  const cold = clamp((sample.elevationMeters - 250) / 950, 0, 1) * (0.4 + sample.snow * 0.6);
  const wear = clamp(wet * metal * 0.25 + cold * metal * 0.08, 0, 0.25);
  const clothDrag = clamp(wet * leather * 0.18 + sample.snow * 0.12, 0, 0.22);
  const socketReadiness = equipment.socketReady !== false && equipment.assetReady !== false;
  return {
    wetnessFactor: round(wet, 3),
    coldFactor: round(cold, 3),
    corrosionRisk: round(wear, 3),
    clothDrag: round(clothDrag, 3),
    socketReadiness,
    materialSurfaceRoles: uniqueSorted(Array.isArray(equipment.surfaceRoles) ? equipment.surfaceRoles : []),
    placementContract: {
      requiredOrder: ['source-asset', 'material-core', 'validate', 'placement-pipeline', 'ground-snap', 'scene-attach'],
      runtimeMaterialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
      runtimePlacementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
      editorUiForbidden: true,
    },
  };
}

function deriveCameraProfile(context, sample, camera = {}) {
  const distance = clamp(numberOr(camera.distanceMeters, PLAYER_WORLD_COVERAGE_CONFIG.DEFAULT_CAMERA_DISTANCE_METERS), 2.5, 8);
  const combat = camera.combat === true;
  const lockOn = camera.lockOn === true;
  const terrainNear = camera.terrainNear === true;
  const slope = clamp(sample.slopeDegrees / 50, 0, 1);
  const fog = clamp(numberOr(camera.fogAmount), 0, 1);
  return {
    distanceMeters: round(distance * (combat ? 0.92 : 1), 3),
    shoulderOffsetMeters: round((lockOn ? 0.32 : 0.22) * (sample.surface === 'road' ? 1 : 0.92), 3),
    pitchDegrees: round(terrainNear ? 8 + slope * 5 : combat ? 9 : 7, 3),
    fovDegrees: round(combat ? 62 : 58, 3),
    horizonStability: round(clamp(1 - fog * 0.35 - context.cliffFactor * 0.2, 0.55, 1), 3),
    targetVisibility: round(clamp((camera.targetVisible === false ? 0.45 : 1) * (1 - fog * 0.25), 0, 1), 3),
    fullWorldAcceptance: {
      resolution: '1536x1024',
      orthographic: camera.acceptanceOrthographic !== false,
      terrainNear,
      combat,
      worldCell: sample.cell.id,
    },
  };
}

function deriveInteractionSurface(sample, context, interaction = {}) {
  const insideSettlement = context.settlementProximity > 0.75;
  const nearRoad = context.roadProximity > 0.82;
  const nearWater = sample.waterCoverage > 0.35 || sample.waterDepthMeters > 0.2;
  const disabled = interaction.disabled === true;
  const candidates = [];
  if (!disabled) {
    if (insideSettlement) candidates.push('settlement');
    if (nearRoad) candidates.push('travel');
    if (nearWater) candidates.push('water-edge');
    candidates.push('world');
  }
  return {
    disabled,
    insideSettlement,
    nearRoad,
    nearWater,
    interactionCandidates: uniqueSorted(candidates),
    primary: candidates[0] ?? null,
  };
}

function deriveReviewRows(lattice, playerCell, config) {
  const visible = lattice.cells.filter((cell) => {
    const dx = cell.column - playerCell.column;
    const dz = cell.row - playerCell.row;
    return Math.hypot(dx, dz) <= Math.ceil(config.PLAYER_CONTEXT_RADIUS_METERS / config.CELL_SIZE_METERS);
  });
  return visible.sort((a, b) => {
    const missingA = a.sampleCount === 0 ? 1 : 0;
    const missingB = b.sampleCount === 0 ? 1 : 0;
    if (missingA !== missingB) return missingB - missingA;
    if (a.ready !== b.ready) return a.ready ? 1 : -1;
    return a.id.localeCompare(b.id);
  }).slice(0, config.MAX_REVIEW_ROWS).map((cell) => ({
    cellId: cell.id,
    status: cell.sampleCount === 0 ? 'gap' : cell.blockedByWater ? 'water-blocked' : cell.ready ? 'ready' : 'partial',
    sampleCount: cell.sampleCount,
    surface: cell.surface,
    biome: cell.biome,
    quality: cell.quality,
    center: cell.center,
  }));
}

function normalizePlayerState(input = {}) {
  return {
    position: normalizePosition(input.position),
    headingDegrees: numberOr(input.headingDegrees),
    speedMps: nonNegative(input.speedMps),
    locomotion: normalizeString(input.locomotion, 'idle'),
    isGrounded: input.isGrounded !== false,
    inAttack: input.inAttack === true,
    attackWeight: clamp(numberOr(input.attackWeight), 0, 1),
    inGuard: input.inGuard === true,
    lockOn: input.lockOn === true,
    rangedReady: input.rangedReady === true,
    stance: normalizeString(input.stance, input.inGuard ? 'guard' : 'neutral'),
    camera: input.camera && typeof input.camera === 'object' ? input.camera : {},
  };
}

function normalizeEquipmentState(input = {}) {
  return {
    encumbranceRatio: clamp(numberOr(input.encumbranceRatio), 0, 1),
    weaponReachMeters: numberOr(input.weaponReachMeters, 1.6),
    metalWeightRatio: clamp(numberOr(input.metalWeightRatio), 0, 1),
    leatherWeightRatio: clamp(numberOr(input.leatherWeightRatio), 0, 1),
    socketReady: input.socketReady !== false,
    assetReady: input.assetReady !== false,
    stance: normalizeString(input.stance, 'neutral'),
    surfaceRoles: Array.isArray(input.surfaceRoles) ? input.surfaceRoles : [],
  };
}

function normalizeCombatState(input = {}) {
  return {
    stance: normalizeString(input.stance, 'neutral'),
    isGrounded: input.isGrounded !== false,
    lockOn: input.lockOn === true,
    rangedReady: input.rangedReady === true,
  };
}

export function derivePlayerWorldContext({
  player = {},
  samples = [],
  equipment = {},
  combat = {},
  movement = {},
  interaction = {},
  nowSeconds = 0,
  config = PLAYER_WORLD_COVERAGE_CONFIG,
} = {}) {
  const normalizedPlayer = normalizePlayerState({ ...player, speedMps: movement.speedMps ?? player.speedMps, locomotion: movement.locomotion ?? player.locomotion });
  const normalizedEquipment = normalizeEquipmentState(equipment);
  const normalizedCombat = normalizeCombatState({ ...combat, isGrounded: normalizedPlayer.isGrounded, lockOn: normalizedPlayer.lockOn, rangedReady: normalizedPlayer.rangedReady });
  const allSamples = (Array.isArray(samples) ? samples : []).map(normalizeWorldSample);
  const lattice = buildCoverageLattice(allSamples, config);
  const playerCell = worldToCell(normalizedPlayer.position, config);
  const nearbySamples = allSamples
    .filter((sample) => distance2D(sample.position, normalizedPlayer.position) <= config.PLAYER_CONTEXT_RADIUS_METERS && sample.visible)
    .sort((a, b) => compareSamplePriority(a, b, normalizedPlayer.position))
    .slice(0, config.MAX_VISIBLE_COVERAGE_CELLS);
  const selected = nearbySamples[0] ?? allSamples.slice().sort((a, b) => compareSamplePriority(a, b, normalizedPlayer.position))[0] ?? normalizeWorldSample({ position: normalizedPlayer.position });
  const context = deriveSurfaceContext(selected);
  const grounding = deriveGrounding(selected);
  const environmentalMovement = deriveEnvironmentalMovement(context, selected, { ...normalizedEquipment, stance: normalizedPlayer.stance, speedMps: normalizedPlayer.speedMps });
  const animation = deriveAnimationProfile(context, selected, {
    speedMps: normalizedPlayer.speedMps,
    locomotion: normalizedPlayer.locomotion,
    inAttack: normalizedPlayer.inAttack,
    attackWeight: normalizedPlayer.attackWeight,
    inGuard: normalizedPlayer.inGuard,
    locomotionScale: environmentalMovement.locomotionSpeedScale,
  });
  const combatProfile = deriveCombatProfile(context, selected, normalizedCombat, normalizedEquipment);
  const equipmentEnvironment = deriveEquipmentEnvironment(context, selected, normalizedEquipment);
  const camera = deriveCameraProfile(context, selected, normalizedPlayer.camera);
  const interactionSurface = deriveInteractionSurface(selected, context, interaction);
  const reviewRows = deriveReviewRows(lattice, playerCell, config);
  const nearbyCellIds = nearbySamples.map((sample) => sample.cell.id);
  const eventBridge = {
    worldCoverageVersion: PLAYER_WORLD_COVERAGE_VERSION,
    playerCellId: playerCell.id,
    surface: context.dominantSurface,
    biome: selected.biome,
    eligibleForCombat: combatProfile.eligible,
    eligibleForInteraction: interactionSurface.interactionCandidates.length > 0,
    worldEventContext: {
      elevationMeters: selected.elevationMeters,
      slopeDegrees: selected.slopeDegrees,
      moisture: selected.moisture,
      snow: selected.snow,
      waterCoverage: selected.waterCoverage,
    },
  };
  const evidence = {
    visualColliderGroundParity: grounding.grounded,
    groundedPlacementEligible: grounding.grounded && context.waterWeight < 0.92,
    missingAssetCount: allSamples.filter((sample) => !sample.assetReady).length,
    visibleSampleCount: nearbySamples.length,
    materialPlacementRequired: equipmentEnvironment.socketReadiness === false || normalizedEquipment.surfaceRoles.length > 0,
    materialCore: equipmentEnvironment.placementContract.runtimeMaterialAuthority,
    placementPipeline: equipmentEnvironment.placementContract.runtimePlacementAuthority,
    editorUiImported: false,
  };
  const summary = {
    playerCellId: playerCell.id,
    surface: context.dominantSurface,
    biome: selected.biome,
    groundConfidence: grounding.confidence,
    coverageRatio: lattice.coverageRatio,
    nearbySampleCount: nearbySamples.length,
    combatReady: combatProfile.eligible,
    movementScale: environmentalMovement.locomotionSpeedScale,
    footPlant: animation.footPlantWeight,
  };
  const result = {
    version: PLAYER_WORLD_COVERAGE_VERSION,
    nowSeconds: round(numberOr(nowSeconds), 3),
    config: {
      worldWidthMeters: config.WORLD_WIDTH_METERS,
      worldDepthMeters: config.WORLD_DEPTH_METERS,
      cellSizeMeters: config.CELL_SIZE_METERS,
      expectedCells: config.GRID_COLUMNS * config.GRID_ROWS,
    },
    player: normalizedPlayer,
    selectedSample: selected,
    surfaceContext: context,
    grounding,
    movement: environmentalMovement,
    animation,
    combat: combatProfile,
    equipment: equipmentEnvironment,
    camera,
    interaction: interactionSurface,
    coverage: {
      expectedCellCount: lattice.expectedCellCount,
      observedCellCount: lattice.observedCellCount,
      readyCellCount: lattice.readyCellCount,
      gapCellCount: lattice.gapCellCount,
      coverageRatio: lattice.coverageRatio,
      playerCell,
      nearbyCellIds: uniqueSorted(nearbyCellIds),
      reviewRows,
    },
    eventBridge,
    evidence,
    summary,
  };
  const canonical = stableStringify(result);
  return deepFreeze({ ...result, fingerprint: hashString(canonical) });
}

export function validatePlayerWorldContext(snapshot, {
  requireFullWorldCoverage = false,
  requireGrounded = true,
  maxMissingAssets = 0,
} = {}) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== 'object') errors.push('missing-snapshot');
  if (snapshot?.version !== PLAYER_WORLD_COVERAGE_VERSION) errors.push('version-mismatch');
  if (!snapshot?.selectedSample?.cell?.id) errors.push('missing-selected-cell');
  if (!snapshot?.evidence || typeof snapshot.evidence !== 'object') errors.push('missing-evidence');
  if (requireGrounded && snapshot?.grounding?.grounded !== true) errors.push('grounding-unverified');
  if (Number(snapshot?.evidence?.missingAssetCount ?? 0) > maxMissingAssets) errors.push('missing-assets');
  if (snapshot?.coverage?.coverageRatio < 1 && requireFullWorldCoverage) errors.push('world-coverage-gap');
  if (snapshot?.coverage?.gapCellCount > 0 && !requireFullWorldCoverage) warnings.push('world-coverage-partial');
  if (snapshot?.evidence?.editorUiImported === true) errors.push('editor-runtime-import');
  if (snapshot?.equipment?.placementContract?.runtimeMaterialAuthority !== 'src/3d/materials/MaterialAssignmentCore.js') errors.push('wrong-material-authority');
  if (snapshot?.equipment?.placementContract?.runtimePlacementAuthority !== 'src/3d/world/WorldAssetPlacementPipeline.js') errors.push('wrong-placement-authority');
  if (snapshot?.summary?.movementScale < 0.35) warnings.push('movement-heavily-restricted');
  if (snapshot?.surfaceContext?.waterWeight > 0.92) warnings.push('water-dominant-sample');
  const serial = stableStringify({ ...snapshot, fingerprint: undefined });
  const expectedFingerprint = hashString(serial.replace(/,"fingerprint":undefined/, ''));
  const fingerprintOkay = typeof snapshot?.fingerprint === 'string' && snapshot.fingerprint.length === 8;
  return deepFreeze({ ok: errors.length === 0, errors, warnings, fingerprintOkay, expectedFingerprint });
}

export function buildWorldCoverageAcceptanceManifest(snapshot, options = {}) {
  const validation = validatePlayerWorldContext(snapshot, options);
  const manifest = {
    manifestVersion: 1,
    directorVersion: PLAYER_WORLD_COVERAGE_VERSION,
    accepted: validation.ok,
    playerCellId: snapshot?.coverage?.playerCell?.id ?? null,
    coverage: {
      expected: snapshot?.coverage?.expectedCellCount ?? PLAYER_WORLD_COVERAGE_CONFIG.FULL_COVERAGE_EXPECTED_CELLS,
      observed: snapshot?.coverage?.observedCellCount ?? 0,
      ratio: snapshot?.coverage?.coverageRatio ?? 0,
      gaps: snapshot?.coverage?.gapCellCount ?? 0,
    },
    worldSurface: snapshot?.surfaceContext?.dominantSurface ?? 'unknown',
    biome: snapshot?.selectedSample?.biome ?? 'unknown',
    grounding: snapshot?.grounding ?? null,
    material: {
      authority: 'src/3d/materials/MaterialAssignmentCore.js',
      validationRequired: true,
      editorUiForbidden: true,
    },
    placement: {
      authority: 'src/3d/world/WorldAssetPlacementPipeline.js',
      sourceBeforeDerived: true,
      groundSnapRequired: snapshot?.grounding?.snapRecommended === true,
      attachAfterValidation: true,
    },
    animation: snapshot?.animation ?? null,
    combat: snapshot?.combat ?? null,
    camera: snapshot?.camera ?? null,
    errors: validation.errors,
    warnings: validation.warnings,
    fingerprint: snapshot?.fingerprint ?? null,
  };
  return deepFreeze(manifest);
}

export function applyPlayerWorldCoveragePresentation(target, snapshot) {
  if (!target || !snapshot || typeof snapshot !== 'object') return { ok: false, error: 'missing-target-or-snapshot' };
  const presentation = {
    worldCoverageVersion: snapshot.version,
    playerCellId: snapshot.coverage?.playerCell?.id ?? null,
    worldSurface: snapshot.surfaceContext?.dominantSurface ?? 'unknown',
    biome: snapshot.selectedSample?.biome ?? 'unknown',
    locomotionScale: snapshot.movement?.locomotionSpeedScale ?? 1,
    footPlantWeight: snapshot.animation?.footPlantWeight ?? 1,
    terrainLeanWeight: snapshot.animation?.terrainLeanWeight ?? 0,
    attackRecoveryScale: snapshot.combat?.attackRecoveryScale ?? 1,
    dodgeScale: snapshot.combat?.dodgeScale ?? 1,
    aimStability: snapshot.combat?.aimStability ?? 1,
    groundConfidence: snapshot.grounding?.confidence ?? 0,
    fingerprint: snapshot.fingerprint ?? null,
  };
  if (!target.userData || typeof target.userData !== 'object') target.userData = {};
  target.userData.playerWorldCoverage = deepFreeze({ ...presentation });
  return deepFreeze({ ok: true, applied: target.userData.playerWorldCoverage });
}

export function createPlayerWorldCoverageDirector({
  config = PLAYER_WORLD_COVERAGE_CONFIG,
  now = () => 0,
  maxHistory = PLAYER_WORLD_COVERAGE_CONFIG.MAX_HISTORY_ROWS,
} = {}) {
  let disposed = false;
  let revision = 0;
  let history = [];

  function ensureActive() {
    if (disposed) throw new Error('player-world-coverage-disposed');
  }

  function evaluate(input = {}) {
    ensureActive();
    revision += 1;
    const snapshot = derivePlayerWorldContext({ ...input, config, nowSeconds: input.nowSeconds ?? now() });
    history = [...history, {
      revision,
      time: snapshot.nowSeconds,
      playerCellId: snapshot.coverage.playerCell.id,
      fingerprint: snapshot.fingerprint,
      surface: snapshot.surfaceContext.dominantSurface,
      biome: snapshot.selectedSample.biome,
    }].slice(-Math.max(1, Math.floor(maxHistory)));
    return snapshot;
  }

  function currentHistory() {
    ensureActive();
    return freezeClone(history);
  }

  function digest() {
    ensureActive();
    return hashString(stableStringify({ version: PLAYER_WORLD_COVERAGE_VERSION, revision, history }));
  }

  function reset() {
    ensureActive();
    revision = 0;
    history = [];
  }

  function dispose() {
    disposed = true;
    history = [];
  }

  return Object.freeze({
    evaluate,
    currentHistory,
    digest,
    reset,
    dispose,
    get revision() { return revision; },
    get isDisposed() { return disposed; },
  });
}

export function comparePlayerWorldCoverageSnapshots(a, b) {
  const left = stableStringify({ ...a, fingerprint: undefined });
  const right = stableStringify({ ...b, fingerprint: undefined });
  return Object.freeze({
    equal: left === right,
    leftFingerprint: a?.fingerprint ?? null,
    rightFingerprint: b?.fingerprint ?? null,
    leftDigest: hashString(left),
    rightDigest: hashString(right),
  });
}

export function buildCoverageViewportSchedule({ playerPosition = {}, camera = {}, config = PLAYER_WORLD_COVERAGE_CONFIG } = {}) {
  const playerCell = worldToCell(playerPosition, config);
  const radiusCells = Math.max(1, Math.ceil(numberOr(camera.radiusMeters, config.PLAYER_CONTEXT_RADIUS_METERS) / config.CELL_SIZE_METERS));
  const cells = [];
  for (let row = Math.max(0, playerCell.row - radiusCells); row <= Math.min(config.GRID_ROWS - 1, playerCell.row + radiusCells); row += 1) {
    for (let column = Math.max(0, playerCell.column - radiusCells); column <= Math.min(config.GRID_COLUMNS - 1, playerCell.column + radiusCells); column += 1) {
      const distanceCells = Math.hypot(column - playerCell.column, row - playerCell.row);
      if (distanceCells <= radiusCells + EPSILON) {
        cells.push({
          id: `c${String(row).padStart(2, '0')}-${String(column).padStart(2, '0')}`,
          priority: round(1 - distanceCells / Math.max(1, radiusCells), 4),
          band: distanceCells <= 1 ? 'near' : distanceCells <= 2 ? 'mid' : 'far',
        });
      }
    }
  }
  cells.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return deepFreeze({ playerCellId: playerCell.id, radiusCells, cells });
}

export function buildWorldCoveragePerformanceBudget({ visibleCellCount = 0, samplesPerCell = 1, combat = false, mobile = false } = {}) {
  const visible = clamp(numberOr(visibleCellCount), 0, PLAYER_WORLD_COVERAGE_CONFIG.MAX_VISIBLE_COVERAGE_CELLS);
  const samples = clamp(numberOr(samplesPerCell, 1), 1, PLAYER_WORLD_COVERAGE_CONFIG.MAX_SAMPLES_PER_CELL);
  const budgetFactor = mobile ? 0.55 : 1;
  const coverageQueriesPerFrame = Math.max(4, Math.floor((visible * 2 + samples) * budgetFactor));
  const visualUpdatesPerFrame = Math.max(2, Math.floor((visible / 4 + (combat ? 5 : 3)) * budgetFactor));
  return deepFreeze({
    visibleCellBudget: visible,
    samplesPerCellBudget: samples,
    coverageQueriesPerFrame,
    visualUpdatesPerFrame,
    combatPriority: combat,
    mobileBudget: mobile,
  });
}

export function buildWorldCoverageInputParity({ keyboard = {}, gamepad = {}, touch = {}, mouse = {} } = {}) {
  const normalizeAxis = (value) => clamp(numberOr(value), -1, 1);
  const keyboardMove = { x: normalizeAxis(keyboard.moveX), z: normalizeAxis(keyboard.moveZ) };
  const gamepadMove = { x: normalizeAxis(gamepad.moveX), z: normalizeAxis(gamepad.moveZ) };
  const touchMove = { x: normalizeAxis(touch.moveX), z: normalizeAxis(touch.moveZ) };
  const mouseLook = { x: normalizeAxis(mouse.lookX), y: normalizeAxis(mouse.lookY) };
  const sources = [
    ['keyboard', keyboardMove],
    ['gamepad', gamepadMove],
    ['touch', touchMove],
  ];
  const active = sources.filter(([, value]) => Math.hypot(value.x, value.z) > 0.02).map(([name]) => name);
  const values = sources.filter(([, value]) => active.includes(name)).map(([, value]) => value);
  const average = values.length
    ? { x: round(values.reduce((sum, value) => sum + value.x, 0) / values.length, 3), z: round(values.reduce((sum, value) => sum + value.z, 0) / values.length, 3) }
    : { x: 0, z: 0 };
  return deepFreeze({
    move: average,
    look: mouseLook,
    activeSources: active,
    parityReady: active.length === 0 || values.every((value) => Math.hypot(value.x - average.x, value.z - average.z) <= 0.95),
  });
}

export function buildWorldCoverageDebugCard(snapshot) {
  if (!snapshot) return null;
  return deepFreeze({
    title: 'Player World Coverage',
    version: snapshot.version,
    fingerprint: snapshot.fingerprint,
    playerCell: snapshot.coverage?.playerCell?.id ?? null,
    surface: snapshot.surfaceContext?.dominantSurface ?? 'unknown',
    biome: snapshot.selectedSample?.biome ?? 'unknown',
    ground: snapshot.grounding?.grounded ? 'grounded' : 'unverified',
    coveragePercent: round((snapshot.coverage?.coverageRatio ?? 0) * 100, 1),
    combatReady: snapshot.combat?.eligible === true,
    movementScale: snapshot.movement?.locomotionSpeedScale ?? 1,
  });
}

export function getWorldCoverageContractSummary() {
  return Object.freeze({
    version: PLAYER_WORLD_COVERAGE_VERSION,
    worldExtentMeters: [PLAYER_WORLD_COVERAGE_CONFIG.WORLD_WIDTH_METERS, PLAYER_WORLD_COVERAGE_CONFIG.WORLD_DEPTH_METERS],
    lattice: [PLAYER_WORLD_COVERAGE_CONFIG.GRID_COLUMNS, PLAYER_WORLD_COVERAGE_CONFIG.GRID_ROWS],
    cellSizeMeters: PLAYER_WORLD_COVERAGE_CONFIG.CELL_SIZE_METERS,
    expectedCells: PLAYER_WORLD_COVERAGE_CONFIG.FULL_COVERAGE_EXPECTED_CELLS,
    authorities: Object.freeze({
      terrain: 'Buzul Muhafızı / caller-owned terrain + collider + water + slope APIs',
      npc: 'Şafak Kartalı / caller-owned NPC AI and navigation',
      rpg: 'Günbatımı Ustası / caller-owned RPG item and settlement semantics',
      material: 'src/3d/materials/MaterialAssignmentCore.js',
      placement: 'src/3d/world/WorldAssetPlacementPipeline.js',
      player: 'src/3d/gameplay/player.js',
    }),
    mutationPolicy: 'read-observe-project-apply-to-caller',
    threeImport: false,
    editorImport: false,
    binaryAssetsAdded: false,
  });
}
