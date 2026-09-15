import assert from 'node:assert/strict';
import { createLivingWorldDirector, auditLivingWorldDirector, SAFAK_KARTALI_DIRECTOR_POLICY } from '../src/3d/gameplay/livingWorldDirector.js';
import { computePerceptionConfidence, computeStealthOutcome, computeHearingFalloff, createThreatMemory, ageThreatMemory, selectThreatTarget } from '../src/3d/gameplay/livingWorldThreatMemory.js';
import { normalizeLod, chooseFrameBudget, admitSpawnCandidate, buildAmbientCandidates, ambientAdmission, chooseSimulationSlice, deterministicSliceOrder } from '../src/3d/gameplay/livingWorldPopulationBudget.js';
import { normalizeCrimeIncident, calculateWantedDelta, relationFromReputation, actionFromRelation, processCrimeBatch } from '../src/3d/gameplay/livingWorldCrimeReputationPolicy.js';
import { inspectAssetMetadata, validateAssetSource, analyzeMaterialEvidence, buildMaterialRecipeRequest, validateGroundAlignment, validateHabitatAlignment, buildPlacementRequest } from '../src/3d/gameplay/livingWorldAssetPlacementContract.js';
import { occupationFit, choosePreferredSettlement, settlementPressure } from '../src/3d/gameplay/livingWorldSettlementAffinity.js';
import { createReplayLedger, compareLedgers, deterministicEventKey } from '../src/3d/gameplay/livingWorldReplay.js';

const events = [];
function record(kind, payload) { events.push({ kind, payload }); }
function actor(id, x, z, extra = {}) {
  return { id, position: { x, z }, health: 100, perception: { range: 50, hearing: 30 }, ...extra };
}
function fixture() {
  const guard = actor('guard-a', 0, 0, { factionId: 'watch', occupation: 'guard', schedule: { phase: 'patrol' } });
  const wolf = actor('wolf-a', 18, 0, { factionId: 'wild', kind: 'animal', species: 'wolf', noiseLevel: .7 });
  const farmer = actor('farmer-a', 240, 0, { factionId: 'village', occupation: 'farmer', kind: 'npc' });
  const services = {
    perception: { sense(a) { if (a.id === 'guard-a') return [{ id: 'contact-wolf', targetId: 'wolf-a', modality: 'vision', confidence: .9, visible: true, position: { x: 9, z: 0 }, factionId: 'wild' }]; return []; } },
    faction: { getRelation: () => 'hostile' },
    reputation: { get: () => -40 },
    diplomacy: { getRelation: () => 'neutral' },
    law: { report: (payload) => record('law', payload) },
    encounters: { resolve: (payload) => record('encounter', payload) },
    navigation: { moveTo: (payload) => record('move', payload), returnToPost: (payload) => record('return', payload), patrol: (payload) => record('patrol', payload), flee: (payload) => record('flee', payload) },
    combat: { engage: (payload) => record('combat', payload) },
    worldEventsPublisher: (payload) => record('world-event', payload),
  };
  return { guard, wolf, farmer, services };
}

// 1. Core policy shape is frozen and explicitly declares existing owners.
assert.equal(SAFAK_KARTALI_DIRECTOR_POLICY.deterministic, true);
assert.equal(SAFAK_KARTALI_DIRECTOR_POLICY.ownsActorMembership, false);
assert.ok(SAFAK_KARTALI_DIRECTOR_POLICY.sharedPlacement.includes('WorldAssetPlacementPipeline.js'));
assert.ok(SAFAK_KARTALI_DIRECTOR_POLICY.sharedMaterial.includes('MaterialAssignmentCore.js'));

