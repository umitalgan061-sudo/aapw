import {
  LIVING_WORLD_REACTION_LEDGER_POLICY,
  auditLivingWorldReactionLedgerSnapshot,
  createLivingWorldReactionLedger,
  livingWorldReactionLedgerDigest,
  normalizeLivingWorldReactionTick,
  projectLivingWorldReactionEvents,
} from '../src/3d/gameplay/livingWorldReactionLedger.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}

function relation(overrides = {}) {
  return {
    actorFaction: overrides.actorFaction ?? 'watch',
    targetFaction: overrides.targetFaction ?? 'raider',
    reputation: overrides.reputation ?? -70,
    relation: overrides.relation ?? 'hostile',
    diplomaticRelation: overrides.diplomaticRelation ?? 'war',
    wanted: overrides.wanted ?? 70,
    crimeSeverity: overrides.crimeSeverity ?? 60,
    hostile: overrides.hostile ?? true,
    reportable: overrides.reportable ?? true,
  };
}

function reaction(overrides = {}) {
  const actorId = String(overrides.actorId ?? 'guard-1');
  const targetId = String(overrides.targetId ?? 'raider-1');
  const phase = overrides.phase ?? 'investigate';
  return {
    actorId,
    phase,
    targetId,
    lod: overrides.lod ?? 'near',
    elapsedInPhase: overrides.elapsedInPhase ?? 1,
    relation: overrides.relation ?? relation(),
    directive: overrides.directive ?? { kind: phase, targetId, destination: { x: 10, z: 20 }, speedMultiplier: 1 },
    occupation: overrides.occupation ?? null,
    navigation: overrides.navigation ?? { accepted: true, invoked: true, result: { internal: true } },
    combat: overrides.combat ?? { accepted: true, invoked: phase === 'attack', result: { internal: true } },
    law: overrides.law ?? { accepted: true, invoked: true, result: { internal: true } },
    worldEvent: overrides.worldEvent ?? { accepted: true, invoked: true, result: { internal: true } },
    signal: overrides.signal === undefined ? {
      id: 'signal-1',
      kind: 'contact',
      confidence: 0.95,
      distanceMeters: 10,
      bearingRadians: 0,
      ageSeconds: 0,
      audible: true,
      visible: true,
      suspicious: true,
      severity: 70,
      target: { id: targetId, position: { x: 10, z: 20 }, source: 'watch' },
    } : overrides.signal,
    cachedSignalCount: overrides.cachedSignalCount ?? 1,
    history: overrides.history ?? [{ from: 'patrol', to: phase, reason: 'perception-signal', targetId }],
    digest: overrides.digest ?? 'abcdef12',
  };
}

function tick(overrides = {}) {
  const results = overrides.results ?? [reaction(overrides)];
  return {
    accepted: overrides.accepted ?? true,
    tick: overrides.tick ?? 1,
    clockSeconds: overrides.clockSeconds ?? 1,
    actorCount: overrides.actorCount ?? results.length,
    simulatedActors: overrides.simulatedActors ?? results.length,
    results,
    stats: overrides.stats ?? { tickCount: 1, emittedEvents: 0, trackedActors: results.length },
    policyId: 'living-world-reaction-runtime-2026-09-08-v1',
    digest: overrides.digest ?? 'deadbeef',
  };
}

function quietTick(overrides = {}) {
  return tick({ ...overrides, phase: 'patrol', signal: null, history: [], relation: relation({ relation: 'neutral', hostile: false, reportable: false, reputation: 0, targetFaction: 'citizen', diplomaticRelation: 'peace', wanted: 0, crimeSeverity: 0 }), targetId: '', directive: null });
}

// 1. Top-level normalization is fail-closed and serializable.
{
  const result = normalizeLivingWorldReactionTick(null);
  assert(result.accepted === false, 'null tick is rejected');
  assert(result.results.length === 0, 'null tick has no reactions');
  assert(JSON.stringify(result).length > 0, 'null normalization is serializable');
  const empty = normalizeLivingWorldReactionTick({ accepted: true, results: [] });
  assert(empty.results.length === 0, 'empty accepted tick remains empty');
}

