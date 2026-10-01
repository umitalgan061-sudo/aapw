import assert from 'node:assert/strict';
import {
  LIVING_WORLD_FAUNA_ECOLOGY_POLICY,
  FAUNA_ECOLOGY_SCENARIOS,
  applyFaunaEcologyTick,
  auditFaunaAssetDirective,
  buildFaunaPlacementManifest,
  classifyFaunaLod,
  compareFaunaEcologyRuns,
  createFaunaScenario,
  ecologyContractManifest,
  evaluateFaunaHabitat,
  getFaunaRuntimeBudgets,
  getFaunaSpeciesProfile,
  planFaunaDespawnSweep,
  planFaunaEcologyTick,
  planFaunaGroupCommand,
  planPopulationRefresh,
  runFaunaEcologyReplay,
  summarizeFaunaEcology,
  validateFaunaEcologyPlan,
} from '../src/3d/gameplay/livingWorldFaunaEcologyRuntime.js';

const assertFrozen = (value, label) => assert.equal(Object.isFrozen(value), true, `${label} must be frozen`);
const finite = (value) => Number.isFinite(Number(value));

function habitat(overrides = {}) {
  return {
    id: 'forest-01', biome: 'forest', score: 0.9, occupancy: 0.1, food: 0.9, cover: 0.8, danger: 0.2, travel: 0.85,
    waterDepth: 0.05, slope: 0.18, settlementDistance: 600, roadDistance: 30, position: { x: 100, y: 12, z: 200 },
    navReachable: true, groundValid: true, waterValid: true, canonicalBiome: 'forest', ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    id: 'wolf-01', species: 'wolf', lod: 'near', position: { x: 100, y: 12, z: 200 }, ageSeconds: 12, spawnTime: 1,
    health: 1, groupId: 'pack-01', habitatId: 'forest-01', protected: false, distanceMeters: 80, lastThreatAt: 40, active: true, ...overrides,
  };
}

function threat(overrides = {}) {
  return {
    id: 'player-01', kind: 'player', distanceMeters: 16, ageSeconds: 0, hostile: true, visible: true, heard: false, confidence: 1,
    position: { x: 118, y: 12, z: 206 }, ...overrides,
  };
}

assertFrozen(LIVING_WORLD_FAUNA_ECOLOGY_POLICY, 'policy');
assert.equal(LIVING_WORLD_FAUNA_ECOLOGY_POLICY.deterministic, true);
assert.ok(LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands >= 32);
assert.ok(LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows >= 64);

const contract = ecologyContractManifest();
assertFrozen(contract, 'contract');
assert.equal(contract.deterministic, true);
assert.equal(contract.runtimeOnly, true);
assert.equal(contract.owners.materials, 'MaterialAssignmentCore');
assert.equal(contract.owners.placement, 'WorldAssetPlacementPipeline');
assert.equal(contract.owners.actorRegistry, 'existing');
assert.equal(contract.owners.navigation, 'existing');
assert.equal(contract.owners.worldEventSystem, 'existing');
assert.ok(contract.forbidden.includes('new-actor-registry'));
assert.ok(contract.forbidden.includes('new-spawn-framework'));
assert.ok(contract.forbidden.includes('EditorMaterialStudio-runtime-import'));
assertFrozen(contract.owners, 'contract owners');
assertFrozen(contract.budgets, 'contract budgets');

const budgets = getFaunaRuntimeBudgets();
assertFrozen(budgets, 'budgets');
assert.equal(budgets.maxCommands, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands);
assert.equal(budgets.ecologyTickSeconds, LIVING_WORLD_FAUNA_ECOLOGY_POLICY.ecologyTickSeconds);

const deer = getFaunaSpeciesProfile('deer');
assert.equal(deer.species, 'deer');
assert.equal(deer.diet, 'grazer');
assert.ok(deer.habitat.includes('forest'));
assert.equal(deer.asset.family, 'animals');
assert.equal(deer.asset.materialContract, 'MaterialAssignmentCore');
assert.equal(deer.asset.placementContract, 'WorldAssetPlacementPipeline');
assert.equal(deer.asset.editorRuntimeForbidden, true);
assert.ok(deer.asset.requiredOrder.includes('hydrate-or-load'));
assert.ok(deer.asset.requiredOrder.includes('analyze-mesh-material-slots'));
assert.ok(deer.asset.requiredOrder.includes('validateMaterialAssignment'));
assert.ok(deer.asset.requiredOrder.includes('create-placement-manifest'));

const wolf = getFaunaSpeciesProfile('wolf');
assert.equal(wolf.diet, 'predator');
assert.ok(wolf.active.includes('night'));
assert.ok(wolf.habitat.includes('taiga'));

const dragon = getFaunaSpeciesProfile('dragon');
assert.equal(dragon.asset.family, 'dragons');
assert.equal(dragon.groupMin, 1);
assert.equal(dragon.groupMax, 1);

assert.deepEqual(classifyFaunaLod(20), { level: 'near', intervalSeconds: 0, mode: 'full', scoreWeight: 1 });
assert.deepEqual(classifyFaunaLod(180, 'distant'), { level: 'distant', intervalSeconds: 0.75, mode: 'reduced', scoreWeight: 0.65 });
assert.equal(classifyFaunaLod(1400).level, 'far');
assert.equal(classifyFaunaLod(5000).level, 'culled');
assert.equal(classifyFaunaLod(5000, 'near').level, 'near');
assert.equal(classifyFaunaLod(5000, 'bogus').level, 'culled');

