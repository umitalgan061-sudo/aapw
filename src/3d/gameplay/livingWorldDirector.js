/**
 * Şafak Kartalı — Living World AI / NPC / Factions / Fauna Director.
 *
 * Composition-only facade over the repository's existing living-world owners. Existing reaction runtime,
 * group director, occupation schedule, ecology policy, event director and navigation/combat/law services
 * retain ownership. This file adds deterministic cross-domain evidence, threat memory, population budget,
 * crime/reputation projection, settlement fit and shared asset-placement admission without duplicating them.
 */
import { createLivingWorldReactionIntegration, auditLivingWorldReactionIntegration, LIVING_WORLD_REACTION_INTEGRATION_POLICY } from './livingWorldReactionIntegrationAdapter.js';
import { normalizeThreatObservation, mergeThreatEvidence, ageThreatMemory, selectThreatTarget, summarizeThreatMemory, capThreatMemories, projectThreatForReaction, auditThreatMemory, deterministicMemoryFingerprint, THREAT_MEMORY_POLICY } from './livingWorldThreatMemory.js';
import { normalizePopulationCollection, chooseFrameBudget, chooseSimulationSlice, rankSpawnCandidates, buildAmbientCandidates, ambientAdmission, summarizePopulation, clampSpawnBatch, clampAmbientBatch, auditPopulationBudget, deterministicPopulationFingerprint, POPULATION_BUDGET_POLICY } from './livingWorldPopulationBudget.js';
import { processCrimeBatch, normalizeWantedState, ageWantedScore, deterministicCrimeFingerprint, auditCrimeProjection, CRIME_REPUTATION_POLICY } from './livingWorldCrimeReputationPolicy.js';
import { inspectAssetMetadata, validateAssetSource, executePlacementContract, placementManifest, placementAudit, ASSET_PLACEMENT_POLICY } from './livingWorldAssetPlacementContract.js';
import { buildOccupationAffinity, choosePreferredSettlement, buildTravelDirective, roleNeedSummary, settlementPressure, auditSettlementAffinity, deterministicSettlementFingerprint } from './livingWorldSettlementAffinity.js';
import { createReplayLedger, canonicalFrame, fingerprint, buildReplaySeed, deterministicEventKey, sortEvents, summarizeLedger, auditReplay, buildDeterminismEvidence, REPLAY_POLICY } from './livingWorldReplay.js';

const freeze = (value) => Object.freeze(value);
const num = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const str = (value, fallback = '') => value == null || value === '' ? fallback : String(value);
const arr = (value) => Array.isArray(value) ? value : [];
const MAX_ACTORS = Math.min(128, LIVING_WORLD_REACTION_INTEGRATION_POLICY.maxActors);

export const SAFAK_KARTALI_DIRECTOR_POLICY = freeze({
  id: 'safak-kartali-living-world-director-2026-09-14-v3', deterministic: true, maxActors: MAX_ACTORS,
  maxDeltaSeconds: 0.25, maxMemoryActors: THREAT_MEMORY_POLICY.maxMemoriesPerActor,
  maxCrimeIncidents: CRIME_REPUTATION_POLICY.maxIncidentsPerTick, maxPlacementRequests: ASSET_PLACEMENT_POLICY.maxRequestsPerTick,
  replayFrames: REPLAY_POLICY.maxFrames, integrationPolicy: LIVING_WORLD_REACTION_INTEGRATION_POLICY.id,
  sharedMaterial: ASSET_PLACEMENT_POLICY.sharedMaterialModule, sharedPlacement: ASSET_PLACEMENT_POLICY.sharedPlacementModule,
  ownsActorMembership: false, ownsCombatDamage: false, ownsFactionState: false, ownsSpawnLifecycle: false,
});