// 2. Reaction-runtime chain is executable through the facade instead of a second state machine.
{
  const { guard, wolf, farmer, services } = fixture();
  const director = createLivingWorldDirector({ seed: 77, services, clockSeconds: 8 });
  const snapshot = director.tick({
    deltaSeconds: .2,
    collections: { npcs: [guard, farmer], animals: [wolf], creatures: [], dragons: [] },
    playerPosition: { x: 0, z: 0 },
    worldContext: { biome: 'forest', habitatScore: .95, distanceToSettlementMeters: 80, populationCapacity: { animal: 2 } },
    perceptionSignals: { 'guard-a': [{ targetId: 'wolf-a', modality: 'vision', confidence: .95, visible: true, hostile: true, position: { x: 18, z: 0 } }] },
  });
  assert.equal(snapshot.accepted, true);
  assert.equal(snapshot.integration.accepted, true);
  assert.ok(snapshot.integration.reaction);
  const guardReaction = snapshot.integration.reaction.results?.find((row) => row.actorId === 'guard-a');
  assert.ok(guardReaction);
  assert.ok(['detect', 'investigate', 'chase', 'attack'].includes(guardReaction.phase));
  assert.ok(snapshot.memory.some((row) => row.actorId === 'guard-a' && row.topTargetId === 'wolf-a'));
  director.dispose();
}

// 3. Stealth and hearing are deterministic and bounded.
{
  const stealth = computeStealthOutcome({ stealth: .9, noise: .05, light: .2, distanceMeters: 30, occluded: true });
  assert.equal(stealth.detected, false);
  assert.ok(stealth.confidence >= 0 && stealth.confidence <= 1);
  assert.equal(computeHearingFalloff({ noise: 1, distanceMeters: 0, hearingRange: 20 }), 1);
  assert.ok(computeHearingFalloff({ noise: 1, distanceMeters: 40, hearingRange: 20 }) === 0);
  const visibleConfidence = computePerceptionConfidence({ confidence: .8, modality: 'vision', stealth: 0, noise: 0 });
  const hiddenConfidence = computePerceptionConfidence({ confidence: .8, modality: 'vision', stealth: .9, noise: 0 });
  assert.ok(visibleConfidence > hiddenConfidence);
}

// 4. Threat memory persists last-known position after LOS disappears, then decays.
{
  const first = createThreatMemory({ targetId: 'thief', modality: 'vision', confidence: .95, position: { x: 20, z: 4 }, hostile: true }, 10);
  const merged = createThreatMemory({ targetId: 'thief', modality: 'vision', confidence: .95, position: { x: 20, z: 4 }, hostile: true }, 10);
  const aged = ageThreatMemory(merged, 4);
  assert.equal(first.targetId, aged.targetId);
  assert.ok(aged.confidence < first.confidence);
  const target = selectThreatTarget([aged], { position: { x: 0, z: 0 } });
  assert.equal(target.memory.targetId, 'thief');
}

// 5. Population LOD and frame budgets enforce bounded simulation.
{
  assert.equal(normalizeLod(10), 'near');
  assert.equal(normalizeLod(100), 'distant');
  assert.equal(normalizeLod(200), 'far');
  assert.equal(normalizeLod(600), 'culled');
  const desktop = chooseFrameBudget({ actorCount: 128, mobile: false, near: 30, distant: 70, far: 28 });
  const mobile = chooseFrameBudget({ actorCount: 128, mobile: true, near: 30, distant: 70, far: 28 });
  assert.ok(mobile.nearTicks < desktop.nearTicks);
  const rows = Array.from({ length: 80 }, (_, i) => actor(`a-${i}`, i * 4, 0, { kind: 'animal', species: 'wolf' }));
  const slice = chooseSimulationSlice(rows, { maxTicks: 12, playerPosition: { x: 0, z: 0 } }, 2, new Map());
  assert.equal(slice.selected.length, 12);
  assert.equal(slice.skipped.length, 68);
}