// 2. Invalid actor records disappear; valid actors survive.
{
  const result = normalizeLivingWorldReactionTick(tick({ results: [null, {}, reaction({ actorId: 'valid' })] }));
  assert(result.results.length === 1, 'invalid reactions are filtered');
  assert(result.results[0].actorId === 'valid', 'valid actor remains');
}

// 3. Runtime phase vocabulary is bounded.
{
  const result = normalizeLivingWorldReactionTick(tick({ phase: 'teleport' }));
  assert(result.results[0].phase === 'patrol', 'invalid phase becomes patrol');
  for (const phase of ['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee']) {
    const valid = normalizeLivingWorldReactionTick(tick({ phase }));
    assert(valid.results[0].phase === phase, `phase ${phase} is accepted`);
  }
}

// 4. Runtime LOD vocabulary is bounded.
{
  const invalid = normalizeLivingWorldReactionTick(tick({ lod: 'warp' }));
  assert(invalid.results[0].lod === 'near', 'invalid lod becomes near');
  for (const lod of ['near', 'distant', 'far', 'culled']) {
    const valid = normalizeLivingWorldReactionTick(tick({ lod }));
    assert(valid.results[0].lod === lod, `lod ${lod} is accepted`);
  }
}

// 5. Relation values are bounded.
{
  const result = normalizeLivingWorldReactionTick(tick({ relation: relation({ reputation: 999, wanted: 999, crimeSeverity: 999, relation: 'unknown' }) }));
  const r = result.results[0].relation;
  assert(r.reputation === 100, 'reputation caps at 100');
  assert(r.wanted === 100, 'wanted caps at 100');
  assert(r.crimeSeverity === 100, 'crime severity caps at 100');
  assert(r.relation === 'neutral', 'unknown relation becomes neutral');
}

// 6. Negative relationship values remain safely bounded.
{
  const result = normalizeLivingWorldReactionTick(tick({ relation: relation({ reputation: -999, wanted: -999, crimeSeverity: -999, relation: 'friendly', hostile: false, reportable: false }) }));
  const r = result.results[0].relation;
  assert(r.reputation === -100, 'reputation floors at -100');
  assert(r.wanted === 0, 'wanted floors at zero');
  assert(r.crimeSeverity === 0, 'crime severity floors at zero');
  assert(r.relation === 'friendly', 'friendly relation survives');
}

// 7. Directive coordinates reject non-finite input.
{
  const invalid = normalizeLivingWorldReactionTick(tick({ directive: { kind: 'chase', destination: { x: NaN, z: Infinity } } }));
  assert(invalid.results[0].directive.destination === null, 'non-finite destination is rejected');
}

// 8. Directive speed is bounded.
{
  const high = normalizeLivingWorldReactionTick(tick({ directive: { kind: 'chase', speedMultiplier: 99 } }));
  const low = normalizeLivingWorldReactionTick(tick({ directive: { kind: 'chase', speedMultiplier: -2 } }));
  assert(high.results[0].directive.speedMultiplier === 4, 'directive speed caps at four');
  assert(low.results[0].directive.speedMultiplier === 0, 'directive speed floors at zero');
}

// 9. Navigation/combat/law/event projections keep only owner-response facts.
{
  const result = normalizeLivingWorldReactionTick(tick({
    navigation: { accepted: false, invoked: true, result: { private: 'navigation-secret' } },
    combat: { accepted: false, invoked: true, result: { private: 'combat-secret' } },
    law: { accepted: false, invoked: true, result: { private: 'law-secret' } },
    worldEvent: { accepted: false, invoked: true, result: { private: 'event-secret' } },
  })).results[0];
  assert(result.navigation.accepted === false && result.navigation.invoked === true, 'navigation response is compacted');
  assert(result.combat.accepted === false && result.combat.invoked === true, 'combat response is compacted');
  assert(result.law.accepted === false && result.law.invoked === true, 'law response is compacted');
  assert(result.worldEvent.accepted === false && result.worldEvent.invoked === true, 'world-event response is compacted');
  assert(!JSON.stringify(result).includes('navigation-secret'), 'private navigation payload is not projected');
  assert(!JSON.stringify(result).includes('combat-secret'), 'private combat payload is not projected');
}