function actorId(actor, index = 0) { return str(actor?.id ?? actor?.actorId ?? actor?.object3D?.uuid, `actor-${index}`); }
function positionOf(value) { const p = value?.object3D?.position ?? value?.position ?? value?.transform?.position; if (!p) return null; const x = num(p.x, NaN); const z = num(p.z, NaN); return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null; }
function flattenCollections(collections = {}) { return ['npcs', 'animals', 'creatures', 'dragons'].flatMap((kind) => arr(collections[kind]).slice(0, MAX_ACTORS).map((actor) => ({ ...actor, kind }))).slice(0, MAX_ACTORS); }
function normalizeWorldContext(context = {}) { return { biome: str(context.biome, 'temperate'), timeOfDay: num(context.timeOfDay, 12), weather: str(context.weather, 'clear'), distanceToSettlementMeters: num(context.distanceToSettlementMeters, Infinity), insideSettlement: Boolean(context.insideSettlement), onRoad: Boolean(context.onRoad), habitatScore: num(context.habitatScore, 1), requestedSpawn: num(context.requestedSpawn, 4), requestedAmbient: num(context.requestedAmbient, 6), populationCapacity: context.populationCapacity ?? {}, mobile: Boolean(context.mobile), pwa: Boolean(context.pwa) }; }
function normalizePerceptionSignals(signals = {}) { const map = new Map(); if (signals instanceof Map) for (const [key, value] of signals.entries()) map.set(String(key), arr(value)); else if (signals && typeof signals === 'object') for (const [key, value] of Object.entries(signals)) map.set(String(key), arr(value)); return map; }
function normalizeCrimeIncidents(value) { return arr(value).slice(0, CRIME_REPUTATION_POLICY.maxIncidentsPerTick); }
function normalizePlacementCandidates(value) { return arr(value).slice(0, ASSET_PLACEMENT_POLICY.maxRequestsPerTick).map((candidate, index) => ({ ...candidate, id: str(candidate?.id, `placement-${index}`), asset: candidate?.asset ?? candidate, context: candidate?.context ?? {}, materialEvidence: candidate?.materialEvidence ?? {}, paletteId: str(candidate?.paletteId) })); }

