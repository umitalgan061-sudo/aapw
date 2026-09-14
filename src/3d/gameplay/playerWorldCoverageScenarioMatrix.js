/**
 * Named world-coverage gameplay scenarios used by player/combat acceptance.
 *
 * Scenarios are data and composition helpers only. They consume the canonical world observation
 * contract; they do not create terrain, spawn actors, resolve combat damage or place assets.
 * The matrix makes representative full-world slices reproducible: settlement edge, road, coast,
 * wetland, forest, mountain, alpine snow, steep scree, open steppe and deep-water exclusion.
 *
 * @module gameplay/playerWorldCoverageScenarioMatrix
 */

import { derivePlayerWorldContext, validatePlayerWorldContext } from './playerWorldCoverageDirector.js';

const SCENARIO_VERSION = 'kwc-scenarios-1';
const SCENARIOS = Object.freeze([
  { id: 'settlement-gate', biome: 'settlement', surface: 'settlement', slopeDegrees: 2, elevationMeters: 90, moisture: 0.32, snow: 0, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: 3, settlementDistanceMeters: 4, coastlineDistanceMeters: 120, cliffDistanceMeters: 90, speedMps: 1.8, stance: 'neutral', lockOn: false },
  { id: 'forest-road', biome: 'forest', surface: 'road', slopeDegrees: 5, elevationMeters: 210, moisture: 0.42, snow: 0, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: 1, settlementDistanceMeters: 80, coastlineDistanceMeters: 140, cliffDistanceMeters: 100, speedMps: 4.8, stance: 'neutral', lockOn: false },
  { id: 'coast-wet-edge', biome: 'coast', surface: 'wet-edge', slopeDegrees: 4, elevationMeters: 12, moisture: 0.88, snow: 0, waterCoverage: 0.48, waterDepthMeters: 0.12, roadDistanceMeters: 22, settlementDistanceMeters: 50, coastlineDistanceMeters: 4, cliffDistanceMeters: 120, speedMps: 2.4, stance: 'guard', lockOn: false },
  { id: 'wetland-crossing', biome: 'wetland', surface: 'mud', slopeDegrees: 8, elevationMeters: 35, moisture: 0.93, snow: 0, waterCoverage: 0.55, waterDepthMeters: 0.2, roadDistanceMeters: 45, settlementDistanceMeters: 120, coastlineDistanceMeters: 28, cliffDistanceMeters: 180, speedMps: 2.2, stance: 'neutral', lockOn: false },
  { id: 'mountain-climb', biome: 'mountain', surface: 'rock', slopeDegrees: 38, elevationMeters: 720, moisture: 0.24, snow: 0.1, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: null, settlementDistanceMeters: null, coastlineDistanceMeters: 260, cliffDistanceMeters: 9, speedMps: 2.8, stance: 'attack', lockOn: true },
  { id: 'alpine-snow', biome: 'alpine', surface: 'snow', slopeDegrees: 31, elevationMeters: 980, moisture: 0.2, snow: 0.86, waterCoverage: 0.02, waterDepthMeters: 0, roadDistanceMeters: null, settlementDistanceMeters: null, coastlineDistanceMeters: 390, cliffDistanceMeters: 64, speedMps: 3.6, stance: 'guard', lockOn: true },
  { id: 'steep-scree', biome: 'mountain', surface: 'scree', slopeDegrees: 47, elevationMeters: 1280, moisture: 0.12, snow: 0.36, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: null, settlementDistanceMeters: null, coastlineDistanceMeters: 450, cliffDistanceMeters: 4, speedMps: 1.9, stance: 'neutral', lockOn: true },
  { id: 'steppe-run', biome: 'steppe', surface: 'grass', slopeDegrees: 7, elevationMeters: 310, moisture: 0.18, snow: 0, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: 18, settlementDistanceMeters: 160, coastlineDistanceMeters: 210, cliffDistanceMeters: 170, speedMps: 6.6, stance: 'neutral', lockOn: false },
  { id: 'deep-water', biome: 'coast', surface: 'water', slopeDegrees: 1, elevationMeters: 0, moisture: 1, snow: 0, waterCoverage: 1, waterDepthMeters: 4, roadDistanceMeters: 48, settlementDistanceMeters: 180, coastlineDistanceMeters: 2, cliffDistanceMeters: 160, speedMps: 0, stance: 'neutral', lockOn: false },
  { id: 'snowy-road', biome: 'tundra', surface: 'road', slopeDegrees: 9, elevationMeters: 610, moisture: 0.55, snow: 0.7, waterCoverage: 0, waterDepthMeters: 0, roadDistanceMeters: 2, settlementDistanceMeters: 90, coastlineDistanceMeters: 330, cliffDistanceMeters: 170, speedMps: 5.2, stance: 'ranged', lockOn: true },
]);

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function scenarioSample(scenario, index) {
  return {
    id: `${scenario.id}-sample-${index}`,
    position: { x: index * 240, y: scenario.elevationMeters, z: index * 75 },
    groundY: scenario.elevationMeters,
    colliderY: scenario.elevationMeters + (scenario.id === 'mountain-climb' ? 0.02 : 0),
    canonicalY: scenario.elevationMeters,
    surface: scenario.surface,
    biome: scenario.biome,
    slopeDegrees: scenario.slopeDegrees,
    elevationMeters: scenario.elevationMeters,
    moisture: scenario.moisture,
    snow: scenario.snow,
    waterDepthMeters: scenario.waterDepthMeters,
    waterCoverage: scenario.waterCoverage,
    roadDistanceMeters: scenario.roadDistanceMeters,
    settlementDistanceMeters: scenario.settlementDistanceMeters,
    coastlineDistanceMeters: scenario.coastlineDistanceMeters,
    cliffDistanceMeters: scenario.cliffDistanceMeters,
    assetReady: true,
    visible: true,
    confidence: 1,
    observed: true,
  };
}