const habitatEval = evaluateFaunaHabitat(habitat(), 'deer', { hour: 12, day: 3, season: 'summer', weather: 'clear' }, { species: 'deer', habitatId: 'forest-01', count: 2, capacity: 8 });
assertFrozen(habitatEval, 'habitat eval');
assert.equal(habitatEval.eligible, true);
assert.ok(habitatEval.score > 0.4);
assert.ok(habitatEval.capacity >= 2);
assert.ok(habitatEval.schedule.active === true);
assert.equal(habitatEval.schedule.rest, false);
assert.ok(finite(habitatEval.schedule.focus));

const blockedHabitat = evaluateFaunaHabitat(habitat({ canonicalBiome: 'ocean', biome: 'ocean', score: 1, waterDepth: 2 }), 'deer', { hour: 12 });
assert.equal(blockedHabitat.eligible, false);
const steepHabitat = evaluateFaunaHabitat(habitat({ slope: 0.9 }), 'horse', { hour: 12 });
assert.equal(steepHabitat.eligible, false);
const badNavHabitat = evaluateFaunaHabitat(habitat({ navReachable: false }), 'deer', { hour: 12 });
assert.equal(badNavHabitat.eligible, false);
const badGroundHabitat = evaluateFaunaHabitat(habitat({ groundValid: false }), 'deer', { hour: 12 });
assert.equal(badGroundHabitat.eligible, false);
const badWaterHabitat = evaluateFaunaHabitat(habitat({ waterValid: false }), 'deer', { hour: 12 });
assert.equal(badWaterHabitat.eligible, false);

const dayHorse = evaluateFaunaHabitat(habitat({ biome: 'meadow' }), 'horse', { hour: 13, season: 'summer', weather: 'clear' });
assert.equal(dayHorse.schedule.active, true);
assert.equal(dayHorse.schedule.rest, false);
const nightHorse = evaluateFaunaHabitat(habitat({ biome: 'meadow' }), 'horse', { hour: 1, season: 'summer', weather: 'clear' });
assert.equal(nightHorse.schedule.active, false);
assert.equal(nightHorse.schedule.rest, true);
const dawnDeer = evaluateFaunaHabitat(habitat(), 'deer', { hour: 6, season: 'spring', weather: 'clear' });
assert.equal(dawnDeer.schedule.phase, 'dawn');
assert.ok(dawnDeer.schedule.focus > 0);
const stormWolf = evaluateFaunaHabitat(habitat({ biome: 'taiga' }), 'wolf', { hour: 23, season: 'winter', weather: 'storm' });
assert.equal(stormWolf.schedule.phase, 'night');
assert.ok(stormWolf.score >= 0 && stormWolf.score <= 1);

const basePlanInput = {
  worldSeed: 'aapw-fauna-ecology', now: 3600 * 12, clock: { hour: 12, day: 3, season: 'summer', weather: 'clear' },
  habitats: [habitat()], candidates: [candidate()], threats: [threat()],
  population: [{ species: 'wolf', habitatId: 'forest-01', count: 2, juveniles: 0, adults: 2, lastSpawnAt: -999 }],
};

const plan = planFaunaEcologyTick(basePlanInput);
assertFrozen(plan, 'ecology plan');
assert.equal(plan.kind, 'living-world-fauna-ecology-tick');
assert.equal(plan.clock.phase, 'day');
assert.ok(Array.isArray(plan.spawn) && Array.isArray(plan.updates) && Array.isArray(plan.commands) && Array.isArray(plan.events));
assert.ok(Array.isArray(plan.groups) && Array.isArray(plan.schedule) && Array.isArray(plan.despawn));
assert.ok(plan.commands.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands);
assert.equal(plan.governance.materialOwner, 'MaterialAssignmentCore');
assert.equal(plan.governance.placementOwner, 'WorldAssetPlacementPipeline');
assert.equal(plan.governance.editorRuntimeImport, false);
assert.equal(plan.navigation.mutation, false);
assert.equal(plan.settlement.mutation, false);
assert.equal(plan.fingerprint.length, 8);

const validation = validateFaunaEcologyPlan(plan);
assert.equal(validation.ok, true, validation.errors.join(','));
assertFrozen(validation, 'plan validation');
assert.deepEqual(validation.errors, []);
const summary = summarizeFaunaEcology(plan);
assertFrozen(summary, 'summary');
assert.equal(summary.fingerprint, plan.fingerprint);
assert.equal(summary.actorUpdates, plan.updates.length);
assert.equal(summary.spawnGroups, plan.spawn.length);
assert.equal(summary.commandCount, plan.commands.length);