export function createLivingWorldDirector(options = {}) {
  const seed = options.seed ?? 0;
  const integration = createLivingWorldReactionIntegration({ seed, clockSeconds: options.clockSeconds ?? 0, services: options.services ?? {}, directorOptions: options.directorOptions ?? {}, lodThresholds: options.lodThresholds });
  const replaySeed = buildReplaySeed({ worldSeed: seed, actorSeed: options.actorSeed ?? seed, eventSeed: options.eventSeed ?? seed });
  const replay = createReplayLedger(replaySeed);
  const memories = new Map();
  const wanted = new Map();
  const lastTick = new Map();
  let disposed = false; let tickCount = 0; let clockSeconds = Math.max(0, num(options.clockSeconds)); let lastSnapshot = null;

  function updateThreatMemory(actors, signalInput, deltaSeconds) {
    const signalMap = normalizePerceptionSignals(signalInput); const rows = [];
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index]; const id = actorId(actor, index); const prior = memories.get(id) ?? [];
      const incoming = signalMap.get(id) ?? []; const touched = new Set(); const current = [];
      for (const raw of incoming.slice(0, THREAT_MEMORY_POLICY.maxMemoriesPerActor)) {
        const observation = normalizeThreatObservation({ ...raw, targetId: raw?.targetId ?? raw?.target?.id, nowSeconds: clockSeconds }); if (!observation.targetId) continue;
        touched.add(observation.targetId); const previous = prior.find((memory) => memory.targetId === observation.targetId); current.push(mergeThreatEvidence(previous, observation, clockSeconds));
      }
      for (const memory of prior) if (!touched.has(memory.targetId)) { const aged = ageThreatMemory(memory, deltaSeconds); if (!aged.confidence && !aged.suspicion) continue; current.push(aged); }
      const bounded = capThreatMemories(current); memories.set(id, bounded); const top = selectThreatTarget(bounded, { position: positionOf(actor) });
      rows.push(freeze({ actorId: id, memoryCount: bounded.length, topTargetId: top?.memory?.targetId ?? '', topScore: top?.score ?? 0, summary: summarizeThreatMemory(bounded), fingerprint: deterministicMemoryFingerprint(bounded, seed) }));
    }
    return freeze(rows.sort((a, b) => a.actorId.localeCompare(b.actorId)));
  }

  function processCrime(incidents) {
    const context = { seed, wantedByActor: Object.fromEntries(wanted), witnessReputation: options.crimeContext?.witnessReputation ?? {}, economyMultiplier: options.crimeContext?.economyMultiplier ?? 1 };
    const projection = processCrimeBatch(normalizeCrimeIncidents(incidents), context);
    for (const row of projection.rows) {
      const id = row.incident.actorId; const before = wanted.get(id) ?? normalizeWantedState(options.crimeContext?.wantedByActor?.[id]);
      wanted.set(id, normalizeWantedState({ wantedScore: row.projection.wantedAfter, bounty: before.bounty + row.projection.bountyDelta, lastCrimeSeconds: row.incident.timestamp, witnessCount: row.projection.witnessCount }));
    }
    return projection;
  }

  function decayWanted(deltaSeconds) {
    for (const [id, state] of wanted.entries()) { const next = normalizeWantedState({ ...state, wantedScore: ageWantedScore(state.wantedScore, deltaSeconds) }); if (next.wantedScore <= 0 && next.bounty <= 0) wanted.delete(id); else wanted.set(id, next); }
  }

  function populationSnapshot(collections, playerPosition, context, deltaSeconds) {
    const normalized = normalizePopulationCollection(collections); const summary = summarizePopulation(normalized, playerPosition, context);
    const budget = chooseFrameBudget({ actorCount: normalized.length, mobile: context.mobile || context.pwa, near: summary.counts.near, distant: summary.counts.distant, far: summary.counts.far, requestedSpawn: context.requestedSpawn, requestedAmbient: context.requestedAmbient });
    const slice = chooseSimulationSlice(normalized, { maxTicks: budget.nearTicks + budget.distantTicks + budget.farTicks, playerPosition, lodThresholds: options.lodThresholds }, clockSeconds, lastTick);
    for (const row of slice.selected) lastTick.set(row.actor.id, clockSeconds);
    const spawnPool = rankSpawnCandidates(clampSpawnBatch(context.spawnCandidates ?? [], budget), normalized, { habitatScore: context.habitatScore, capacity: context.populationCapacity, blocked: context.spawnBlocked });
    const ambientPool = clampAmbientBatch(buildAmbientCandidates({ biome: context.biome, timeOfDay: context.timeOfDay, weather: context.weather, settlementDistanceMeters: context.distanceToSettlementMeters, currentCount: normalized.length, species: context.ambientSpecies, seed }), budget);
    const admittedAmbient = ambientPool.filter((candidate) => ambientAdmission(candidate, { density: candidate.density, distanceToSettlementMeters: context.distanceToSettlementMeters, insideSettlement: context.insideSettlement, onRoad: context.onRoad, waterTooDeep: context.waterTooDeep, slopeTooSteep: context.slopeTooSteep }).accepted).slice(0, budget.ambient);
    return freeze({ actorCount: normalized.length, summary, budget, slice: freeze({ selected: slice.selected.length, skipped: slice.skipped.length }), spawn: freeze(spawnPool), ambient: freeze(admittedAmbient), pressure: summary.pressure, audit: auditPopulationBudget({ actorCount: normalized.length, spawnCount: spawnPool.length, ambientCount: admittedAmbient.length }), deltaSeconds });
  }

  function placementSnapshot(candidates) {
    const audits = []; const accepted = []; for (const candidate of normalizePlacementCandidates(candidates)) {
      const source = validateAssetSource(candidate.asset); const meta = inspectAssetMetadata(candidate.asset);
      if (!source.ok) { audits.push(freeze({ id: candidate.id, accepted: false, stage: 'source', family: meta.family, reasons: source.reasons })); continue; }
      const result = executePlacementContract({ asset: candidate.asset, materialCore: options.materialCore, placementPipeline: options.placementPipeline, materialEvidence: candidate.materialEvidence, paletteId: candidate.paletteId, context: candidate.context });
      audits.push(freeze({ id: candidate.id, accepted: result.ok === true, family: meta.family, ...placementAudit(result) })); if (result.ok) accepted.push(freeze({ id: candidate.id, result, manifest: placementManifest(result) }));
    }
    return freeze({ requested: accepted.length, rejected: audits.filter((audit) => audit.accepted === false).length, requests: freeze(accepted), audits: freeze(audits), contract: ASSET_PLACEMENT_POLICY.id });
  }

  function settlementSnapshot(actors, settlements, context) {
    const rows = arr(actors).slice(0, 24).map((actor) => { const affinity = buildOccupationAffinity(actor, settlements); const preferred = choosePreferredSettlement(actor, settlements); return freeze({ actorId: actorId(actor), affinity, preferred, travel: buildTravelDirective(actor, preferred) }); });
    return freeze({ rows: freeze(rows), needs: roleNeedSummary(context), pressure: settlementPressure(context), audit: auditSettlementAffinity(rows.flatMap((row) => row.affinity)), fingerprint: deterministicSettlementFingerprint(rows, seed) });
  }

  function eventProjection(events) { return freeze(sortEvents(arr(events).map((event) => ({ ...event, deterministicKey: deterministicEventKey(event, replaySeed) })))); }

  function tick(input = {}) {
    if (disposed) return freeze({ accepted: false, reason: 'disposed', tick: tickCount });
    const deltaSeconds = Math.max(0, Math.min(SAFAK_KARTALI_DIRECTOR_POLICY.maxDeltaSeconds, num(input.deltaSeconds)));
    clockSeconds += deltaSeconds;
    const collections = input.collections ?? {}; const actors = flattenCollections(collections);
    const worldContext = normalizeWorldContext({ ...input.worldContext, mobile: input.mobile ?? input.worldContext?.mobile, pwa: input.pwa ?? input.worldContext?.pwa, spawnCandidates: input.spawnCandidates ?? input.worldContext?.spawnCandidates });
    const integration = integration.tick({ deltaSeconds, collections, occupations: input.occupations, faunaRequests: input.faunaRequests, eventContext: input.eventContext ?? worldContext, eventTypes: input.eventTypes, groups: input.groups, companions: input.companions, playerPosition: input.playerPosition, reactionOptions: input.reactionOptions });
    const memory = updateThreatMemory(actors, input.perceptionSignals, deltaSeconds); const crime = processCrime(input.crimeIncidents); decayWanted(deltaSeconds);
    const population = populationSnapshot(collections, input.playerPosition, worldContext, deltaSeconds); const placement = placementSnapshot(input.placementCandidates);
    const settlement = settlementSnapshot(actors, input.settlements, worldContext); const events = eventProjection([...(integration?.reaction?.events ?? []), ...arr(input.worldEvents)]);
    tickCount += 1;
    const frame = canonicalFrame({ tick: tickCount, timeSeconds: clockSeconds, director: { accepted: integration.accepted !== false, policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id }, population, threats: memory, crime, events });
    const replayFrame = replay.append(frame);
    const snapshot = freeze({ accepted: integration.accepted !== false, tick: tickCount, clockSeconds, integration, memory, targets: freeze(memory.flatMap((row) => { const list = memories.get(row.actorId) ?? []; return list.length ? [{ actorId: row.actorId, target: projectThreatForReaction(selectThreatTarget(list)?.memory) }] : []; })), crime, population, placement, settlement, wanted: freeze([...wanted.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([actorId, state]) => freeze({ actorId, ...state }))), events, replay: freeze({ frame: replayFrame, digest: replay.digest(), size: replay.size }), fingerprints: freeze({ director: fingerprint(frame, seed), population: deterministicPopulationFingerprint(population, seed), memory: deterministicMemoryFingerprint(memory, seed), crime: deterministicCrimeFingerprint(crime, seed) }), policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id });
    lastSnapshot = snapshot; return snapshot;
  }

  function audit() {
    const integrationAudit = integration.audit(); const populationAudit = auditPopulationBudget(lastSnapshot?.population ?? { actorCount: 0, spawnCount: 0, ambientCount: 0 }); const crimeAudit = auditCrimeProjection(lastSnapshot?.crime ?? { rows: [] }); const replayAudit = auditReplay(replay.read());
    const placementErrors = arr(lastSnapshot?.placement?.audits).filter((audit) => audit.accepted === false).map((audit) => `placement:${audit.id}`);
    const errors = [...(integrationAudit.errors ?? []), ...(populationAudit.errors ?? []), ...(crimeAudit.errors ?? []), ...(replayAudit.errors ?? []), ...placementErrors];
    return freeze({ ok: integrationAudit.ok && populationAudit.ok && crimeAudit.ok && replayAudit.ok && !placementErrors.length, errors: freeze(errors), tick: tickCount, replay: summarizeLedger(replay.read()), policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id });
  }
  function compareReplay(left, right) { return buildDeterminismEvidence(left, right); }
  function snapshot() { return freeze(lastSnapshot ?? { accepted: true, tick: 0, clockSeconds, policyId: SAFAK_KARTALI_DIRECTOR_POLICY.id }); }
  function readThreats(id) { return freeze((memories.get(String(id)) ?? []).map((memory) => projectThreatForReaction(memory))); }
  function readWanted(id) { return freeze({ ...(wanted.get(String(id)) ?? normalizeWantedState()) }); }
  function reset() { memories.clear(); wanted.clear(); lastTick.clear(); replay.clear(); tickCount = 0; clockSeconds = Math.max(0, num(options.clockSeconds)); lastSnapshot = null; return integration.snapshot?.() ?? true; }
  function dispose() { disposed = true; integration.dispose(); memories.clear(); wanted.clear(); return true; }
  return Object.freeze({ tick, audit, snapshot, readThreats, readWanted, compareReplay, reset, dispose, get replaySeed() { return replaySeed; }, get disposed() { return disposed; }, manifest: freeze({ policy: SAFAK_KARTALI_DIRECTOR_POLICY.id, authority: ['livingWorldReactionIntegrationAdapter', 'livingWorldReactionRuntime', 'livingWorldReactionPolicy', 'livingWorldDirectorRuntimeAdapter', 'livingWorldGroupDirectorAdapter', 'livingWorldOccupationSchedule', 'livingWorldEcologyPolicy', 'livingWorldEventDirectorAdapter'], sharedPlacement: [ASSET_PLACEMENT_POLICY.sharedMaterialModule, ASSET_PLACEMENT_POLICY.sharedPlacementModule], deterministic: true, replayFrames: REPLAY_POLICY.maxFrames }) });
}

export function auditLivingWorldDirector(result) { const errors = []; if (!result || result.accepted !== true) errors.push('not-accepted'); if (result?.policyId !== SAFAK_KARTALI_DIRECTOR_POLICY.id && result?.policyId != null) errors.push('policy-id'); if (result?.integration) { const audit = auditLivingWorldReactionIntegration(result.integration); errors.push(...audit.errors); } if (result?.population) errors.push(...auditPopulationBudget(result.population).errors); if (result?.crime) errors.push(...auditCrimeProjection(result.crime).errors); return freeze({ ok: !errors.length, errors: freeze(errors), fingerprint: fingerprint(result, 0) }); }
