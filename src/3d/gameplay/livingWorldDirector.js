/**
 * Şafak Kartalı — Living World AI / NPC / Factions / Fauna Director.
 *
 * Composition-only facade over the repository's existing living-world owners. Existing reaction runtime,
 * group director, occupation schedule, ecology policy, event director and navigation/combat/law services
 * retain ownership. This facade adds bounded cross-domain evidence: threat memory, population budget,
 * crime/reputation projection, settlement fit, wildlife needs, group tactics, ambient events, navigation
 * safety, spawn admission, shared Material/Placement contract and deterministic replay/perf evidence.
 */

import {
  createLivingWorldReactionIntegration,
  auditLivingWorldReactionIntegration,
  LIVING_WORLD_REACTION_INTEGRATION_POLICY,
} from './livingWorldReactionIntegrationAdapter.js';
import {
  normalizeThreatObservation,
  mergeThreatEvidence,
  ageThreatMemory,
  selectThreatTarget,
  summarizeThreatMemory,
  capThreatMemories,
  projectThreatForReaction,
  auditThreatMemory,
  deterministicMemoryFingerprint,
  THREAT_MEMORY_POLICY,
} from './livingWorldThreatMemory.js';
import {
  normalizePopulationCollection,
  chooseFrameBudget,
  chooseSimulationSlice,
  rankSpawnCandidates,
  buildAmbientCandidates,
  ambientAdmission,
  summarizePopulation,
  clampSpawnBatch,
  clampAmbientBatch,
  auditPopulationBudget,
  deterministicPopulationFingerprint,
  POPULATION_BUDGET_POLICY,
} from './livingWorldPopulationBudget.js';
import {
  processCrimeBatch,
  normalizeWantedState,
  ageWantedScore,
  deterministicCrimeFingerprint,
  auditCrimeProjection,
  CRIME_REPUTATION_POLICY,
} from './livingWorldCrimeReputationPolicy.js';
import {
  inspectAssetMetadata,
  validateAssetSource,
  executePlacementContract,
  placementManifest,
  placementAudit,
  ASSET_PLACEMENT_POLICY,
} from './livingWorldAssetPlacementContract.js';
import {
  buildOccupationAffinity,
  choosePreferredSettlement,
  buildTravelDirective,
  roleNeedSummary,
  settlementPressure,
  auditSettlementAffinity,
  deterministicSettlementFingerprint,
} from './livingWorldSettlementAffinity.js';
import {
  createReplayLedger,
  canonicalFrame,
  fingerprint,
  buildReplaySeed,
  deterministicEventKey,
  sortEvents,
  summarizeLedger,
  auditReplay,
  buildDeterminismEvidence,
  REPLAY_POLICY,
} from './livingWorldReplay.js';
import {
  buildFaunaDirective,
  buildFaunaGroupDirective,
  advanceFaunaNeeds,
  normalizeFaunaNeeds,
  threatPressure,
  buildPackCohesion,
  deterministicFaunaFingerprint,
  auditFaunaNeeds,
  capFaunaAgents,
  FAUNA_NEEDS_POLICY,
} from './livingWorldFaunaNeedsPolicy.js';
import {
  buildGroupTacticalSnapshot,
  chooseTacticalIntent,
  buildFormationSlots,
  protectCivilianDecision,
  retreatDestination,
  combatReadiness,
  shouldBreakPursuit,
  auditTacticalSnapshot,
  deterministicGroupOrder,
  GROUP_TACTICS_POLICY,
} from './livingWorldGroupTacticsPolicy.js';
import {
  buildAmbientEvents,
  selectAmbientEvents,
  buildDistressEvent,
  buildMigrationEvent,
  buildStampedeEvent,
  auditAmbientEvents,
  deterministicAmbientFingerprint,
  AMBIENT_EVENT_POLICY,
} from './livingWorldAmbientEventPolicy.js';
import {
  validatePath,
  navigationIntent,
  buildFleePath,
  nearestSafePoint,
  evaluateStep,
  auditNavigation,
  deterministicNavigationFingerprint,
  NAVIGATION_SAFETY_POLICY,
} from './livingWorldNavigationSafetyPolicy.js';
import {
  admit as admitSpawn,
  rank as rankSpawnAdmission,
  batch as batchSpawnAdmission,
  buildSpawnIntent,
  habitatGate,
  auditSpawn,
  deterministicSpawnFingerprint,
  SPAWN_ADMISSION_POLICY,
} from './livingWorldSpawnAdmission.js';
import {
  buildRuntimeEvidence,
  auditRuntimeEvidence,
  summarizeFrameTimes,
  tickWorkEstimate,
  budgetVerdict,
  deterministicPerformanceFingerprint,
  PERFORMANCE_EVIDENCE_POLICY,
} from './livingWorldPerformanceEvidence.js';