for (const directive of plan.spawn) {
  const assetAudit = auditFaunaAssetDirective(directive);
  assert.equal(assetAudit.ok, true, assetAudit.errors.join(','));
  assert.equal(directive.materialContract, 'MaterialAssignmentCore');
  assert.equal(directive.placementContract, 'WorldAssetPlacementPipeline');
  assert.equal(directive.placement.groundRequired, true);
  assert.equal(directive.placement.navRequired, true);
  assert.equal(directive.placement.habitatRequired, true);
  assert.equal(directive.placement.materialManifestRequired, true);
  assert.equal(directive.placement.asset.editorRuntimeForbidden, true);
  assert.ok(Array.isArray(directive.sourceAssetFamilies));
}
for (const update of plan.updates) {
  assert.equal(update.materialContract, 'MaterialAssignmentCore');
  assert.equal(update.placementContract, 'WorldAssetPlacementPipeline');
  assert.ok(['near', 'distant', 'far', 'culled'].includes(update.lod));
  assert.ok(['roam', 'flee', 'stalk'].includes(update.state));
  assert.ok(finite(update.pressure));
  assertFrozen(update, 'actor update');
}
assert.ok(plan.updates.some((item) => item.state === 'flee'));

const noThreatPlan = planFaunaEcologyTick({ ...basePlanInput, threats: [] });
assert.ok(noThreatPlan.updates.every((item) => item.state === 'roam' || item.state === 'stalk'));
assert.equal(noThreatPlan.updates.some((item) => item.state === 'flee'), false);
const staleThreatPlan = planFaunaEcologyTick({ ...basePlanInput, threats: [threat({ ageSeconds: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.activeThreatSeconds + 10 })] });
assert.equal(staleThreatPlan.updates.some((item) => item.state === 'flee'), false);
const audibleThreatPlan = planFaunaEcologyTick({ ...basePlanInput, threats: [threat({ visible: false, heard: true, distanceMeters: 25 })] });
assert.ok(audibleThreatPlan.updates.length >= 1);
assert.ok(audibleThreatPlan.updates[0].state === 'flee' || audibleThreatPlan.updates[0].state === 'roam');
const farThreatPlan = planFaunaEcologyTick({ ...basePlanInput, threats: [threat({ distanceMeters: 250, visible: true })] });
assert.equal(farThreatPlan.updates[0].state, 'roam');
const invisibleThreatPlan = planFaunaEcologyTick({ ...basePlanInput, threats: [threat({ visible: false, heard: false, distanceMeters: 5 })] });
assert.equal(invisibleThreatPlan.updates[0].state, 'roam');
const lowConfidenceThreatPlan = planFaunaEcologyTick({ ...basePlanInput, threats: [threat({ confidence: 0.1, distanceMeters: 10 })] });
assert.ok(['flee', 'roam'].includes(lowConfidenceThreatPlan.updates[0].state));

const group = planFaunaGroupCommand({
  groupId: 'pack-01', members: [candidate({ id: 'wolf-02' }), candidate({ id: 'wolf-01' }), candidate({ id: 'wolf-03' })], state: 'flee', target: { x: 55, z: 144 },
});
assertFrozen(group, 'group command');
assert.equal(group.id, 'pack-01');
assert.equal(group.state, 'flee');
assert.equal(group.members.length, 3);
assert.equal(group.members[0].role, 'leader');
assert.equal(group.command.type, 'flee');
assert.equal(group.command.payload.groupId, 'pack-01');
assert.equal(group.command.payload.target.x, 55);

const placementManifest = buildFaunaPlacementManifest({ species: 'horse', habitat: habitat({ biome: 'meadow', position: { x: 55, z: 88 } }) });
assertFrozen(placementManifest, 'placement manifest');
assert.equal(placementManifest.asset.family, 'animals');
assert.equal(placementManifest.asset.materialContract, 'MaterialAssignmentCore');
assert.equal(placementManifest.asset.placementContract, 'WorldAssetPlacementPipeline');
assert.equal(placementManifest.ground, true);
assert.equal(placementManifest.navigation, true);
assert.equal(placementManifest.habitat, 'meadow');
assert.equal(placementManifest.position.x, 55);
assert.equal(placementManifest.position.z, 88);
assert.equal(placementManifest.validation.placeholderRejected, true);
assert.equal(placementManifest.validation.missingAssetFailure, true);

const despawnDead = planFaunaDespawnSweep({ now: 500, candidates: [candidate({ id: 'dead-wolf', health: 0, distanceMeters: 50 })] });
assert.equal(despawnDead.despawn.length, 1);
assert.equal(despawnDead.despawn[0].reason, 'dead-owner-requested');
const despawnFar = planFaunaDespawnSweep({ now: 500, candidates: [candidate({ id: 'far-wolf', health: 1, distanceMeters: 5000, spawnTime: 1 })] });
assert.equal(despawnFar.despawn.length, 1);
assert.equal(despawnFar.despawn[0].reason, 'outside-world-interest');
const protectedFar = planFaunaDespawnSweep({ now: 500, candidates: [candidate({ id: 'protected-wolf', protected: true, distanceMeters: 5000, spawnTime: 1 })] });
assert.equal(protectedFar.despawn.length, 0);
const activeButFresh = planFaunaDespawnSweep({ now: 20, candidates: [candidate({ id: 'fresh-wolf', health: 1, distanceMeters: 5000, spawnTime: 10 })] });
assert.equal(activeButFresh.despawn.length, 0);
const notActive = planFaunaDespawnSweep({ now: 500, candidates: [candidate({ id: 'inactive-wolf', active: false, distanceMeters: 5000, spawnTime: 1 })] });
assert.equal(notActive.despawn.length, 0);