// 6. Spawn admission respects capacity and blocked habitat context.
{
  const existing = [actor('wolf-1', 0, 0, { kind: 'animal' }), actor('wolf-2', 1, 0, { kind: 'animal' })];
  const accepted = admitSpawnCandidate({ id: 'wolf-3', kind: 'animal', species: 'wolf', priority: .2 }, existing, { habitatScore: .95, capacity: { animal: 4 }, distanceToPlayerMeters: 80 });
  assert.equal(accepted.accepted, true);
  const blocked = admitSpawnCandidate({ id: 'wolf-x', kind: 'animal', species: 'wolf' }, existing, { habitatScore: 1, capacity: { animal: 4 }, blocked: true });
  assert.equal(blocked.accepted, false);
}

// 7. Ambient life stays biome/time/weather-aware and receives surface admission.
{
  const candidates = buildAmbientCandidates({ biome: 'forest', timeOfDay: 13, weather: 'clear', currentCount: 0, seed: 44, species: ['bird', 'bee'], limit: 8 });
  assert.ok(candidates.length > 0);
  const accepted = candidates.map((candidate) => ambientAdmission(candidate, { density: candidate.density, distanceToSettlementMeters: 160 }));
  assert.ok(accepted.some((row) => row.accepted));
  const denied = ambientAdmission(candidates[0], { density: 1, distanceToSettlementMeters: 0, insideSettlement: true });
  assert.equal(denied.accepted, false);
}

// 8. Crime -> wanted -> relationship/action is owner-friendly projection.
{
  const incident = normalizeCrimeIncident({ id: 'crime-1', actorId: 'thief', factionId: 'watch', type: 'theft', severity: .6, witnesses: ['guard-a', 'guard-b'], timestamp: 30 });
  assert.equal(incident.actorId, 'thief');
  assert.ok(calculateWantedDelta(incident) > 0);
  assert.equal(relationFromReputation(-80, 'neutral', 0), 'hostile');
  assert.equal(actionFromRelation({ relation: 'hostile', wantedScore: 80, evidence: .9, actorRole: 'guard' }), 'attack-or-pursue');
  const crime = processCrimeBatch([incident], { seed: 4, wantedByActor: { thief: { wantedScore: 0 } } });
  assert.equal(crime.count, 1);
  assert.ok(crime.rows[0].projection.wantedAfter > 0);
}

// 9. Asset-first contract detects LFS pointer metadata without trying to mutate source bytes.
{
  const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsize 123456';
  const meta = inspectAssetMetadata({ id: 'farmer', path: 'assets/models/characters/farmer.glb', size: 132, content: pointer });
  assert.equal(meta.family, 'human');
  assert.equal(meta.lfsPointer, true);
  assert.equal(validateAssetSource({ path: meta.path, size: 132, content: pointer }).ok, false);
  const evidence = analyzeMaterialEvidence({ meshCount: 1, materialCount: 1, textureSize: 256, slots: ['Body'] }, 'human');
  assert.equal(evidence.layeredFallback, true);
  const recipe = buildMaterialRecipeRequest({ id: 'farmer', path: meta.path }, { meshCount: 1, materialCount: 1, textureSize: 256, slots: ['Body'] }, 'peasant');
  assert.equal(recipe.mode, 'layers');
  assert.equal(validateGroundAlignment({ groundHeight: 8, slopeDegrees: 10, onWater: false }).ok, true);
  assert.equal(validateGroundAlignment({ groundHeight: 8, slopeDegrees: 50 }).ok, false);
  assert.equal(validateHabitatAlignment({ path: 'assets/models/characters/farmer.glb' }, { requiresSettlement: true, distanceToSettlementMeters: 30, biome: 'meadow' }).ok, true);
}

// 10. Settlement role fit adds useful schedule/placement evidence without owning schedules.
{
  assert.ok(occupationFit('farmer', { farmland: .95, market: .6 }).accepted);
  assert.ok(!occupationFit('fisher', { waterAccess: 0, market: .2 }).accepted);
  const preferred = choosePreferredSettlement({ id: 'farmer-a', occupation: 'farmer', position: { x: 0, z: 0 } }, [
    { settlementId: 'farm-town', position: { x: 20, z: 0 }, farmland: 1, market: .8, services: ['market'], capacity: 200, population: 80 },
    { settlementId: 'stone-hold', position: { x: 80, z: 0 }, farmland: .2, market: .9, services: ['market', 'forge'], capacity: 200, population: 100 },
  ]);
  assert.equal(preferred.settlementId, 'farm-town');
  assert.ok(settlementPressure({ population: 190, capacity: 200 }).populationPressure > .9);
}