// 10. History is bounded to eight causal entries.
{
  const history = Array.from({ length: 20 }, (_, index) => ({ from: 'patrol', to: 'detect', reason: `r-${index}`, targetId: `t-${index}` }));
  const result = normalizeLivingWorldReactionTick(tick({ history })).results[0];
  assert(result.history.length === 8, 'history is capped at eight');
  assert(result.history[0].reason === 'r-12', 'history keeps newest entries');
  assert(result.history[7].targetId === 't-19', 'history keeps newest target identity');
}

// 11. Actor count normalization caps at 128.
{
  const many = Array.from({ length: 160 }, (_, index) => reaction({ actorId: `actor-${index}` }));
  const result = normalizeLivingWorldReactionTick(tick({ results: many }));
  assert(result.results.length === 128, 'actor result count caps at 128');
}

// 12. Projection is empty for rejected ticks.
{
  const events = projectLivingWorldReactionEvents(tick({ accepted: false }));
  assert(events.length === 0, 'rejected tick produces no projection');
}

// 13. Projection emits a reaction for active hostile state.
{
  const events = projectLivingWorldReactionEvents(tick({ phase: 'investigate' }));
  assert(events.some((event) => event.type === 'reaction'), 'active hostile phase emits reaction');
  assert(events.every((event) => event.actorId === 'guard-1'), 'actor identity is preserved');
}

// 14. Attack is represented as combat intent.
{
  const events = projectLivingWorldReactionEvents(tick({ phase: 'attack', history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }] }));
  const combat = events.find((event) => event.type === 'combat-intent');
  assert(combat != null, 'attack projects combat intent');
  assert(combat.phase === 'attack', 'combat intent carries attack phase');
}

// 15. Runtime history creates an explicit transition projection.
{
  const events = projectLivingWorldReactionEvents(tick({ history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }], phase: 'attack' }));
  const transition = events.find((event) => event.type === 'transition');
  assert(transition?.from === 'chase', 'transition carries source phase');
  assert(transition?.to === 'attack', 'transition carries destination phase');
  assert(transition?.reason === 'attack-window', 'transition carries runtime reason');
  assert(transition?.transitionEvidence === 'runtime-history', 'transition provenance is explicit');
}

// 16. Quiet patrol emits no events.
{
  const events = projectLivingWorldReactionEvents(quietTick());
  assert(events.length === 0, 'quiet patrol remains silent');
}

// 17. Reportable neutral relation is observable.
{
  const events = projectLivingWorldReactionEvents(quietTick({ relation: relation({ relation: 'neutral', hostile: false, reportable: true, reputation: 0, wanted: 90, crimeSeverity: 90 }) }));
  assert(events.length === 1, 'reportable patrol is observable');
  assert(events[0].reportable === true, 'reportable state survives');
}

// 18. Multiple reactions retain actor separation.
{
  const events = projectLivingWorldReactionEvents(tick({ results: [reaction({ actorId: 'a' }), reaction({ actorId: 'b' })] }));
  assert(new Set(events.map((event) => event.actorId)).size === 2, 'multiple actor identities remain distinct');
}

// 19. Standalone projection ordering is deterministic for equivalent input.
{
  const input = tick({ results: [reaction({ actorId: 'z' }), reaction({ actorId: 'a' })] });
  const first = projectLivingWorldReactionEvents(input);
  const second = projectLivingWorldReactionEvents(input);
  assert(JSON.stringify(first) === JSON.stringify(second), 'projection is repeatably deterministic');
}

