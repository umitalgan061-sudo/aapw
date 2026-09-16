import fs from 'node:fs';
import path from 'node:path';
import { createLivingWorldDirector, auditDirectorPolicy, directorDigest, LIVING_WORLD_DIRECTOR_POLICY } from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';

const OUT = path.resolve('artifacts/safak-kartali-living-world-director-matrix.jsonl');
const BIOMES = ['forest','meadow','mountain','snow','steppe','marsh','coast','desert','north','tundra','taiga','wetland','highland','valley','ruins','village'];
const SPECIES = ['wolf','bear','deer','bison','horse','boar','fox','sheep','goat','cat','bird','bee'];
const CLOCKS = [0, 900, 1800, 2700, 3600, 5400, 7200, 9000, 10800, 12600, 14400, 16200, 18000, 21600, 64800, 86399];
const THREATS = [0,.0625,.125,.1875,.25,.3125,.375,.4375,.5,.5625,.625,.6875,.75,.8125,.875,.9375];
const WILDLIFE = [0,.0625,.125,.1875,.25,.3125,.375,.4375,.5,.5625,.625,.6875,.75,.8125,.875,.9375];
const DELTAS = [.001,.01,.02,.04,.08,.1,.12,.16,.2,.24];
const MAX_CASES = 4096;

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));

function controller(id, x, z) {
  return {
    id,
    state: 'matrix-probe',
    object3D: { name: id, position: { x, y: 0, z }, userData: {} },
    update(deltaSeconds) {
      if (deltaSeconds > LIVING_WORLD_DIRECTOR_POLICY.maxDeltaSeconds) throw new Error('delta-over-cap');
    },
  };
}

function buildContext(index) {
  const biome = BIOMES[index % BIOMES.length];
  const species = SPECIES[Math.floor(index / BIOMES.length) % SPECIES.length];
  const clock = CLOCKS[Math.floor(index / (BIOMES.length * SPECIES.length)) % CLOCKS.length];
  const threat = THREATS[Math.floor(index / 7) % THREATS.length];
  const wildlife = WILDLIFE[Math.floor(index / 11) % WILDLIFE.length];
  const delta = DELTAS[index % DELTAS.length];
  return freeze({
    id: `lw-${String(index + 1).padStart(4, '0')}`,
    biome,
    species,
    clock,
    threat,
    wildlife,
    delta,
    temperatureC: -20 + ((index * 7) % 61),
    moisture: ((index * 13) % 101) / 100,
    slopeDegrees: (index * 11) % 61,
    distanceToSettlementMeters: (index * 17) % 601,
    distanceToRoadMeters: (index * 19) % 81,
    waterDepthMeters: ((index * 23) % 81) / 10,
    centerX: ((index * 29) % 101) - 50,
    centerZ: ((index * 31) % 101) - 50,
  });
}

function probeCase(spec) {
  const actor = controller(`${spec.id}-actor`, spec.centerX, spec.centerZ);
  const director = createLivingWorldDirector({ seed: spec.id, clockSeconds: spec.clock });
  const input = {
    deltaSeconds: spec.delta,
    playerPosition: { x: 0, z: 0 },
    collections: { npcs: [actor] },
    faunaRequests: [{
      species: spec.species,
      centerX: spec.centerX,
      centerZ: spec.centerZ,
      radiusMeters: 12 + (spec.id.charCodeAt(3) % 13),
      seed: spec.id,
      context: {
        biome: spec.biome,
        temperatureC: spec.temperatureC,
        moisture: spec.moisture,
        slopeDegrees: spec.slopeDegrees,
        distanceToSettlementMeters: spec.distanceToSettlementMeters,
        distanceToRoadMeters: spec.distanceToRoadMeters,
        waterDepthMeters: spec.waterDepthMeters,
      },
    }],
    eventContext: {
      worldSeed: spec.id,
      playerX: 0,
      playerZ: 0,
      biome: spec.biome,
      threatLevel: clamp(spec.threat),
      wildlifeActivity: clamp(spec.wildlife),
      roadActivity: clamp(1 - spec.wildlife / 2),
      populationDensity: clamp(spec.threat / 2),
      nearestSettlementDistanceMeters: spec.distanceToSettlementMeters,
      nearestRoadDistanceMeters: spec.distanceToRoadMeters,
      clockSeconds: spec.clock,
    },
    eventTypes: ['guard_alert', 'wildlife_surge'],
  };
  const first = director.tick(input);
  const audit = auditDirectorPolicy(first);
  const digest = directorDigest(first);
  director.reset();
  const replay = director.tick(input);
  const replayDigest = directorDigest(replay);
  director.dispose();
  const disposed = director.tick({ deltaSeconds: spec.delta }).accepted === false;
  if (!first.accepted || !audit.ok || digest !== replayDigest || !disposed) throw new Error(`matrix-failure:${spec.id}`);
  return {
    id: spec.id,
    biome: spec.biome,
    species: spec.species,
    clock: spec.clock,
    delta: spec.delta,
    threat: spec.threat,
    wildlife: spec.wildlife,
    digest,
    actorsUpdated: first.actorsUpdated,
    faunaPlans: first.fauna.length,
    eventReceipts: first.events.receipts.length,
    habitatSpecies: first.habitatSpecies.length,
    policy: first.policyId,
  };
}

const rows = [];
for (let index = 0; index < MAX_CASES; index += 1) rows.push(probeCase(buildContext(index)));
const uniqueDigests = new Set(rows.map((row) => row.digest));
const header = {
  schema: 'safak-kartali-living-world-director-matrix-v1',
  count: rows.length,
  policy: LIVING_WORLD_DIRECTOR_POLICY.id,
  uniqueDigests: uniqueDigests.size,
  generatedBy: 'scripts/generateSafakKartaliLivingWorldDirectorMatrix.mjs',
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(header)}\n${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
console.log(JSON.stringify({ ok: true, output: OUT, cases: rows.length, uniqueDigests: uniqueDigests.size }));