const malformedPlan = planFaunaEcologyTick({
  worldSeed: null, now: Infinity, clock: { hour: NaN, day: Infinity, season: null, weather: null },
  habitats: [habitat({ id: null, position: { x: NaN, z: Infinity } }), habitat({ id: 'bad-score', score: NaN, occupancy: Infinity, position: null })],
  candidates: [candidate({ id: null, position: { x: NaN, z: NaN }, distanceMeters: NaN })],
  threats: [threat({ id: null, distanceMeters: Infinity, ageSeconds: NaN, position: { x: NaN, z: NaN } })],
  population: [{ species: null, habitatId: null, capacity: NaN, count: Infinity, juveniles: NaN }],
});
assertFrozen(malformedPlan, 'malformed plan');
assert.equal(Number.isFinite(malformedPlan.now), true);
assert.equal(Number.isFinite(malformedPlan.tick), true);
assert.equal(validateFaunaEcologyPlan(malformedPlan).ok, true);

const replayTape = [0, 5, 10, 15, 20].map((now) => ({ ...basePlanInput, now }));
const replayA = runFaunaEcologyReplay(replayTape);
const replayB = runFaunaEcologyReplay(replayTape);
assertFrozen(replayA, 'replay A');
assertFrozen(replayB, 'replay B');
assert.equal(replayA.count, replayTape.length);
assert.deepEqual(replayA, replayB);
assert.equal(replayA.digest, replayB.digest);
assert.equal(compareFaunaEcologyRuns(replayA.outputs, replayB.outputs).equal, true);

const reorderedInput = {
  ...basePlanInput,
  habitats: [habitat({ id: 'forest-02', position: { x: 400, z: 500 } }), habitat()],
  candidates: [candidate({ id: 'wolf-02' }), candidate({ id: 'wolf-01' })],
  threats: [threat({ id: 'player-02', distanceMeters: 33 }), threat({ id: 'player-01', distanceMeters: 16 })],
  population: [{ species: 'wolf', habitatId: 'forest-02', count: 1 }, { species: 'wolf', habitatId: 'forest-01', count: 2 }],
};
const reorderedA = planFaunaEcologyTick(reorderedInput);
const reorderedB = planFaunaEcologyTick({ ...reorderedInput, habitats: [...reorderedInput.habitats].reverse(), candidates: [...reorderedInput.candidates].reverse(), threats: [...reorderedInput.threats].reverse(), population: [...reorderedInput.population].reverse() });
assert.deepEqual(reorderedA, reorderedB);

const refresh = planPopulationRefresh({
  worldSeed: 'population-test', now: 900, clock: { hour: 7, day: 4, season: 'spring', weather: 'rain' },
  habitats: [habitat(), habitat({ id: 'taiga-01', biome: 'taiga', position: { x: 600, z: 700 }, waterDepth: 0.1, slope: 0.2 }), habitat({ id: 'meadow-01', biome: 'meadow', position: { x: 800, z: 300 }, waterDepth: 0.05, slope: 0.1 }), habitat({ id: 'mountain-01', biome: 'mountain', position: { x: 900, z: 1200 }, waterDepth: 0.1, slope: 0.4 })],
  population: [{ species: 'deer', habitatId: 'forest-01', count: 2, juveniles: 1, adults: 1 }, { species: 'wolf', habitatId: 'taiga-01', count: 2, juveniles: 0, adults: 2 }],
});
assertFrozen(refresh, 'population refresh');
assert.equal(refresh.kind, 'population-refresh');
assert.ok(refresh.rows.length > 0 && refresh.rows.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows);
assert.equal(refresh.fingerprint.length, 8);
assert.ok(refresh.rows.some((row) => row.species === 'deer'));
assert.ok(refresh.rows.some((row) => row.species === 'wolf'));
const springRows = refresh.rows.filter((row) => row.species === 'deer' && row.habitatId === 'forest-01');
assert.equal(springRows.length, 1);
assert.ok(springRows[0].juveniles >= 0 && springRows[0].target >= 1);

const customProfile = getFaunaSpeciesProfile('otter', { otter: { habitat: ['river', 'lake'], active: ['dawn', 'day'], rest: ['night'], diet: 'predator', groupMin: 1, groupMax: 4, assetFamily: 'animals', sourceCandidates: ['assets/models/animals/otter.glb'] } });
assert.equal(customProfile.species, 'otter');
assert.equal(customProfile.diet, 'predator');
assert.deepEqual(customProfile.habitat, ['river', 'lake']);
assert.equal(customProfile.asset.sourceCandidates[0], 'assets/models/animals/otter.glb');

const customPlan = planFaunaEcologyTick({
  ...basePlanInput,
  habitats: [habitat({ biome: 'meadow', id: 'custom-habitat', position: { x: 33, z: 44 } })],
  candidates: [candidate({ id: 'otter-01', species: 'otter' })], threats: [],
  speciesTable: { otter: { habitat: ['meadow'], active: ['day'], rest: ['night'], diet: 'predator', groupMin: 1, groupMax: 2, preferredWaterDepth: [0, 0.5], slopeLimit: 0.6, baseRate: 0.4, assetFamily: 'animals', sourceCandidates: ['assets/models/animals/otter.glb'] } },
});
assert.equal(validateFaunaEcologyPlan(customPlan).ok, true);
assert.ok(customPlan.updates.some((item) => item.species === 'otter'));
assert.equal(customPlan.governance.materialOwner, 'MaterialAssignmentCore');
const customPlacement = buildFaunaPlacementManifest({ species: 'otter', habitat: habitat({ biome: 'meadow' }), sourcePath: 'assets/models/animals/otter.glb' });
assert.equal(customPlacement.sourcePath, 'assets/models/animals/otter.glb');