const freeze = (value) => Object.freeze(value);
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const str = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
const arr = (value) => Array.isArray(value) ? value : [];
const MAX_ACTORS = Math.min(128, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors);

export const SAFAK_KARTALI_DIRECTOR_POLICY = freeze({
  id: 'safak-kartali-living-world-director-2026-09-14-v4',
  deterministic: true,
  maxActors: MAX_ACTORS,
  maxDeltaSeconds: 0.25,
  maxMemoryActors: THREAT_MEMORY_POLICY.maxMemoriesPerActor,
  maxCrimeIncidents: CRIME_REPUTATION_POLICY.maxIncidentsPerTick,
  maxPlacementRequests: ASSET_PLACEMENT_POLICY.maxRequestsPerTick,
  replayFrames: REPLAY_POLICY.maxFrames,
  integrationPolicy: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
  groupPolicy: GROUP_TACTICS_POLICY.id,
  faunaPolicy: FAUNA_NEEDS_POLICY.id,
  ambientPolicy: AMBIENT_EVENT_POLICY.id,
  navigationPolicy: NAVIGATION_SAFETY_POLICY.id,
  spawnPolicy: SPAWN_ADMISSION_POLICY.id,
  performancePolicy: PERFORMANCE_EVIDENCE_POLICY.id,
  sharedMaterial: ASSET_PLACEMENT_POLICY.sharedMaterialModule,
  sharedPlacement: ASSET_PLACEMENT_POLICY.sharedPlacementModule,
  ownsActorMembership: false,
  ownsCombatDamage: false,
  ownsFactionState: false,
  ownsSpawnLifecycle: false,
});

function actorId(actor, index = 0) {
  return str(actor?.id ?? actor?.actorId ?? actor?.object3D?.uuid, `actor-${index}`);
}