// 20. Ledger accepts a valid tick and queues projected events.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick());
  assert(result.accepted === true, 'ledger accepts valid input');
  assert(result.events.length === 2, 'ledger exposes reaction and transition');
  assert(result.snapshot.queuedEvents === 2, 'ledger queues projected events');
  assert(result.snapshot.trackedActors === 1, 'ledger tracks actor projection');
}

// 21. Equivalent ingestion within dedupe TTL does not grow the queue.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick({ clockSeconds: 1 }));
  const result = ledger.ingest(tick({ tick: 2, clockSeconds: 1.5 }));
  assert(result.events.length === 0, 'duplicate event set is suppressed within TTL');
  assert(ledger.snapshot().duplicateEvents >= 2, 'duplicate counter records suppressed projections');
  assert(ledger.snapshot().queuedEvents === 2, 'dedupe prevents queue growth');
}

// 22. Equivalent content after the TTL becomes observable again.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick({ clockSeconds: 1 }));
  const result = ledger.ingest(tick({ tick: 2, clockSeconds: 4 }));
  assert(result.events.length > 0, 'same reaction can reappear after dedupe TTL');
}

// 23. Different actor identities are not cross-deduped.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(tick({ actorId: 'a', clockSeconds: 1 }));
  const second = ledger.ingest(tick({ actorId: 'b', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'different actors produce independent projections');
}

// 24. Different target identities are observable.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(tick({ targetId: 'a', clockSeconds: 1 }));
  const second = ledger.ingest(tick({ targetId: 'b', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'target changes produce distinct event keys');
}

// 25. LOD changes are not hidden by dedupe because LOD is part of reaction identity.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(tick({ lod: 'near', clockSeconds: 1 }));
  const second = ledger.ingest(tick({ lod: 'distant', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'LOD changes remain observable');
}

// 26. Runtime digest changes are respected by the event key.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(tick({ digest: 'aaaaaaaa', clockSeconds: 1 }));
  const second = ledger.ingest(tick({ digest: 'bbbbbbbb', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'distinct runtime digests remain observable');
}

// 27. Actor event budget is bounded.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxEventsPerActor: 2, dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ clockSeconds: 1 }));
  const result = ledger.ingest(tick({ clockSeconds: 5, tick: 2 }));
  assert(result.events.length <= 2, 'per-actor queue budget is bounded');
  assert(ledger.snapshot().queuedEvents <= 2, 'queue does not exceed actor budget for one actor');
}

// 28. Global queue budget is bounded and drops are visible.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxQueueEntries: 4, maxEventsPerActor: 6, dedupeTtlSeconds: 0 } });
  for (let index = 0; index < 8; index += 1) {
    ledger.ingest(tick({ actorId: `guard-${index}`, targetId: `target-${index}`, clockSeconds: index * 4 + 1, tick: index + 1 }));
  }
  const snapshot = ledger.snapshot();
  assert(snapshot.queuedEvents <= 4, 'global queue cap is enforced');
  assert(snapshot.droppedEvents > 0, 'global queue drops are accounted for');
}

// 29. Age budget removes stale queue entries.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxAgeSeconds: 3, dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ clockSeconds: 1 }));
  ledger.ingest(tick({ actorId: 'later', clockSeconds: 5 }));
  const snapshot = ledger.snapshot();
  assert(snapshot.queue.every((event) => snapshot.clockSeconds - event.clockSeconds <= 3), 'stale events are purged by age');
  assert(snapshot.trackedActors === 2, 'actor projections survive queue expiry');
}

// 30. Drain respects the caller limit.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  const one = ledger.drain(1);
  const rest = ledger.drain(99);
  assert(one.length === 1, 'drain obeys limit');
  assert(rest.length === 1, 'drain returns remaining event');
  assert(ledger.drain(99).length === 0, 'empty drain is empty');
}

// 31. Negative drain is a no-op.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  assert(ledger.drain(-1).length === 0, 'negative drain does not remove events');
  assert(ledger.snapshot().queuedEvents === 2, 'negative drain preserves queue');
}