const appliedCalls = [];
const applied = applyFaunaEcologyTick(plan, {
  dispatchCommand: (command) => { appliedCalls.push(`command:${command.id}`); return command.id; },
  updateActor: (payload) => { appliedCalls.push(`update:${payload.actorId || payload.id || 'anonymous'}`); return payload.id || payload.actorId; },
  spawnGroup: (directive) => { appliedCalls.push(`spawn:${directive.id}`); return directive.id; },
  despawn: (payload) => { appliedCalls.push(`despawn:${payload.id}`); return payload.id; },
}, 120);
assertFrozen(applied, 'applied result');
assert.equal(applied.ok, true);
assert.equal(applied.errors.length, 0);
assert.ok(applied.dispatched >= 1);
assert.ok(appliedCalls.length >= applied.dispatched);
const failingApply = applyFaunaEcologyTick(plan, { dispatchCommand: () => { throw new Error('dispatch-failure'); }, updateActor: () => { throw new Error('update-failure'); }, spawnGroup: () => { throw new Error('spawn-failure'); } }, 121);
assert.equal(failingApply.ok, false);
assert.ok(failingApply.errors.length >= 1);
const emptyApply = applyFaunaEcologyTick(null, {}, 33);
assert.equal(emptyApply.ok, true);
assert.equal(emptyApply.dispatched, 0);
assert.deepEqual(emptyApply.errors, []);

const scenarioOutputs = [];
for (const scenario of FAUNA_ECOLOGY_SCENARIOS) {
  const created = createFaunaScenario({ scenario, worldSeed: `scenario:${scenario.id}` });
  const scenarioPlan = planFaunaEcologyTick(created);
  const result = validateFaunaEcologyPlan(scenarioPlan);
  assert.equal(result.ok, true, `${scenario.id}: ${result.errors.join(',')}`);
  assert.equal(scenarioPlan.clock.hour, scenario.hour);
  assert.equal(scenarioPlan.clock.phase, scenario.hour >= 21 || scenario.hour < 5 ? 'night' : scenario.hour < 8 ? 'dawn' : scenario.hour < 18 ? 'day' : 'dusk');
  assert.ok(scenarioPlan.fingerprint.length === 8);
  scenarioOutputs.push({ id: scenario.id, fingerprint: scenarioPlan.fingerprint, summary: summarizeFaunaEcology(scenarioPlan) });
}
assert.equal(scenarioOutputs.length, FAUNA_ECOLOGY_SCENARIOS.length);

const scenarioReplay = runFaunaEcologyReplay(FAUNA_ECOLOGY_SCENARIOS.map((scenario) => createFaunaScenario({ scenario, worldSeed: 'matrix' })));
assert.equal(scenarioReplay.count, FAUNA_ECOLOGY_SCENARIOS.length);
assert.equal(scenarioReplay.outputs.length, FAUNA_ECOLOGY_SCENARIOS.length);
assert.equal(scenarioReplay.digest.length, 8);

const invalidAssetAudit = auditFaunaAssetDirective({ placement: { asset: { editorRuntimeForbidden: false } } });
assert.equal(invalidAssetAudit.ok, false);
assert.ok(invalidAssetAudit.errors.includes('missing-material-contract'));
assert.ok(invalidAssetAudit.errors.includes('editor-runtime-not-forbidden'));
const invalidPlan = { ...plan, spawn: [{ id: 'bad', placement: { groundRequired: false, navRequired: false }, materialContract: 'wrong', placementContract: 'wrong' }], governance: { ...plan.governance, materialOwner: 'wrong', placementOwner: 'wrong', editorRuntimeImport: true } };
const invalidValidation = validateFaunaEcologyPlan(invalidPlan);
assert.equal(invalidValidation.ok, false);
assert.ok(invalidValidation.errors.includes('editor-runtime-import'));
assert.ok(invalidValidation.errors.includes('material-owner-mismatch'));
assert.ok(invalidValidation.errors.includes('placement-owner-mismatch'));
assert.ok(invalidValidation.errors.some((item) => item.startsWith('spawn-no-ground')));
assert.ok(invalidValidation.errors.some((item) => item.startsWith('spawn-material-owner')));

const scenarioMutation = createFaunaScenario({ scenario: FAUNA_ECOLOGY_SCENARIOS[0] });
assertFrozen(scenarioMutation, 'scenario input');
assertFrozen(scenarioMutation.clock, 'scenario clock');
assertFrozen(scenarioMutation.habitats, 'scenario habitats');
assertFrozen(scenarioMutation.population, 'scenario population');