function positionOf(value) {
  const position = value?.object3D?.position ?? value?.position ?? value?.transform?.position;
  if (!position) return null;
  const x = num(position.x, NaN);
  const z = num(position.z, NaN);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function flattenCollections(collections = {}) {
  return ['npcs', 'animals', 'creatures', 'dragons']
    .flatMap((kind) => arr(collections[kind]).slice(0, MAX_ACTORS).map((actor) => ({ ...actor, kind })))
    .slice(0, MAX_ACTORS);
}

function normalizeWorldContext(context = {}) {
  return {
    biome: str(context.biome, 'temperate'),
    timeOfDay: num(context.timeOfDay, 12),
    weather: str(context.weather, 'clear'),
    season: str(context.season, 'summer'),
    distanceToSettlementMeters: num(context.distanceToSettlementMeters, Infinity),
    insideSettlement: Boolean(context.insideSettlement),
    onRoad: Boolean(context.onRoad),
    habitatScore: num(context.habitatScore, 1),
    requestedSpawn: num(context.requestedSpawn, 4),
    requestedAmbient: num(context.requestedAmbient, 6),
    populationCapacity: context.populationCapacity ?? {},
    populationDensity: num(context.populationDensity, 0),
    danger: num(context.danger, 0),
    weatherRisk: num(context.weatherRisk, 0),
    mobile: Boolean(context.mobile),
    pwa: Boolean(context.pwa),
  };
}

function normalizePerceptionSignals(signals = {}) {
  const map = new Map();
  if (signals instanceof Map) {
    for (const [key, value] of signals.entries()) map.set(String(key), arr(value));
  } else if (signals && typeof signals === 'object') {
    for (const [key, value] of Object.entries(signals)) map.set(String(key), arr(value));
  }
  return map;
}

function normalizeCrimeIncidents(value) {
  return arr(value).slice(0, CRIME_REPUTATION_POLICY.maxIncidentsPerTick);
}

function normalizePlacementCandidates(value) {
  return arr(value).slice(0, ASSET_PLACEMENT_POLICY.maxRequestsPerTick).map((candidate, index) => ({
    ...candidate,
    id: str(candidate?.id, `placement-${index}`),
    asset: candidate?.asset ?? candidate,
    context: candidate?.context ?? {},
    materialEvidence: candidate?.materialEvidence ?? {},
    paletteId: str(candidate?.paletteId),
  }));
}

function normalizeGroups(groups) {
  return arr(groups).slice(0, GROUP_TACTICS_POLICY.maxGroups).map((group, index) => ({
    ...group,
    id: str(group?.id, `group-${index}`),
    members: arr(group?.members).slice(0, GROUP_TACTICS_POLICY.maxMembers),
  }));
}

function normalizeFaunaStates(actors) {
  return capFaunaAgents(arr(actors).filter((actor) => ['animal', 'creature', 'dragon'].includes(str(actor?.kind).toLowerCase())));
}

export function createLivingWorldDirector(options = {}) {
  const seed = options.seed ?? 0;
  const integration = createLivingWorldReactionIntegration({
    seed,
    clockSeconds: options.clockSeconds ?? 0,
    services: options.services ?? {},
    directorOptions: options.directorOptions ?? {},
    lodThresholds: options.lodThresholds,
  });
  const replaySeed = buildReplaySeed({ worldSeed: seed, actorSeed: options.actorSeed ?? seed, eventSeed: options.eventSeed ?? seed });
  const replay = createReplayLedger(replaySeed);
  const memories = new Map();
  const faunaNeeds = new Map();
  const wanted = new Map();
  const lastTick = new Map();
  let disposed = false;
  let tickCount = 0;
  let clockSeconds = Math.max(0, num(options.clockSeconds));
  let lastSnapshot = null;

  function updateThreatMemory(actors, signalInput, deltaSeconds) {
    const signalMap = normalizePerceptionSignals(signalInput);
    const rows = [];
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index];
      const id = actorId(actor, index);
      const prior = memories.get(id) ?? [];
      const incoming = signalMap.get(id) ?? [];
      const touched = new Set();
      const current = [];
      for (const raw of incoming.slice(0, THREAT_MEMORY_POLICY.maxMemoriesPerActor)) {
        const observation = normalizeThreatObservation({
          ...raw,
          targetId: raw?.targetId ?? raw?.target?.id,
          nowSeconds: clockSeconds,
        });
        if (!observation.targetId) continue;
        touched.add(observation.targetId);
        const previous = prior.find((memory) => memory.targetId === observation.targetId);
        current.push(mergeThreatEvidence(previous, observation, clockSeconds));
      }
      for (const memory of prior) {
        if (touched.has(memory.targetId)) continue;
        const aged = ageThreatMemory(memory, deltaSeconds);
        if (aged.confidence || aged.suspicion) current.push(aged);
      }
      const bounded = capThreatMemories(current);
      memories.set(id, bounded);
      const top = selectThreatTarget(bounded, { position: positionOf(actor) });
      rows.push(freeze({
        actorId: id,
        memoryCount: bounded.length,
        topTargetId: top?.memory?.targetId ?? '',
        topScore: top?.score ?? 0,
        summary: summarizeThreatMemory(bounded),
        fingerprint: deterministicMemoryFingerprint(bounded, seed),
      }));
    }
    return freeze(rows.sort((a, b) => a.actorId.localeCompare(b.actorId)));
  }

  function updateFaunaNeeds(actors, deltaSeconds, context = {}) {
    const rows = [];
    for (const actor of normalizeFaunaStates(actors)) {
      const id = actorId(actor);
      const species = str(actor.species ?? actor.type, 'wolf');
      const current = normalizeFaunaNeeds(faunaNeeds.get(id) ?? actor.needs ?? { energy: 1 });
      const threats = arr(context.faunaThreats?.[id]);
      const pressure = threatPressure(threats, { position: actor.position, threatRadius: 80 });
      const next = advanceFaunaNeeds(current, deltaSeconds, {
        predatorNearby: pressure.score >= .4,
        density: context.populationDensity,
        safe: pressure.score < .15,
        crowded: num(context.groupDensity) > 1,
      });
      faunaNeeds.set(id, next);
      rows.push(freeze({
        actorId: id,
        directive: buildFaunaDirective(actor, next, {
          species,
          threats,
          position: actor.position,
          distanceToWaterMeters: context.distanceToWaterMeters?.[id],
          distanceToFoodMeters: context.distanceToFoodMeters?.[id],
          destination: context.faunaDestination?.[id],
          travelRequired: Boolean(context.faunaTravelRequired?.[id]),
        }),
        audit: auditFaunaNeeds(next),
        fingerprint: deterministicFaunaFingerprint(next, seed),
      }));
    }
    return freeze(rows.sort((a, b) => a.actorId.localeCompare(b.actorId)));
  }

  function processCrime(incidents) {
    const context = {
      seed,
      wantedByActor: Object.fromEntries(wanted),
      witnessReputation: options.crimeContext?.witnessReputation ?? {},
      economyMultiplier: options.crimeContext?.economyMultiplier ?? 1,
    };
    const projection = processCrimeBatch(normalizeCrimeIncidents(incidents), context);
    for (const row of projection.rows) {
      const id = row.incident.actorId;
      const before = wanted.get(id) ?? normalizeWantedState(options.crimeContext?.wantedByActor?.[id]);
      wanted.set(id, normalizeWantedState({
        wantedScore: row.projection.wantedAfter,
        bounty: before.bounty + row.projection.bountyDelta,
        lastCrimeSeconds: row.incident.timestamp,
        witnessCount: row.projection.witnessCount,
      }));
    }
    return projection;
  }

  function decayWanted(deltaSeconds) {
    for (const [id, state] of wanted.entries()) {
      const next = normalizeWantedState({ ...state, wantedScore: ageWantedScore(state.wantedScore, deltaSeconds) });
      if (next.wantedScore <= 0 && next.bounty <= 0) wanted.delete(id);
      else wanted.set(id, next);
    }
  }

  function populationSnapshot(collections, playerPosition, context) {
    const normalized = normalizePopulationCollection(collections);
    const summary = summarizePopulation(normalized, playerPosition, { ...context, lodThresholds: options.lodThresholds });
    const budget = chooseFrameBudget({
      actorCount: normalized.length,
      mobile: context.mobile || context.pwa,
      near: summary.counts.near,
      distant: summary.counts.distant,
      far: summary.counts.far,
      requestedSpawn: context.requestedSpawn,
      requestedAmbient: context.requestedAmbient,
    });
    const slice = chooseSimulationSlice(normalized, {
      maxTicks: budget.nearTicks + budget.distantTicks + budget.farTicks,
      playerPosition,
      lodThresholds: options.lodThresholds,
    }, clockSeconds, lastTick);
    for (const row of slice.selected) lastTick.set(row.actor.id, clockSeconds);
    const spawnPool = rankSpawnCandidates(
      clampSpawnBatch(context.spawnCandidates ?? [], budget),
      normalized,
      { habitatScore: context.habitatScore, capacity: context.populationCapacity, blocked: context.spawnBlocked },
    );
    const ambientPool = clampAmbientBatch(buildAmbientCandidates({
      biome: context.biome,
      timeOfDay: context.timeOfDay,
      weather: context.weather,
      settlementDistanceMeters: context.distanceToSettlementMeters,
      currentCount: normalized.length,
      species: context.ambientSpecies,
      seed,
    }), budget);
    const admittedAmbient = ambientPool
      .filter((candidate) => ambientAdmission(candidate, {
        density: candidate.density,
        distanceToSettlementMeters: context.distanceToSettlementMeters,
        insideSettlement: context.insideSettlement,
        onRoad: context.onRoad,
        waterTooDeep: context.waterTooDeep,
        slopeTooSteep: context.slopeTooSteep,
      }).accepted)
      .slice(0, budget.ambient);
    const admission = rankSpawnAdmission(context.spawnCandidates ?? [], {
      kind: context.spawnKind ?? 'animal',
      habitatScore: context.habitatScore,
      populationPressure: summary.pressure?.pressure?.[context.spawnKind ?? 'animal'] ?? 0,
      distanceToPlayer: context.distanceToPlayer,
      currentCount: normalized.length,
      capacity: num(context.spawnCapacity, 12),
      spawnBudget: budget.spawn,
      navReady: context.navReady !== false,
      slopeDegrees: context.slopeDegrees,
      insideSettlement: context.insideSettlement,
      onWater: context.onWater,
      waterDepth: context.waterDepth,
    });
    return freeze({
      actorCount: normalized.length,
      summary,
      budget,
      slice: freeze({ selected: slice.selected.length, skipped: slice.skipped.length }),
      spawn: freeze(spawnPool),
      spawnAdmission: freeze(admission),
      ambient: freeze(admittedAmbient),
      pressure: summary.pressure,
      audit: auditPopulationBudget({ actorCount: normalized.length, spawnCount: spawnPool.length, ambientCount: admittedAmbient.length }),
    });
  }

  function groupSnapshot(groups, actors, context = {}) {
    const actorById = new Map(actors.map((actor, index) => [actorId(actor, index), actor]));
    const rows = [];
    for (const group of normalizeGroups(groups)) {
      const members = group.members.map((member) => typeof member === 'string' ? actorById.get(member) : member).filter(Boolean);
      const tactical = buildGroupTacticalSnapshot({ ...group, members }, {
        threats: arr(context.groupThreats?.[group.id]),
        civilianThreat: Boolean(context.civilianThreats?.[group.id]),
        rangedAdvantage: Boolean(context.rangedAdvantage?.[group.id]),
      });
      const focus = chooseTacticalIntent({ ...group, members }, { threats: arr(context.groupThreats?.[group.id]) });
      const formation = buildFormationSlots({ ...group, members }, group.origin ?? positionOf(members[0]) ?? { x: 0, z: 0 }, num(group.headingRadians));
      const protection = context.civilianPositions?.[group.id]
        ? protectCivilianDecision({ ...group, members }, context.civilianPositions[group.id], arr(context.groupThreats?.[group.id]))
        : null;
      const retreat = retreatDestination({ ...group, members }, arr(context.safePositions?.[group.id]));
      const readiness = combatReadiness({ ...group, members });
      const breakPursuit = shouldBreakPursuit({ ...group, members }, context.groupRuntime?.[group.id] ?? {});
      rows.push(freeze({
        ...tactical,
        focusIntent: focus.intent,
        formation,
        protection,
        retreatDestination: retreat,
        readiness,
        breakPursuit,
        audit: auditTacticalSnapshot(tactical),
      }));
    }
    return freeze({
      groups: freeze(rows),
      count: rows.length,
      order: deterministicGroupOrder(rows, seed),
      fingerprint: fingerprint(rows, seed),
    });
  }

  function ambientSnapshot(context = {}, types = []) {
    const selected = selectAmbientEvents({
      ...context,
      populationDensity: num(context.populationDensity),
      danger: num(context.danger),
    }, types, seed, context.lastIssued ?? {}, clockSeconds);
    const built = buildAmbientEvents(context, types, seed);
    return freeze({
      candidates: built,
      selected,
      migration: buildMigrationEvent({ species: context.migrationSpecies ?? 'deer', season: context.season, biome: context.biome, pressure: context.populationPressure, seed }),
      stampede: buildStampedeEvent({ species: context.stampedeSpecies ?? 'deer', groupCount: context.groupCount, predatorThreat: context.predatorThreat, noise: context.noise, seed }),
      distress: buildDistressEvent({ actorId: context.distressActorId, targetId: context.distressTargetId, locationId: context.locationId, severity: context.distressSeverity, seed, tick: tickCount }),
      audit: auditAmbientEvents(selected),
      fingerprint: deterministicAmbientFingerprint(selected, seed),
    });
  }

  function navigationSnapshot(actors, context = {}) {
    const rows = arr(actors).slice(0, NAVIGATION_SAFETY_POLICY.maxWaypoints).map((actor, index) => {
      const path = arr(context.paths?.[actorId(actor, index)]);
      const validation = validatePath(path, actor);
      const intent = navigationIntent(actor, context.navigationByActor?.[actorId(actor, index)] ?? {});
      const step = path.length ? evaluateStep(path[0], actor) : { ok: true, reasons: [] };
      const flee = context.threatByActor?.[actorId(actor, index)] && buildFleePath(positionOf(actor), context.threatByActor[actorId(actor, index)], arr(context.safePositions));
      return freeze({ actorId: actorId(actor, index), validation, intent, firstStep: step, flee, nearestSafe: nearestSafePoint(arr(context.safePositions), arr(context.hazards)), audit: auditNavigation(validation) });
    });
    return freeze({ rows, count: rows.length, fingerprint: deterministicNavigationFingerprint(rows, seed) });
  }

  function placementSnapshot(candidates) {
    const audits = [];
    const accepted = [];
    for (const candidate of normalizePlacementCandidates(candidates)) {
      const source = validateAssetSource(candidate.asset);
      const meta = inspectAssetMetadata(candidate.asset);
      if (!source.ok) {
        audits.push(freeze({ id: candidate.id, accepted: false, stage: 'source', family: meta.family, reasons: source.reasons }));
        continue;
      }
      const result = executePlacementContract({
        asset: candidate.asset,
        materialCore: options.materialCore,
        placementPipeline: options.placementPipeline,
        materialEvidence: candidate.materialEvidence,
        paletteId: candidate.paletteId,
        context: candidate.context,
      });
      audits.push(freeze({ id: candidate.id, accepted: result.ok === true, family: meta.family, ...placementAudit(result) }));
      if (result.ok) accepted.push(freeze({ id: candidate.id, result, manifest: placementManifest(result) }));
    }
    return freeze({ requested: accepted.length, rejected: audits.filter((audit) => audit.accepted === false).length, requests: freeze(accepted), audits: freeze(audits), contract: ASSET_PLACEMENT_POLICY.id });
  }

  function settlementSnapshot(actors, settlements, context) {
    const rows = arr(actors).slice(0, 24).map((actor) => {
      const affinity = buildOccupationAffinity(actor, settlements);
      const preferred = choosePreferredSettlement(actor, settlements);
      return freeze({ actorId: actorId(actor), affinity, preferred, travel: buildTravelDirective(actor, preferred) });
    });
    return freeze({
      rows: freeze(rows),
      needs: roleNeedSummary(context),
      pressure: settlementPressure(context),
      audit: auditSettlementAffinity(rows.flatMap((row) => row.affinity)),
      fingerprint: deterministicSettlementFingerprint(rows, seed),
    });
  }

  function eventProjection(events) {
    return freeze(sortEvents(arr(events).map((event) => ({ ...event, deterministicKey: deterministicEventKey(event, replaySeed) }))));
  }

  function tick(input = {}) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed', tick: tickCount });
    const deltaSeconds = Math.max(0, Math.min(SAFAK_KARTALI_DIRECTOR_POLICY.maxDeltaSeconds, num(input.deltaSeconds)));
    clockSeconds += deltaSeconds;
    const collections = input.collections ?? {};
    const actors = flattenCollections(collections);
    const worldContext = normalizeWorldContext({ ...input.worldContext, mobile: input.mobile ?? input.worldContext?.mobile, pwa: input.pwa ?? input.worldContext?.pwa });
    const integrationResult = integration.tick({
      deltaSeconds,
      collections,
      occupations: input.occupations,
      faunaRequests: input.faunaRequests,
      eventContext: input.eventContext ?? worldContext,
      eventTypes: input.eventTypes,
      groups: input.groups,
      companions: input.companions,
      playerPosition: input.playerPosition,
      reactionOptions: input.reactionOptions,
    });
    const memory = updateThreatMemory(actors, input.perceptionSignals, deltaSeconds);
    const fauna = updateFaunaNeeds(actors, deltaSeconds, { ...worldContext, ...input.faunaContext });
    const crime = processCrime(input.crimeIncidents);
    decayWanted(deltaSeconds);
    const population = populationSnapshot(collections, input.playerPosition, { ...worldContext, ...(input.worldContext ?? {}), spawnCandidates: input.spawnCandidates ?? input.worldContext?.spawnCandidates });
    const groups = groupSnapshot(input.groups, actors, input.groupContext ?? {});
    const ambient = ambientSnapshot({ ...worldContext, ...(input.ambientContext ?? {}) }, input.eventTypes);
    const navigation = navigationSnapshot(actors, input.navigationContext ?? {});
    const placement = placementSnapshot(input.placementCandidates);
    const settlement = settlementSnapshot(actors, input.settlements, worldContext);
    const events = eventProjection([...(integrationResult?.reaction?.events ?? []), ...arr(integrationResult?.director?.events?.candidates), ...arr(input.worldEvents)]);
    const performance = buildRuntimeEvidence({ population, memory, tick: tickCount + 1, fingerprints: true });
    tickCount += 1;
    const frame = canonicalFrame({
      tick: tickCount,
      timeSeconds: clockSeconds,
      director: { accepted: integrationResult.accepted !== false, policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id },
      population,
      threats: memory,
      crime,
      fauna,
      groups,
      ambient,
      navigation,
      events,
    });
    const replayFrame = replay.append(frame);
    const snapshot = freeze({
      accepted: integrationResult.accepted !== false,
      tick: tickCount,
      clockSeconds,
      integration: integrationResult,
      memory,
      fauna,
      targets: freeze(memory.flatMap((row) => {
        const list = memories.get(row.actorId) ?? [];
        const selected = list.length ? selectThreatTarget(list)?.memory : null;
        return selected ? [{ actorId: row.actorId, target: projectThreatForReaction(selected) }] : [];
      })),
      crime,
      population,
      groups,
      ambient,
      navigation,
      placement,
      settlement,
      wanted: freeze([...wanted.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([actorId, state]) => freeze({ actorId, ...state }))),
      events,
      performance,
      replay: freeze({ frame: replayFrame, digest: replay.digest(), size: replay.size }),
      fingerprints: freeze({
        director: fingerprint(frame, seed),
        population: deterministicPopulationFingerprint(population, seed),
        memory: deterministicMemoryFingerprint(memory, seed),
        fauna: deterministicFaunaFingerprint(fauna, seed),
        crime: deterministicCrimeFingerprint(crime, seed),
        ambient: deterministicAmbientFingerprint(ambient, seed),
        navigation: deterministicNavigationFingerprint(navigation, seed),
        performance: deterministicPerformanceFingerprint(performance, seed),
      }),
      policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id,
    });
    lastSnapshot = snapshot;
    return snapshot;
  }

  function audit() {
    const integrationAudit = integration.audit();
    const populationAudit = auditPopulationBudget(lastSnapshot?.population ?? { actorCount: 0, spawnCount: 0, ambientCount: 0 });
    const crimeAudit = auditCrimeProjection(lastSnapshot?.crime ?? { rows: [] });
    const replayAudit = auditReplay(replay.read());
    const performanceAudit = auditRuntimeEvidence(lastSnapshot?.performance ?? {});
    const ambientAudit = auditAmbientEvents(lastSnapshot?.ambient?.selected ?? []);
    const placementErrors = arr(lastSnapshot?.placement?.audits).filter((audit) => audit.accepted === false).map((audit) => `placement:${audit.id}`);
    const faunaErrors = arr(lastSnapshot?.fauna).flatMap((row) => row.audit?.errors ?? []);
    const navigationErrors = arr(lastSnapshot?.navigation?.rows).flatMap((row) => row.audit?.errors ?? []);
    const errors = [
      ...(integrationAudit.errors ?? []),
      ...(populationAudit.errors ?? []),
      ...(crimeAudit.errors ?? []),
      ...(replayAudit.errors ?? []),
      ...(performanceAudit.errors ?? []),
      ...(ambientAudit.errors ?? []),
      ...placementErrors,
      ...faunaErrors,
      ...navigationErrors,
    ];
    return freeze({
      ok: integrationAudit.ok && populationAudit.ok && crimeAudit.ok && replayAudit.ok && performanceAudit.ok && ambientAudit.ok && !errors.length,
      errors: freeze([...new Set(errors)]),
      tick: tickCount,
      replay: summarizeLedger(replay.read()),
      policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id,
    });
  }

  function compareReplay(left, right) {
    return buildDeterminismEvidence(left, right);
  }

  function snapshot() {
    return freeze(lastSnapshot ?? { accepted: true, tick: 0, clockSeconds, policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id });
  }

  function readThreats(id) {
    return freeze((memories.get(String(id)) ?? []).map((memory) => projectThreatForReaction(memory)));
  }

  function readWanted(id) {
    return freeze({ ...(wanted.get(String(id)) ?? normalizeWantedState()) });
  }

  function readFauna(id) {
    return freeze({ ...(faunaNeeds.get(String(id)) ?? normalizeFaunaNeeds()) });
  }

  function reset() {
    memories.clear();
    faunaNeeds.clear();
    wanted.clear();
    lastTick.clear();
    replay.clear();
    tickCount = 0;
    clockSeconds = Math.max(0, num(options.clockSeconds));
    lastSnapshot = null;
    return integration.snapshot?.() ?? true;
  }

  function dispose() {
    disposed = true;
    integration.dispose();
    memories.clear();
    faunaNeeds.clear();
    wanted.clear();
    return true;
  }

  return Object.freeze({
    tick,
    audit,
    snapshot,
    readThreats,
    readWanted,
    readFauna,
    compareReplay,
    reset,
    dispose,
    get replaySeed() { return replaySeed; },
    get disposed() { return disposed; },
    manifest: freeze({
      policy: SAFAK_KARTALI_DIRECTOR_POLICY.id,
      authority: [
        'livingWorldReactionIntegrationAdapter',
        'livingWorldReactionRuntime',
        'livingWorldReactionPolicy',
        'livingWorldDirectorRuntimeAdapter',
        'livingWorldGroupDirectorAdapter',
        'livingWorldOccupationSchedule',
        'livingWorldEcologyPolicy',
        'livingWorldEventDirectorAdapter',
      ],
      sharedPlacement: [ASSET_PLACEMENT_POLICY.sharedMaterialModule, ASSET_PLACEMENT_POLICY.sharedPlacementModule],
      deterministic: true,
      replayFrames: REPLAY_POLICY.maxFrames,
      noDuplicateFramework: true,
    }),
  });
}

export function auditLivingWorldDirector(result) {
  const errors = [];
  if (!result || result.accepted !== true) errors.push('not-accepted');
  if (result?.policyId !== SAFAK_KARTALI_DIRECTOR_POLICY.id && result?.policyId != null) errors.push('policy-id');
  if (result?.integration) errors.push(...(auditLivingWorldReactionIntegration(result.integration).errors ?? []));
  if (result?.population) errors.push(...(auditPopulationBudget(result.population).errors ?? []));
  if (result?.crime) errors.push(...(auditCrimeProjection(result.crime).errors ?? []));
  if (result?.performance) errors.push(...(auditRuntimeEvidence(result.performance).errors ?? []));
  if (result?.ambient) errors.push(...(auditAmbientEvents(result.ambient.selected ?? []).errors ?? []));
  if (result?.navigation) errors.push(...arr(result.navigation.rows).flatMap((row) => row.audit?.errors ?? []));
  return freeze({ ok: !errors.length, errors: freeze([...new Set(errors)]), fingerprint: fingerprint(result, 0) });
}