export function listPlayerWorldCoverageScenarios() {
  return SCENARIOS.map((scenario) => Object.freeze({ ...scenario }));
}

export function getPlayerWorldCoverageScenario(id) {
  const found = SCENARIOS.find((scenario) => scenario.id === id);
  return found ? Object.freeze({ ...found }) : null;
}

export function createPlayerWorldCoverageScenarioInput(id, overrides = {}) {
  const scenario = getPlayerWorldCoverageScenario(id);
  if (!scenario) throw new Error(`unknown-world-coverage-scenario:${id}`);
  const merged = { ...scenario, ...overrides };
  const samples = [scenarioSample(merged, 0), scenarioSample(merged, 1)];
  return deepFreeze({
    player: {
      position: samples[0].position,
      isGrounded: merged.id !== 'deep-water',
      speedMps: numberOr(merged.speedMps),
      locomotion: merged.speedMps > 5.5 ? 'sprint' : merged.speedMps > 0.05 ? 'run' : 'idle',
      lockOn: merged.lockOn === true,
      rangedReady: merged.stance === 'ranged',
      stance: merged.stance,
    },
    movement: {
      speedMps: numberOr(merged.speedMps),
      locomotion: merged.speedMps > 5.5 ? 'sprint' : merged.speedMps > 0.05 ? 'run' : 'idle',
      inAttack: merged.stance === 'attack',
      attackWeight: merged.stance === 'attack' ? 0.85 : 0,
      inGuard: merged.stance === 'guard',
    },
    combat: {
      stance: merged.stance,
      isGrounded: merged.id !== 'deep-water',
      lockOn: merged.lockOn === true,
      rangedReady: merged.stance === 'ranged',
    },
    equipment: {
      weaponReachMeters: merged.stance === 'ranged' ? 2.8 : 1.8,
      encumbranceRatio: merged.stance === 'guard' ? 0.46 : 0.2,
      metalWeightRatio: merged.stance === 'guard' ? 0.72 : 0.34,
      leatherWeightRatio: merged.stance === 'ranged' ? 0.52 : 0.2,
      socketReady: true,
      assetReady: true,
      surfaceRoles: ['skin', 'hair', 'cloth', 'leather', 'metal', 'boot', 'weapon'],
    },
    interaction: { disabled: merged.id === 'deep-water' },
    samples,
  });
}

export function evaluatePlayerWorldCoverageScenario(id, options = {}) {
  const input = createPlayerWorldCoverageScenarioInput(id, options.overrides);
  const snapshot = derivePlayerWorldContext({ ...input, nowSeconds: numberOr(options.nowSeconds, 0) });
  const validation = validatePlayerWorldContext(snapshot, {
    requireGrounded: options.requireGrounded !== false,
    requireFullWorldCoverage: options.requireFullWorldCoverage === true,
    maxMissingAssets: options.maxMissingAssets ?? 0,
  });
  return deepFreeze({
    version: SCENARIO_VERSION,
    id,
    snapshot,
    validation,
    acceptance: validation.ok,
  });
}

export function evaluateAllPlayerWorldCoverageScenarios(options = {}) {
  return deepFreeze(SCENARIOS.map((scenario) => evaluatePlayerWorldCoverageScenario(scenario.id, options)));
}

export function buildScenarioCoverageSummary(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const accepted = rows.filter((row) => row.acceptance).length;
  const blocked = rows.filter((row) => row.snapshot?.combat?.eligible === false).length;
  return deepFreeze({
    version: SCENARIO_VERSION,
    scenarioCount: rows.length,
    acceptedCount: accepted,
    blockedCombatCount: blocked,
    acceptanceRatio: rows.length ? accepted / rows.length : 1,
    failures: rows.filter((row) => !row.acceptance).map((row) => ({ id: row.id, errors: row.validation.errors })),
  });
}

export function getScenarioCoverageVersion() {
  return SCENARIO_VERSION;
}