const candidateStateMatrix = [
  candidate({ id: 'near-roam', species: 'deer', lod: 'near', distanceMeters: 40 }), candidate({ id: 'distant-roam', species: 'deer', lod: 'distant', distanceMeters: 250 }),
  candidate({ id: 'far-roam', species: 'deer', lod: 'far', distanceMeters: 1400 }), candidate({ id: 'culled-roam', species: 'deer', lod: 'culled', distanceMeters: 5000 }),
  candidate({ id: 'near-wolf', species: 'wolf', lod: 'near', distanceMeters: 30 }), candidate({ id: 'distant-wolf', species: 'wolf', lod: 'distant', distanceMeters: 300 }),
  candidate({ id: 'far-wolf', species: 'wolf', lod: 'far', distanceMeters: 1400 }), candidate({ id: 'near-horse', species: 'horse', lod: 'near', distanceMeters: 50 }),
  candidate({ id: 'distant-horse', species: 'horse', lod: 'distant', distanceMeters: 400 }), candidate({ id: 'far-horse', species: 'horse', lod: 'far', distanceMeters: 1400 }),
  candidate({ id: 'near-dragon', species: 'dragon', lod: 'near', distanceMeters: 70 }), candidate({ id: 'distant-dragon', species: 'dragon', lod: 'distant', distanceMeters: 350 }),
  candidate({ id: 'far-dragon', species: 'dragon', lod: 'far', distanceMeters: 1400 }),
];
for (const row of candidateStateMatrix) {
  const state = planFaunaEcologyTick({ ...basePlanInput, candidates: [row], threats: row.species === 'dragon' ? [threat()] : [] });
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates[0].id, row.id);
  assert.ok(['near', 'distant', 'far', 'culled'].includes(state.updates[0].lod));
  assertFrozen(state.updates[0], `matrix update ${row.id}`);
}

const hourMatrix = [{ hour: 0, expected: 'night' }, { hour: 1, expected: 'night' }, { hour: 4.99, expected: 'night' }, { hour: 5, expected: 'dawn' }, { hour: 5.5, expected: 'dawn' }, { hour: 7.99, expected: 'dawn' }, { hour: 8, expected: 'day' }, { hour: 12, expected: 'day' }, { hour: 17.99, expected: 'day' }, { hour: 18, expected: 'dusk' }, { hour: 19, expected: 'dusk' }, { hour: 20.99, expected: 'dusk' }, { hour: 21, expected: 'night' }, { hour: 22.5, expected: 'night' }, { hour: 23.99, expected: 'night' }];
for (const entry of hourMatrix) {
  const hourPlan = planFaunaEcologyTick({ ...basePlanInput, now: entry.hour * 3600, clock: { hour: entry.hour } });
  assert.equal(hourPlan.clock.phase, entry.expected, `hour ${entry.hour}`);
}
for (const weather of ['clear', 'rain', 'snow', 'fog', 'storm']) {
  const weatherPlan = planFaunaEcologyTick({ ...basePlanInput, clock: { hour: 12, weather }, now: 12 * 3600 });
  assert.equal(weatherPlan.clock.weather, weather);
  assert.equal(validateFaunaEcologyPlan(weatherPlan).ok, true);
}
for (const season of ['spring', 'summer', 'autumn', 'winter']) {
  const seasonPlan = planFaunaEcologyTick({ ...basePlanInput, clock: { hour: 12, season }, now: 12 * 3600 });
  assert.equal(seasonPlan.clock.season, season);
  assert.equal(validateFaunaEcologyPlan(seasonPlan).ok, true);
}

const biomeMatrix = [
  habitat({ id: 'forest-a', biome: 'forest' }), habitat({ id: 'meadow-a', biome: 'meadow' }), habitat({ id: 'hills-a', biome: 'hills', slope: 0.32 }),
  habitat({ id: 'taiga-a', biome: 'taiga', waterDepth: 0.1 }), habitat({ id: 'mountain-a', biome: 'mountain', slope: 0.55 }), habitat({ id: 'volcanic-a', biome: 'volcanic', waterDepth: 0.2, slope: 0.6 }),
  habitat({ id: 'ruins-a', biome: 'ruins', waterDepth: 0.1, slope: 0.3 }), habitat({ id: 'roadside-a', biome: 'roadside', waterDepth: 0.05, slope: 0.12 }), habitat({ id: 'settlement-edge-a', biome: 'settlement-edge', waterDepth: 0.04, slope: 0.1 }),
  habitat({ id: 'lake-a', biome: 'lake', waterDepth: 0.2, canonicalBiome: 'lake' }), habitat({ id: 'river-a', biome: 'river', waterDepth: 0.1, canonicalBiome: 'river' }), habitat({ id: 'ocean-a', biome: 'ocean', waterDepth: 2, canonicalBiome: 'ocean' }), habitat({ id: 'cliff-a', biome: 'cliff', waterDepth: 0.1, slope: 0.9, canonicalBiome: 'cliff' }),
];
for (const entry of biomeMatrix) {
  const habitatPlan = planFaunaEcologyTick({ ...basePlanInput, habitats: [entry], candidates: [], threats: [] });
  assert.equal(validateFaunaEcologyPlan(habitatPlan).ok, true, entry.id);
  assert.ok(habitatPlan.fingerprint.length === 8);
}

const populationMatrix = Array.from({ length: 18 }, (_, index) => ({ species: ['deer', 'wolf', 'horse', 'dragon'][index % 4], habitatId: `habitat-${index % 6}`, count: index % 9, juveniles: index % 3, adults: index % 7, stressed: index % 4, lastSpawnAt: -999 }));
const matrixRefresh = planPopulationRefresh({ worldSeed: 'matrix', now: 1200, clock: { hour: 14, day: 4, season: 'autumn', weather: 'clear' }, habitats: biomeMatrix.slice(0, 6).map((item) => ({ ...item, canonicalBiome: item.biome })), population: populationMatrix });
assert.ok(matrixRefresh.rows.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows);
assert.ok(matrixRefresh.rows.every((row) => row.capacity >= 0 && row.count >= 0 && row.target >= 0 && row.suitability >= 0 && row.suitability <= 1));