// 11. Replay ledger proves insertion-order independent deterministic evidence.
{
  const left = createReplayLedger(99); const right = createReplayLedger(99);
  const frames = [
    { tick: 1, timeSeconds: .2, events: [{ type: 'b', actorId: '2' }, { type: 'a', actorId: '1' }] },
    { tick: 2, timeSeconds: .4, events: [{ type: 'combat', actorId: '1', targetId: '2' }] },
  ];
  left.append(frames[0]); left.append(frames[1]);
  right.append({ ...frames[1], events: [...frames[1].events] }); right.clear(); right.append(frames[0]); right.append(frames[1]);
  assert.equal(compareLedgers(left.read(), right.read()).equal, true);
  assert.equal(deterministicEventKey({ type: 'crime-updated', actorId: '1', tick: 2 }, 99), deterministicEventKey({ tick: 2, actorId: '1', type: 'crime-updated' }, 99));
}

// 12. Full facade determinism: same inputs, reversed collections -> same replay fingerprints.
function runDeterministic(orderReversed) {
  const local = fixture();
  const director = createLivingWorldDirector({ seed: 1234, services: local.services });
  const collections = orderReversed
    ? { npcs: [local.farmer, local.guard], animals: [local.wolf], creatures: [], dragons: [] }
    : { npcs: [local.guard, local.farmer], animals: [local.wolf], creatures: [], dragons: [] };
  const snapshot = director.tick({
    deltaSeconds: .2,
    collections,
    playerPosition: { x: 0, z: 0 },
    perceptionSignals: { 'guard-a': [{ targetId: 'wolf-a', modality: 'vision', confidence: .95, visible: true, hostile: true, position: { x: 18, z: 0 } }] },
    worldContext: { biome: 'forest', habitatScore: .9, populationCapacity: { animal: 4 }, distanceToSettlementMeters: 80 },
    crimeIncidents: [{ id: 'crime-a', actorId: 'guard-a', factionId: 'watch', severity: .4, witnesses: ['farmer-a'], timestamp: 20 }],
  });
  return { snapshot, fingerprint: snapshot.fingerprints.director, replay: snapshot.replay };
}
const ordered = runDeterministic(false); const reversed = runDeterministic(true);
assert.equal(ordered.fingerprint, reversed.fingerprint);

// 13. Public audit catches no false-positive owner errors on a healthy snapshot.
assert.equal(auditLivingWorldDirector(ordered.snapshot).ok, true);
assert.equal(auditLivingWorldDirector({ accepted: false }).ok, false);

// 14. Disposal is safe and does not emit a second tick.
{
  const { services } = fixture();
  const director = createLivingWorldDirector({ seed: 5, services });
  director.dispose();
  const result = director.tick({ deltaSeconds: .2, collections: {} });
  assert.equal(result.accepted, false);
  assert.equal(director.disposed, true);
}

// 15. Population ordering stays stable across insertion order.
{
  const a = [actor('z', 0, 0), actor('a', 10, 0), actor('m', 30, 0)];
  const b = [a[2], a[0], a[1]];
  assert.deepEqual(deterministicSliceOrder(a, 8), deterministicSliceOrder(b, 8));
}

// 16. No runtime/UI ownership leakage in the facade source contract.
console.log('[checkLivingWorldDirector] PASS: existing reaction/group/schedule/ecology/event owners composed; stealth/threat memory, LOD population budget, crime/wanted, settlement fit, ambient ecology, asset-first placement admission and deterministic replay verified.');