// 32. Dispose clears state and refuses new ingestion.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  assert(ledger.dispose() === true, 'dispose returns true');
  const result = ledger.ingest(tick({ clockSeconds: 2 }));
  assert(result.accepted === false && result.reason === 'disposed', 'disposed ledger rejects ingestion');
  assert(ledger.snapshot().queuedEvents === 0, 'dispose clears queue');
  assert(ledger.snapshot().trackedActors === 0, 'dispose clears actor state');
}

// 33. Reset returns a ledger to a fresh usable state.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  assert(ledger.reset() === true, 'reset returns true');
  assert(ledger.snapshot().queuedEvents === 0, 'reset clears queue');
  assert(ledger.snapshot().trackedActors === 0, 'reset clears actor state');
  assert(ledger.ingest(tick()).accepted === true, 'reset leaves ledger usable');
}

// 34. Actor snapshots are sorted by stable identity.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ results: [reaction({ actorId: 'z' }), reaction({ actorId: 'a' }), reaction({ actorId: 'm' })] }));
  const ids = ledger.snapshot().actors.map((actor) => actor.actorId);
  assert(ids.join(',') === 'a,m,z', 'actor snapshots sort lexicographically');
}

// 35. Projection snapshots expose stable actor fields.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  const actor = ledger.snapshot().actors[0];
  for (const field of ['actorId', 'phase', 'targetId', 'lod', 'relation', 'directiveKind', 'hasSignal', 'cachedSignalCount', 'clockSeconds']) {
    assert(Object.hasOwn(actor, field), `actor snapshot contains ${field}`);
  }
}

// 36. Snapshot is immutable.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  const snapshot = ledger.snapshot();
  assert(Object.isFrozen(snapshot), 'snapshot object is frozen');
  assert(Object.isFrozen(snapshot.queue), 'snapshot queue is frozen');
  assert(Object.isFrozen(snapshot.actors), 'snapshot actors are frozen');
  assert(Object.isFrozen(snapshot.queue[0]), 'snapshot event is frozen');
}

// 37. Ingestion response is immutable.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick());
  assert(Object.isFrozen(result), 'ingest response is frozen');
  assert(Object.isFrozen(result.events), 'ingest events are frozen');
  assert(Object.isFrozen(result.snapshot), 'ingest snapshot is frozen');
}

// 38. Audit accepts a healthy ledger.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  const audit = ledger.audit();
  assert(audit.ok === true, 'healthy ledger audit passes');
  assert(audit.errors.length === 0, 'healthy ledger has no audit errors');
}

// 39. Standalone audit rejects malformed queue/event data.
{
  const result = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 999,
    trackedActors: 1,
    clockSeconds: -1,
    actors: [{ actorId: 'broken', phase: 'warp', lod: 'warp', cachedSignalCount: 13 }],
    queue: [{ actorId: 'broken', type: 'warp', phase: 'warp', lod: 'warp', clockSeconds: -1 }],
  });
  assert(result.ok === false, 'malformed snapshot is rejected');
  assert(result.errors.includes('queue-overflow'), 'queue overflow is reported');
  assert(result.errors.includes('invalid-clock'), 'invalid clock is reported');
  assert(result.errors.includes('invalid-event-type:broken'), 'invalid event type is reported');
  assert(result.errors.includes('invalid-event-phase:broken'), 'invalid event phase is reported');
}

// 40. Maximum valid bounds pass the standalone audit.
{
  const queue = Array.from({ length: 96 }, (_, index) => ({ actorId: `a-${index}`, type: 'reaction', phase: 'investigate', lod: 'near', clockSeconds: index }));
  const result = auditLivingWorldReactionLedgerSnapshot({ queuedEvents: 96, trackedActors: 96, clockSeconds: 96, actors: [], queue });
  assert(result.ok === true, 'maximum queue audit passes');
}

// 41. Actor overflow is rejected.
{
  const result = auditLivingWorldReactionLedgerSnapshot({ queuedEvents: 0, trackedActors: 129, clockSeconds: 1, actors: [], queue: [] });
  assert(result.ok === false && result.errors.includes('actor-overflow'), 'actor overflow is rejected');
}