const largeCandidateSet = Array.from({ length: 90 }, (_, index) => candidate({ id: `candidate-${index.toString().padStart(3, '0')}`, species: ['deer', 'wolf', 'horse', 'dragon'][index % 4], lod: ['near', 'distant', 'far'][index % 3], distanceMeters: 50 + index * 60 }));
const largeThreatSet = Array.from({ length: 70 }, (_, index) => threat({ id: `threat-${index.toString().padStart(3, '0')}`, kind: ['player', 'wolf', 'dragon', 'guard'][index % 4], distanceMeters: 15 + index * 8 }));
const boundedPlan = planFaunaEcologyTick({ ...basePlanInput, candidates: largeCandidateSet, threats: largeThreatSet });
assert.ok(boundedPlan.updates.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates && boundedPlan.commands.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands && boundedPlan.events.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxEvents && boundedPlan.groups.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates);
assert.equal(validateFaunaEcologyPlan(boundedPlan).ok, true);
const largeHabitats = Array.from({ length: 100 }, (_, index) => habitat({ id: `habitat-${index.toString().padStart(3, '0')}`, biome: index % 5 === 0 ? 'taiga' : index % 4 === 0 ? 'meadow' : 'forest', position: { x: index * 11, z: index * 17 } }));
const boundedHabitats = planPopulationRefresh({ worldSeed: 'large-habitats', now: 5000, clock: { hour: 10, day: 8, season: 'summer', weather: 'clear' }, habitats: largeHabitats });
assert.ok(boundedHabitats.rows.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows);
const hugeGroupMembers = Array.from({ length: 50 }, (_, index) => candidate({ id: `member-${index}`, species: 'wolf' }));
const hugeGroup = planFaunaGroupCommand({ groupId: 'huge-pack', members: hugeGroupMembers, state: 'roam' });
assert.ok(hugeGroup.members.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxGroupMembers);
assert.equal(hugeGroup.command.payload.formation.length, hugeGroup.members.length);

const distanceSweepCandidates = [candidate({ id: 'safe-01', distanceMeters: 100, health: 1, spawnTime: 1 }), candidate({ id: 'edge-01', distanceMeters: LIVING_WORLD_FAUNA_ECOLOGY_POLICY.cullDistanceMeters + 1, health: 1, spawnTime: 1 }), candidate({ id: 'dead-01', distanceMeters: 50, health: 0, spawnTime: 1 }), candidate({ id: 'protected-01', distanceMeters: 9999, health: 0, protected: true, spawnTime: 1 })];
const sweep = planFaunaDespawnSweep({ now: 1000, candidates: distanceSweepCandidates });
assert.equal(sweep.despawn.length, 2);
assert.ok(sweep.despawn.some((item) => item.id === 'edge-01') && sweep.despawn.some((item) => item.id === 'dead-01'));
assert.equal(sweep.despawn.some((item) => item.id === 'protected-01'), false);

const staleReplay = runFaunaEcologyReplay([{ ...basePlanInput, now: 0, threats: [threat({ ageSeconds: 999 })] }, { ...basePlanInput, now: 10, threats: [threat({ ageSeconds: 0 })] }, { ...basePlanInput, now: 20, threats: [] }]);
assert.equal(staleReplay.outputs.length, 3);
assert.notEqual(staleReplay.outputs[0].fingerprint, staleReplay.outputs[1].fingerprint);
const comparisonMismatch = compareFaunaEcologyRuns(replayA.outputs, replayA.outputs.map((item, index) => index === 0 ? { ...item, fingerprint: 'deadbeef' } : item));
assert.equal(comparisonMismatch.equal, false);
assert.equal(comparisonMismatch.mismatches.length, 1);
assert.equal(comparisonMismatch.mismatches[0].index, 0);
assert.equal(comparisonMismatch.digest.length, 8);
const comparisonLengthMismatch = compareFaunaEcologyRuns(replayA.outputs, replayA.outputs.slice(0, 2));
assert.equal(comparisonLengthMismatch.equal, false);
assert.equal(comparisonLengthMismatch.mismatches.length, replayA.outputs.length - 2);

assert.doesNotThrow(() => planFaunaEcologyTick());
assert.doesNotThrow(() => planPopulationRefresh());
assert.doesNotThrow(() => planFaunaDespawnSweep());
assert.doesNotThrow(() => planFaunaGroupCommand());
assert.doesNotThrow(() => buildFaunaPlacementManifest());
assert.doesNotThrow(() => getFaunaSpeciesProfile('deer'));
assert.doesNotThrow(() => evaluateFaunaHabitat());
const nullAssetAudit = auditFaunaAssetDirective(null);
assert.equal(nullAssetAudit.ok, false);
assert.ok(nullAssetAudit.errors.includes('missing-asset-manifest'));
for (const [label, value] of [['plan.clock', plan.clock], ['plan.governance', plan.governance], ['plan.navigation', plan.navigation], ['plan.settlement', plan.settlement], ['plan.spawn', plan.spawn], ['plan.updates', plan.updates], ['plan.events', plan.events], ['plan.commands', plan.commands]]) assertFrozen(value, label);
for (const event of plan.events) {
  assertFrozen(event, 'event');
  assertFrozen(event.payload, 'event payload');
  assert.ok(typeof event.id === 'string' && typeof event.type === 'string' && typeof event.tick === 'number');
}
for (const groupRow of plan.groups) {
  assertFrozen(groupRow, 'group');
  assertFrozen(groupRow.formation, 'formation');
  assert.ok(groupRow.count >= 1 && groupRow.count <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxGroupMembers);
}
for (const command of plan.commands) {
  assertFrozen(command, 'command');
  assertFrozen(command.payload, 'command payload');
  assert.ok(command.priority >= 1 && command.expiresAfterSeconds > 0);
}