// 42. Signal cache overflow is rejected.
{
  const result = auditLivingWorldReactionLedgerSnapshot({ queuedEvents: 0, trackedActors: 1, clockSeconds: 1, actors: [{ actorId: 'a', phase: 'patrol', lod: 'near', cachedSignalCount: 13 }], queue: [] });
  assert(result.ok === false && result.errors.includes('signal-overflow:a'), 'signal overflow is rejected');
}

// 43. Sequence numbers are transport metadata; canonical digest need not depend on them.
{
  const first = projectLivingWorldReactionEvents(tick()).map(({ sequence, ...event }) => event);
  const second = projectLivingWorldReactionEvents(tick()).map(({ sequence, ...event }) => event);
  assert(JSON.stringify(first) === JSON.stringify(second), 'sequence-stripped event projections remain deterministic');
}

// 44. Ledger snapshot digest is self-consistent through its canonical inputs.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick());
  const snapshot = ledger.snapshot();
  const expected = livingWorldReactionLedgerDigest({
    acceptedTicks: snapshot.acceptedTicks,
    rejectedTicks: snapshot.rejectedTicks,
    projectedEvents: snapshot.projectedEvents,
    droppedEvents: snapshot.droppedEvents,
    duplicateEvents: snapshot.duplicateEvents,
    queue: snapshot.queue,
    actors: snapshot.actors,
  });
  assert(expected === snapshot.digest, 'snapshot digest matches canonical digest inputs');
}

// 45. Digest helper is pure and stable on equivalent values.
{
  const a = livingWorldReactionLedgerDigest({ actorId: 'guard', phase: 'attack', targetId: 'raider' });
  const b = livingWorldReactionLedgerDigest({ actorId: 'guard', phase: 'attack', targetId: 'raider' });
  assert(a === b, 'digest is stable for equal values');
  assert(/^[0-9a-f]{8}$/.test(a), 'digest is fixed-width lowercase hex');
}

// 46. Digest helper changes on meaningful identity.
{
  const a = livingWorldReactionLedgerDigest({ actorId: 'guard', phase: 'attack', targetId: 'raider' });
  const b = livingWorldReactionLedgerDigest({ actorId: 'guard', phase: 'attack', targetId: 'citizen' });
  assert(a !== b, 'digest changes when target identity changes');
}

// 47. Reset clears dedupe memory.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick({ clockSeconds: 1 }));
  ledger.reset();
  const result = ledger.ingest(tick({ clockSeconds: 1 }));
  assert(result.events.length === 2, 'reset clears dedupe memory');
}

// 48. Stale clocks do not move ledger time backwards.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ clockSeconds: 10 }));
  ledger.ingest(tick({ actorId: 'older', clockSeconds: 5 }));
  assert(ledger.snapshot().clockSeconds === 10, 'ledger clock remains monotonic');
}

// 49. Long-frame 128-actor stress remains bounded.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  for (let tickIndex = 0; tickIndex < 20; tickIndex += 1) {
    const results = Array.from({ length: 128 }, (_, actorIndex) => reaction({ actorId: `stress-${actorIndex}`, targetId: `target-${tickIndex}-${actorIndex}`, phase: actorIndex % 4 === 0 ? 'attack' : 'investigate', history: [{ from: 'patrol', to: actorIndex % 4 === 0 ? 'attack' : 'investigate', reason: 'stress', targetId: `target-${tickIndex}-${actorIndex}` }] }));
    ledger.ingest(tick({ tick: tickIndex + 1, clockSeconds: tickIndex * 4 + 1, results }));
  }
  const snapshot = ledger.snapshot();
  assert(snapshot.trackedActors <= 128, 'stress actor count remains bounded');
  assert(snapshot.queuedEvents <= 96, 'stress queue remains bounded');
  assert(snapshot.droppedEvents > 0, 'stress records bounded drops');
  assert(ledger.audit().ok, 'stress ledger remains auditable');
}

// 50. Independent ledger instances do not share mutable state.
{
  const first = createLivingWorldReactionLedger();
  const second = createLivingWorldReactionLedger();
  first.ingest(tick());
  assert(second.snapshot().queuedEvents === 0, 'queues are instance-local');
  assert(second.snapshot().trackedActors === 0, 'actor projections are instance-local');
}

// 51. Invalid accepted=false input never creates state.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(tick({ accepted: false }));
  const snapshot = ledger.snapshot();
  assert(snapshot.rejectedTicks === 1, 'rejected tick counter increments');
  assert(snapshot.trackedActors === 0, 'rejected tick creates no actors');
}

// 52. Empty accepted ticks create no queue entries.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick({ results: [], actorCount: 0, simulatedActors: 0 }));
  assert(result.accepted === true, 'empty accepted tick is accepted');
  assert(result.events.length === 0, 'empty accepted tick emits no events');
  assert(ledger.snapshot().queuedEvents === 0, 'empty accepted tick leaves queue empty');
}

// 53. Quiet actor remains trackable without event noise.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(quietTick());
  const snapshot = ledger.snapshot();
  assert(snapshot.trackedActors === 1, 'quiet actor is tracked');
  assert(snapshot.queuedEvents === 0, 'quiet actor creates no events');
}

// 54. Actor target changes are visible in snapshot state.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ targetId: 'first' }));
  ledger.ingest(tick({ targetId: 'second', clockSeconds: 4 }));
  const actor = ledger.snapshot().actors.find((entry) => entry.actorId === 'guard-1');
  assert(actor.targetId === 'second', 'latest target is reflected in actor projection');
}

// 55. Phase changes mark actor projections.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ phase: 'investigate', history: [] }));
  ledger.ingest(tick({ phase: 'chase', history: [{ from: 'investigate', to: 'chase', reason: 'threat-confirmed', targetId: 'raider-1' }], clockSeconds: 4 }));
  const actor = ledger.snapshot().actors[0];
  assert(actor.phase === 'chase', 'phase advances to chase');
  assert(actor.previousPhase === 'investigate', 'previous phase is retained');
  assert(actor.changed === true, 'phase change flag is set');
}

// 56. Transition observation from previous phase provides fallback causal evidence.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({ phase: 'investigate', history: [] }));
  const result = ledger.ingest(tick({ phase: 'chase', history: [], clockSeconds: 4 }));
  assert(result.events.some((event) => event.type === 'transition' && event.reason === 'projection-observed-change'), 'phase change yields fallback transition evidence');
}

// 57. Runtime history is preferred over synthetic transition evidence.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick({ phase: 'attack', history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }] }));
  const transition = result.events.find((event) => event.type === 'transition');
  assert(transition.reason === 'attack-window', 'runtime history reason is preferred');
}

// 58. Event keys remain non-empty and stable.
{
  const events = projectLivingWorldReactionEvents(tick());
  assert(events.every((event) => typeof event.key === 'string' && event.key.length > 0), 'projected events have stable keys');
}

// 59. Transition keys encode identity and causal phase information.
{
  const events = projectLivingWorldReactionEvents(tick({ phase: 'attack', history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }] }));
  const transition = events.find((event) => event.type === 'transition');
  assert(transition.key.includes('guard-1'), 'transition key includes actor identity');
  assert(transition.key.includes('chase'), 'transition key includes source phase');
  assert(transition.key.includes('attack'), 'transition key includes destination phase');
}

// 60. Event priority is stable: combat before transition before generic reaction.
{
  const events = projectLivingWorldReactionEvents(tick({ phase: 'attack', history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }] }));
  assert(events[0].type === 'combat-intent', 'combat intent has highest projection priority');
  assert(events.some((event) => event.type === 'transition'), 'transition remains projected');
}