const pressurePlan = planFaunaEcologyTick({ ...basePlanInput, candidates: [candidate({ id: 'pressure-wolf', species: 'wolf', lod: 'near', distanceMeters: 30 })], threats: [threat({ id: 'dragon-close', kind: 'dragon', distanceMeters: 20 }), threat({ id: 'player-mid', kind: 'player', distanceMeters: 30 }), threat({ id: 'guard-far', kind: 'guard', distanceMeters: 90 })] });
assert.equal(pressurePlan.updates[0].state, 'flee');
assert.ok(pressurePlan.events.some((event) => event.type === 'predator-pressure'));
assert.ok(pressurePlan.commands.some((command) => command.type === 'flee'));
const predatorPlan = planFaunaEcologyTick({ ...basePlanInput, candidates: [candidate({ id: 'wolf-hunt', species: 'wolf', lod: 'near', distanceMeters: 50 })], threats: [threat({ kind: 'deer', id: 'prey-01', distanceMeters: 30 })] });
assert.equal(predatorPlan.updates[0].state, 'stalk');
assert.equal(predatorPlan.updates[0].targetId, 'prey-01');
const dragonPlan = planFaunaEcologyTick({ ...basePlanInput, habitats: [habitat({ biome: 'mountain', id: 'mountain-dragon', slope: 0.4, waterDepth: 0.3, position: { x: 1000, z: 1100 } })], candidates: [candidate({ id: 'dragon-01', species: 'dragon', groupId: 'solo-dragon', distanceMeters: 100 })], threats: [threat({ id: 'player-dragon', kind: 'player', distanceMeters: 20 })] });
assert.ok(dragonPlan.updates.some((item) => item.species === 'dragon'));
assert.ok(dragonPlan.updates.some((item) => item.state === 'flee'));
const horsePlan = planFaunaEcologyTick({ ...basePlanInput, clock: { hour: 13, season: 'summer', weather: 'clear' }, habitats: [habitat({ biome: 'meadow', id: 'horse-meadow', position: { x: 400, z: 400 }, slope: 0.1 })], candidates: [candidate({ id: 'horse-01', species: 'horse', groupId: 'horse-herd', distanceMeters: 100 })], threats: [threat({ kind: 'wolf', id: 'wolf-threat', distanceMeters: 20 })] });
assert.ok(horsePlan.updates.some((item) => item.species === 'horse'));
assert.ok(['flee', 'roam'].includes(horsePlan.updates[0].state));
assert.equal(validateFaunaEcologyPlan(horsePlan).ok, true);
const nightDeerPlan = planFaunaEcologyTick({ ...basePlanInput, clock: { hour: 23, season: 'winter', weather: 'snow' }, candidates: [candidate({ id: 'deer-night', species: 'deer', distanceMeters: 120 })], threats: [] });
assert.equal(nightDeerPlan.clock.phase, 'night');
assert.equal(nightDeerPlan.updates[0].schedule.rest, true);
const cullPlan = planFaunaEcologyTick({ ...basePlanInput, now: 1000, candidates: [candidate({ id: 'cull-me', distanceMeters: 6000, spawnTime: 0 })], threats: [] });
assert.ok(cullPlan.despawn.some((item) => item.id === 'cull-me'));
assert.ok(cullPlan.commands.some((item) => item.type === 'despawn'));
const noMutationPlan = planFaunaEcologyTick({ ...basePlanInput, navigation: { route: () => {} }, settlement: { isInside: () => true } });
assert.equal(noMutationPlan.navigation.mutation, false);
assert.equal(noMutationPlan.settlement.mutation, false);
assert.equal(noMutationPlan.navigation.routeOwner, 'existing-navigation-owner');
assert.equal(noMutationPlan.settlement.owner, 'existing-settlement-owner');
const defaultPlan = planFaunaEcologyTick({ habitats: [habitat()] });
assert.equal(defaultPlan.clock.phase, 'day');
assert.equal(validateFaunaEcologyPlan(defaultPlan).ok, true);
const unsupportedSpeciesPlan = planFaunaEcologyTick({ ...basePlanInput, candidates: [candidate({ id: 'strange-01', species: 'unknown-beast' })], threats: [threat()] });
assert.equal(validateFaunaEcologyPlan(unsupportedSpeciesPlan).ok, true);
assert.equal(unsupportedSpeciesPlan.updates[0].species, 'unknown-beast');
assert.ok(['roam', 'flee'].includes(unsupportedSpeciesPlan.updates[0].state));

console.log('LIVING_WORLD_FAUNA_ECOLOGY_RUNTIME_OK');