// 61. Maximum signal count remains accepted by the reaction contract.
{
  const normalized = normalizeLivingWorldReactionTick(tick({ cachedSignalCount: 12 }));
  assert(normalized.results[0].cachedSignalCount === 12, 'maximum signal count is accepted');
  const audited = auditLivingWorldReactionLedgerSnapshot({ queuedEvents: 0, trackedActors: 1, clockSeconds: 1, actors: [{ actorId: 'a', phase: 'patrol', lod: 'near', cachedSignalCount: 12 }], queue: [] });
  assert(audited.ok === true, 'maximum signal count passes snapshot audit');
}

// 62. Numeric identities become stable strings.
{
  const normalized = normalizeLivingWorldReactionTick(tick({ actorId: 42, targetId: 99 }));
  assert(normalized.results[0].actorId === '42', 'numeric actor id becomes string');
  assert(normalized.results[0].targetId === '99', 'numeric target id becomes string');
}

// 63. Source tick object is not mutated by normalization.
{
  const source = tick();
  const before = JSON.stringify(source);
  normalizeLivingWorldReactionTick(source);
  assert(before === JSON.stringify(source), 'normalization is non-mutating');
}

// 64. Projection is non-mutating.
{
  const source = tick();
  const before = JSON.stringify(source);
  projectLivingWorldReactionEvents(source);
  assert(before === JSON.stringify(source), 'projection is non-mutating');
}

// 65. Ledger public API intentionally omits EventBus methods.
{
  const ledger = createLivingWorldReactionLedger();
  assert(typeof ledger.publish === 'undefined', 'ledger has no publish method');
  assert(typeof ledger.emit === 'undefined', 'ledger has no emit method');
  assert(typeof ledger.dispatch === 'undefined', 'ledger has no dispatch method');
}

// 66. Ledger lifecycle surface is narrow.
{
  const methods = Object.keys(createLivingWorldReactionLedger()).sort().join(',');
  assert(methods === 'audit,dispose,drain,ingest,reset,snapshot', 'ledger exposes only state/projection lifecycle methods');
}

// 67. Policy is frozen and explicit about its bounded contract.
{
  assert(Object.isFrozen(LIVING_WORLD_REACTION_LEDGER_POLICY), 'policy is frozen');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.deterministic === true, 'policy declares determinism');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxQueueEntries === 96, 'policy queue cap is 96');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxEventsPerActor === 6, 'policy actor event cap is six');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxActors === 128, 'policy actor cap is 128');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxHistoryPerActor === 8, 'policy history cap is eight');
}

// 68. Audit digest is deterministic on equal states.
{
  const run = () => {
    const ledger = createLivingWorldReactionLedger();
    ledger.ingest(tick());
    return ledger.audit().digest;
  };
  assert(run() === run(), 'audit digest is deterministic across equal ledgers');
}

// 69. Multiple reset cycles remain stable.
{
  const ledger = createLivingWorldReactionLedger();
  for (let index = 0; index < 12; index += 1) {
    ledger.ingest(tick({ clockSeconds: index + 1, tick: index + 1 }));
    ledger.drain(2);
    ledger.reset();
  }
  assert(ledger.snapshot().queuedEvents === 0, 'reset cycles clear queue');
  assert(ledger.snapshot().trackedActors === 0, 'reset cycles clear actors');
  assert(ledger.audit().ok, 'reset cycles preserve auditability');
}

// 70. Final end-to-end contract binds normalization, projection, ledger and audit.
{
  const runtime = normalizeLivingWorldReactionTick(tick({ tick: 77, clockSeconds: 7.7 }));
  const events = projectLivingWorldReactionEvents(runtime);
  const ledger = createLivingWorldReactionLedger();
  const ingested = ledger.ingest(runtime);
  assert(runtime.accepted === true, 'normalized runtime result is accepted');
  assert(events.length === ingested.events.length, 'standalone and ledger projection counts agree');
  assert(ledger.audit().ok, 'end-to-end ledger audit passes');
  assert(Number.isFinite(ledger.snapshot().clockSeconds), 'end-to-end ledger clock is finite');
}

if (failures.length) {
  console.error(`[living-world-reaction-ledger] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[living-world-reaction-ledger] PASS: ${passed} assertions.`);
