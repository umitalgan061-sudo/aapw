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

function tick(overrides = {}) {
  return {
    accepted: true,
    tick: overrides.tick ?? 1,
    clockSeconds: overrides.clockSeconds ?? 1,
    actorCount: overrides.results?.length ?? 1,
    simulatedActors: overrides.results?.length ?? 1,
    results: overrides.results ?? [],
    stats: overrides.stats ?? { tickCount: 1, emittedEvents: 0, trackedActors: overrides.results?.length ?? 0 },
    policyId: 'living-world-reaction-runtime-2026-09-08-v1',
    digest: overrides.digest ?? 'deadbeef',
  };
}

function reaction(overrides = {}) {
  return {
    actorId: overrides.actorId ?? 'guard-1',
    phase: overrides.phase ?? 'investigate',
    targetId: overrides.targetId ?? 'raider-1',
    lod: overrides.lod ?? 'near',
    elapsedInPhase: overrides.elapsedInPhase ?? 0.5,
    relation: overrides.relation ?? {
      actorFaction: 'watch',
      targetFaction: 'raider',
      reputation: -60,
      relation: 'hostile',
      diplomaticRelation: 'war',
      wanted: 70,
      crimeSeverity: 80,
      hostile: true,
      reportable: true,
    },
    directive: overrides.directive ?? {
      kind: 'investigate',
      targetId: overrides.targetId ?? 'raider-1',
      destination: { x: 10, z: 20 },
      radiusMeters: 8,
      speedMultiplier: 1,
      investigate: true,
    },
    occupation: overrides.occupation ?? null,
    navigation: overrides.navigation ?? { accepted: true, invoked: true },
    combat: overrides.combat ?? { accepted: true, invoked: false },
    law: overrides.law ?? { accepted: true, invoked: true },
    worldEvent: overrides.worldEvent ?? { accepted: true, invoked: true },
    signal: overrides.signal ?? {
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
      target: { id: overrides.targetId ?? 'raider-1', position: { x: 10, z: 20 }, source: 'guard' },
    },
    cachedSignalCount: overrides.cachedSignalCount ?? 1,
    history: overrides.history ?? [{ from: 'patrol', to: 'detect', reason: 'perception-signal', targetId: 'raider-1' }],
    digest: overrides.digest ?? 'abcdef12',
  };
}

function hostileTick(overrides = {}) {
  return tick({
    tick: overrides.tick ?? 1,
    clockSeconds: overrides.clockSeconds ?? 1,
    results: [reaction(overrides)],
    stats: overrides.stats,
  });
}

// 1. Public normalization never lets malformed top-level values escape.
{
  const empty = normalizeLivingWorldReactionTick(null);
  assert(empty.accepted === false, 'null tick is rejected');
  assert(empty.results.length === 0, 'null tick has no results');
  assert(empty.clockSeconds === 0, 'null tick clock falls back to zero');

  const malformed = normalizeLivingWorldReactionTick({ accepted: true, results: [null, 4, {}] });
  assert(malformed.accepted === true, 'accepted malformed wrapper remains accepted');
  assert(malformed.results.length === 0, 'invalid reaction entries are discarded');
  assert(malformed.actorCount === 0, 'empty normalized result reports zero actors');

  const oversized = normalizeLivingWorldReactionTick({
    accepted: true,
    results: Array.from({ length: 200 }, (_, index) => reaction({ actorId: `actor-${index}` })),
  });
  assert(oversized.results.length === 128, 'normalized tick caps actor results at runtime ledger ceiling');
  assert(oversized.results[0].actorId === 'actor-0', 'normalization keeps deterministic insertion order before projection');
  assert(oversized.results[127].actorId === 'actor-127', 'normalization truncates at exactly 128 actors');
}

// 2. Invalid phases/LODs are fail-closed to safe defaults rather than leaking arbitrary strings.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({ phase: 'not-a-phase', lod: 'bogus-lod' }));
  assert(normalized.results[0].phase === 'patrol', 'invalid phase normalizes to patrol');
  assert(normalized.results[0].lod === 'near', 'invalid LOD normalizes to near');
}

// 3. Relation fields remain bounded and structurally stable.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    relation: {
      actorFaction: null,
      targetFaction: null,
      reputation: 9000,
      relation: 'not-a-relation',
      diplomaticRelation: null,
      wanted: -9000,
      crimeSeverity: 9000,
      hostile: 1,
      reportable: 0,
    },
  }));
  const relation = normalized.results[0].relation;
  assert(relation.reputation === 100, 'reputation clamps to +100');
  assert(relation.wanted === 0, 'wanted clamps to zero');
  assert(relation.crimeSeverity === 100, 'crime severity clamps to +100');
  assert(relation.relation === 'neutral', 'unknown relation normalizes to neutral');
  assert(relation.hostile === true, 'boolean relation hostile is preserved');
  assert(relation.reportable === false, 'boolean relation reportable is preserved');
}

// 4. Directive normalization retains actionable information while sanitizing coordinates.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    directive: {
      kind: null,
      targetId: null,
      destination: { x: 4, z: 6 },
      speedMultiplier: 99,
      radiusMeters: -3,
      activityId: null,
      locationId: null,
      investigate: 1,
    },
  }));
  const directive = normalized.results[0].directive;
  assert(directive.kind === 'patrol', 'missing directive kind falls back to patrol');
  assert(directive.destination.x === 4 && directive.destination.z === 6, 'finite destination survives normalization');
  assert(directive.speedMultiplier === 4, 'speed multiplier respects hard upper bound');
  assert(directive.radiusMeters === 0, 'radius is clamped to non-negative');
  assert(directive.investigate === true, 'boolean investigate flag is normalized');
}

// 5. Non-finite destinations never become downstream coordinates.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    directive: { kind: 'chase', destination: { x: NaN, z: Infinity }, targetId: 'raider-1' },
  }));
  assert(normalized.results[0].directive.destination === null, 'non-finite destination fails closed');
}

// 6. History is bounded and causal fields remain available.
{
  const longHistory = Array.from({ length: 40 }, (_, index) => ({
    from: index % 2 ? 'detect' : 'patrol',
    to: index % 2 ? 'patrol' : 'detect',
    reason: `reason-${index}`,
    targetId: `target-${index}`,
  }));
  const normalized = normalizeLivingWorldReactionTick(hostileTick({ history: longHistory }));
  assert(normalized.results[0].history.length === 8, 'history is retained only within the eight-entry cap');
  assert(normalized.results[0].history[0].reason === 'reason-32', 'history keeps the newest causal evidence');
  assert(normalized.results[0].history[7].targetId === 'target-39', 'history keeps newest target identity');
}

// 7. Projection is empty for rejected ticks and never invents events.
{
  assert(projectLivingWorldReactionEvents({ accepted: false }).length === 0, 'rejected tick projects no events');
  assert(projectLivingWorldReactionEvents({ accepted: true, results: [] }).length === 0, 'accepted empty tick projects no events');
}

// 8. Hostile reaction yields the reaction and runtime-history transition projections.
{
  const events = projectLivingWorldReactionEvents(hostileTick());
  assert(events.length === 2, 'hostile transition yields reaction plus transition events');
  assert(events.some((event) => event.type === 'reaction'), 'projection contains reaction event');
  assert(events.some((event) => event.type === 'transition'), 'projection contains transition event');
  const transition = events.find((event) => event.type === 'transition');
  assert(transition.from === 'patrol', 'transition carries causal source phase');
  assert(transition.to === 'investigate', 'transition carries causal destination phase');
  assert(transition.transitionEvidence === 'runtime-history', 'transition explicitly records runtime history provenance');
}

// 9. Attack phase is represented as combat-intent without mutating ownership.
{
  const events = projectLivingWorldReactionEvents(hostileTick({ phase: 'attack', history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }] }));
  assert(events.some((event) => event.type === 'combat-intent'), 'attack phase projects combat-intent');
  assert(events.every((event) => event.actorId === 'guard-1'), 'projection preserves actor identity');
}

// 10. Patrol with no hostile/reportable relation remains quiet.
{
  const events = projectLivingWorldReactionEvents(hostileTick({
    phase: 'patrol',
    relation: {
      actorFaction: 'watch',
      targetFaction: 'civilian',
      reputation: 0,
      relation: 'neutral',
      diplomaticRelation: 'unknown',
      wanted: 0,
      crimeSeverity: 0,
      hostile: false,
      reportable: false,
    },
    history: [],
    signal: null,
    targetId: '',
  }));
  assert(events.length === 0, 'quiet patrol produces no projection events');
}

// 11. Friendly but suspicious reactions remain visible because the runtime explicitly returned a non-patrol phase.
{
  const events = projectLivingWorldReactionEvents(hostileTick({
    relation: {
      actorFaction: 'watch',
      targetFaction: 'merchant',
      reputation: 50,
      relation: 'friendly',
      diplomaticRelation: 'allied',
      wanted: 0,
      crimeSeverity: 0,
      hostile: false,
      reportable: false,
    },
    history: [],
    phase: 'investigate',
  }));
  assert(events.length === 1, 'non-patrol friendly investigation remains observable');
  assert(events[0].relation === 'friendly', 'friendly relation label survives projection');
}

// 12. Queue ingestion is bounded and deterministic.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(hostileTick({ tick: 7, clockSeconds: 7 }));
  const snapshot = result.snapshot;
  assert(result.accepted === true, 'ledger accepts a valid reaction tick');
  assert(result.events.length === 2, 'ledger returns projected events for a hostile tick');
  assert(snapshot.queuedEvents === 2, 'ledger queues both projected events');
  assert(snapshot.trackedActors === 1, 'ledger tracks one actor');
  assert(snapshot.acceptedTicks === 1, 'ledger increments accepted tick count');
  assert(snapshot.rejectedTicks === 0, 'valid tick does not increment rejected count');
}

// 13. Duplicate ingestion inside the dedupe TTL never emits duplicate queue entries.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
  const second = ledger.ingest(hostileTick({ tick: 2, clockSeconds: 1.5 }));
  assert(first.events.length === 2, 'first ingestion returns two events');
  assert(second.events.length === 0, 'second equivalent ingestion is deduplicated');
  const snapshot = ledger.snapshot();
  assert(snapshot.duplicateEvents >= 2, 'duplicate accounting records both repeated projections');
  assert(snapshot.queuedEvents === 2, 'dedupe prevents queue growth');
}

// 14. Identical content after the dedupe TTL becomes observable again.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
  const later = ledger.ingest(hostileTick({ tick: 2, clockSeconds: 4 }));
  assert(later.events.length > 0, 'equivalent reaction after dedupe TTL becomes visible again');
}

// 15. Event ordering is stable: combat-intent outranks transition, which outranks generic reaction.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick({
    tick: 20,
    clockSeconds: 20,
    results: [
      reaction({ actorId: 'zeta', phase: 'investigate', history: [{ from: 'patrol', to: 'investigate', reason: 'perception-signal', targetId: 'b' }] }),
      reaction({ actorId: 'alpha', phase: 'attack', history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'a' }] }),
    ],
  }));
  const types = result.events.map((event) => event.type);
  assert(types[0] === 'combat-intent', 'combat intent sorts ahead of other event types');
  assert(types[1] === 'combat-intent' || types[1] === 'transition', 'next event preserves defined priority ordering');
  assert(result.events.map((event) => event.key).every(Boolean), 'all events receive stable non-empty keys');
}

// 16. Actor-level event budget limits repeated noise without dropping all actors.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxEventsPerActor: 2 } });
  ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
  const second = ledger.ingest(hostileTick({ tick: 2, clockSeconds: 5 }));
  assert(second.events.length <= 2, 'actor event budget caps repeated event volume');
  assert(ledger.snapshot().droppedEvents >= 0, 'bounded actor volume is accounted for even when no drop is required');
}

// 17. Global queue cap keeps newest events and accounts for dropped history.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxQueueEntries: 4, maxEventsPerActor: 6, dedupeTtlSeconds: 0 } });
  for (let index = 0; index < 8; index += 1) {
    ledger.ingest(hostileTick({ tick: index + 1, clockSeconds: index * 5 + 1, actorId: `guard-${index % 4}`, targetId: `target-${index}` }));
  }
  const snapshot = ledger.snapshot();
  assert(snapshot.queuedEvents <= 4, 'queue never exceeds configured cap');
  assert(snapshot.droppedEvents >= 1, 'queue truncation is accounted for');
}

// 18. Age-based expiry removes stale queue entries but leaves actor projections intact.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxAgeSeconds: 3, dedupeTtlSeconds: 0 } });
  ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
  ledger.ingest(hostileTick({ tick: 2, clockSeconds: 5, actorId: 'other-guard', targetId: 'other-target' }));
  const snapshot = ledger.snapshot();
  assert(snapshot.queuedEvents >= 1, 'fresh event survives age purge');
  assert(snapshot.trackedActors === 2, 'actor projection remains tracked after queue expiry');
}

// 19. Drain is bounded, idempotent on empty queues, and ordered.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
  const drained = ledger.drain(1);
  assert(drained.length === 1, 'drain respects caller limit');
  assert(ledger.snapshot().queuedEvents === 1, 'drain removes only requested number of events');
  const rest = ledger.drain(99);
  assert(rest.length === 1, 'second drain returns remaining event');
  assert(ledger.drain(99).length === 0, 'empty queue drains to empty array');
}

// 20. Zero and negative drain limits are safe.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  assert(ledger.drain(-10).length === 0, 'negative drain does nothing');
  assert(ledger.snapshot().queuedEvents === 2, 'negative drain does not remove queue entries');
}

// 21. Disposed ledger refuses future ingestion and returns no queue entries.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  assert(ledger.dispose() === true, 'dispose returns true');
  const result = ledger.ingest(hostileTick({ tick: 2, clockSeconds: 2 }));
  assert(result.accepted === false, 'disposed ledger rejects ingestion');
  assert(result.reason === 'disposed', 'disposed ingestion reports explicit reason');
  assert(ledger.snapshot().queuedEvents === 0, 'dispose clears queued projections');
  assert(ledger.disposed === true, 'disposed flag becomes observable');
}

// 22. Reset returns the ledger to a fresh usable state.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  assert(ledger.reset() === true, 'reset returns true');
  const snapshot = ledger.snapshot();
  assert(snapshot.acceptedTicks === 0, 'reset clears accepted tick count');
  assert(snapshot.projectedEvents === 0, 'reset clears projection counters');
  assert(snapshot.queuedEvents === 0, 'reset clears queue');
  assert(snapshot.trackedActors === 0, 'reset clears actor projections');
  const acceptedAgain = ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
  assert(acceptedAgain.accepted === true, 'reset leaves ledger usable');
}

// 23. Snapshot actor projections are deterministic and sorted by stable actor id.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(tick({
    tick: 1,
    clockSeconds: 1,
    results: [reaction({ actorId: 'zulu' }), reaction({ actorId: 'alpha' }), reaction({ actorId: 'mike' })],
  }));
  const ids = ledger.snapshot().actors.map((actor) => actor.actorId);
  assert(ids.join(',') === 'alpha,mike,zulu', 'actor projections sort lexicographically by stable identity');
  assert(ledger.snapshot().actors.every((actor) => actor.previousPhase !== undefined), 'actor projection retains previous phase field');
}

// 24. Actor phase changes are observed as transitions exactly once per new phase.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  const first = ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1, phase: 'investigate' }));
  const second = ledger.ingest(hostileTick({ tick: 2, clockSeconds: 2, phase: 'chase', history: [{ from: 'investigate', to: 'chase', reason: 'threat-confirmed', targetId: 'raider-1' }] }));
  const transitions = [...first.events, ...second.events].filter((event) => event.type === 'transition');
  assert(transitions.length >= 2, 'two actual phase states produce two transition evidences');
  assert(transitions.some((event) => event.to === 'chase'), 'phase change to chase is projected');
}

// 25. An empty runtime history does not fabricate a transition from stale actor state.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1, history: [] }));
  const next = ledger.ingest(hostileTick({ tick: 2, clockSeconds: 2, phase: 'chase', history: [] }));
  assert(next.events.some((event) => event.type === 'reaction'), 'phase change can still be observed through reaction output');
  assert(next.events.every((event) => event.type !== 'transition'), 'missing runtime history prevents synthetic transition event');
}

// 26. Transition evidence preserves the runtime-provided causal reason.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(hostileTick({
    history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }],
    phase: 'attack',
  }));
  const transition = result.events.find((event) => event.type === 'transition');
  assert(transition?.reason === 'attack-window', 'runtime transition reason is preserved');
}

// 27. Runtime history target identity is preserved even when the reaction target changes.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(hostileTick({
    targetId: 'current-target',
    history: [{ from: 'patrol', to: 'detect', reason: 'perception-signal', targetId: 'historic-target' }],
  }));
  const transition = result.events.find((event) => event.type === 'transition');
  assert(transition?.targetId === 'historic-target', 'transition keeps runtime-history target identity');
  assert(result.events.find((event) => event.type === 'reaction')?.targetId === 'current-target', 'current reaction keeps current target identity');
}

// 28. Ledger accepts multiple actors without cross-actor dedupe collisions.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick({
    tick: 10,
    clockSeconds: 10,
    results: [reaction({ actorId: 'guard-a' }), reaction({ actorId: 'guard-b' })],
  }));
  assert(result.events.length === 4, 'two independent actors project four events');
  assert(new Set(result.events.map((event) => event.actorId)).size === 2, 'events preserve distinct actor identities');
}

// 29. The ledger remains serializable for UI/event adapter callers.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  const encoded = JSON.stringify(ledger.snapshot());
  assert(typeof encoded === 'string' && encoded.length > 0, 'ledger snapshot serializes to JSON');
}

// 30. Snapshot audit is clean for a valid ledger.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  const audit = ledger.audit();
  assert(audit.ok === true, 'runtime ledger audit passes for valid snapshot');
  assert(audit.errors.length === 0, 'valid ledger audit has no errors');
}

// 31. Standalone audit rejects queue overflow and malformed event types.
{
  const malformed = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 999,
    trackedActors: 1,
    clockSeconds: 1,
    actors: [{ actorId: 'broken', phase: 'attack', lod: 'near', cachedSignalCount: 0 }],
    queue: [{ actorId: 'broken', phase: 'attack', lod: 'near', type: 'not-real', clockSeconds: 1 }],
  });
  assert(malformed.ok === false, 'standalone audit rejects malformed ledger snapshot');
  assert(malformed.errors.includes('queue-overflow'), 'standalone audit reports queue overflow');
  assert(malformed.errors.includes('invalid-event-type:broken'), 'standalone audit reports invalid event type');
}

// 32. Negative and non-finite snapshot clocks fail closed.
{
  const negative = auditLivingWorldReactionLedgerSnapshot({ queuedEvents: 0, trackedActors: 0, clockSeconds: -1, actors: [], queue: [] });
  const nanClock = auditLivingWorldReactionLedgerSnapshot({ queuedEvents: 0, trackedActors: 0, clockSeconds: NaN, actors: [], queue: [] });
  assert(negative.ok === false && negative.errors.includes('invalid-clock'), 'negative snapshot clock is rejected');
  assert(nanClock.ok === false && nanClock.errors.includes('invalid-clock'), 'NaN snapshot clock is rejected');
}

// 33. Policy is frozen and exposes the intended bounded constants.
{
  assert(Object.isFrozen(LIVING_WORLD_REACTION_LEDGER_POLICY), 'ledger policy object is frozen');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxQueueEntries === 96, 'policy queue cap is 96');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxEventsPerActor === 6, 'policy actor cap is 6');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxActors === 128, 'policy actor count cap is 128');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.maxHistoryPerActor === 8, 'policy history cap is eight');
  assert(LIVING_WORLD_REACTION_LEDGER_POLICY.deterministic === true, 'policy declares determinism');
}

// 34. Digest is stable across equivalent serialized structures.
{
  const a = livingWorldReactionLedgerDigest({ actorId: 'a', phase: 'attack', targetId: 'b' });
  const b = livingWorldReactionLedgerDigest({ actorId: 'a', phase: 'attack', targetId: 'b' });
  assert(a === b, 'ledger digest is stable for equal structures');
  assert(/^[0-9a-f]{8}$/.test(a), 'ledger digest is fixed-width lowercase hexadecimal');
}

// 35. Digest changes when a meaningful identity changes.
{
  const a = livingWorldReactionLedgerDigest({ actorId: 'a', phase: 'attack', targetId: 'b' });
  const b = livingWorldReactionLedgerDigest({ actorId: 'a', phase: 'attack', targetId: 'c' });
  assert(a !== b, 'ledger digest changes on target identity changes');
}

// 36. Projection keys are deterministic across independent calls.
{
  const input = hostileTick({ tick: 7, clockSeconds: 7 });
  const a = projectLivingWorldReactionEvents(input).map((event) => event.key);
  const b = projectLivingWorldReactionEvents(input).map((event) => event.key);
  assert(JSON.stringify(a) === JSON.stringify(b), 'projection keys are deterministic across repeated calls');
}

// 37. Reordered actors produce the same sorted snapshot digest.
{
  const run = (results) => {
    const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
    ledger.ingest(tick({ tick: 1, clockSeconds: 1, results }));
    return ledger.snapshot().digest;
  };
  const a = run([reaction({ actorId: 'alpha' }), reaction({ actorId: 'zulu' })]);
  const b = run([reaction({ actorId: 'zulu' }), reaction({ actorId: 'alpha' })]);
  assert(a === b, 'snapshot digest is independent of source actor insertion order');
}

// 38. Signal metadata survives as a compact read model.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    signal: {
      id: 'visual-42',
      kind: 'visual-contact',
      confidence: 0.8,
      distanceMeters: 12,
      bearingRadians: 1.25,
      ageSeconds: 0.4,
      audible: false,
      visible: true,
      suspicious: true,
      severity: 55,
      target: { id: 'raider-x', position: { x: 30, z: 40 }, source: 'watchtower' },
    },
  }));
  const signal = normalized.results[0].signal;
  assert(signal.id === 'visual-42', 'signal id is preserved');
  assert(signal.kind === 'visual-contact', 'signal kind is preserved');
  assert(signal.target.id === 'raider-x', 'signal target identity is preserved');
  assert(signal.target.position.x === 30 && signal.target.position.z === 40, 'signal target coordinates are preserved');
  assert(signal.visible === true && signal.audible === false, 'signal modality booleans are preserved');
}

// 39. Missing signal target is still a valid read model.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    signal: { id: 'sound-only', kind: 'noise', confidence: 0.4, audible: true, visible: false, suspicious: false, target: null },
  }));
  assert(normalized.results[0].signal.target === null, 'signals without a target remain target-less');
}

// 40. Occupation read model keeps schedule identity but never gains navigation ownership.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    phase: 'patrol',
    relation: {
      actorFaction: 'watch',
      targetFaction: 'neutral',
      reputation: 0,
      relation: 'neutral',
      diplomaticRelation: 'unknown',
      wanted: 0,
      crimeSeverity: 0,
      hostile: false,
      reportable: false,
    },
    signal: null,
    history: [],
    occupation: { phase: 'work', activityId: 'forge', locationId: 'smithy', shouldTravel: true, destination: { x: 5, z: 9 } },
    navigation: { accepted: true, invoked: true, destination: { x: 5, z: 9 } },
  }));
  const result = normalized.results[0];
  assert(result.occupation.activityId === 'forge', 'occupation activity id is retained');
  assert(result.occupation.locationId === 'smithy', 'occupation location id is retained');
  assert(result.navigation.invoked === true, 'navigation remains an observed owner response');
  assert(result.occupation.destination === undefined, 'occupation normalization does not invent a destination field');
}

// 41. Navigation/combat/law/world-event responses normalize to acceptance/invocation facts only.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    navigation: { accepted: false, invoked: true, result: { secret: 'do-not-project' } },
    combat: { accepted: false, invoked: true, result: { private: true } },
    law: { accepted: false, invoked: false, result: { private: true } },
    worldEvent: { accepted: false, invoked: true, result: { private: true } },
  }));
  const result = normalized.results[0];
  assert(result.navigation.accepted === false && result.navigation.invoked === true, 'navigation projection keeps explicit response flags');
  assert(result.combat.accepted === false && result.combat.invoked === true, 'combat projection keeps explicit response flags');
  assert(result.law.accepted === false && result.law.invoked === false, 'law projection keeps explicit response flags');
  assert(result.worldEvent.accepted === false && result.worldEvent.invoked === true, 'world-event projection keeps explicit response flags');
  assert(!JSON.stringify(result).includes('secret'), 'private owner response payload is not projected');
}

// 42. Cache count is sanitized to a non-negative integer.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({ cachedSignalCount: 4.9 }));
  assert(normalized.results[0].cachedSignalCount === 4, 'cached signal count floors to integer');
  const negative = normalizeLivingWorldReactionTick(hostileTick({ cachedSignalCount: -2 }));
  assert(negative.results[0].cachedSignalCount === 0, 'negative cached signal count clamps to zero');
}

// 43. Actor identifiers are always string-like and stable.
{
  const numeric = normalizeLivingWorldReactionTick(hostileTick({ actorId: 42 }));
  assert(numeric.results[0].actorId === '42', 'numeric actor ids become stable strings');
  const empty = normalizeLivingWorldReactionTick(hostileTick({ actorId: null }));
  assert(empty.results.length === 0, 'missing actor id is rejected from normalized reaction list');
}

// 44. Repeated snapshots do not mutate caller-owned result objects.
{
  const source = hostileTick();
  const before = JSON.stringify(source);
  normalizeLivingWorldReactionTick(source);
  const after = JSON.stringify(source);
  assert(before === after, 'normalization does not mutate the caller-owned tick result');
}

// 45. Projection does not mutate runtime history arrays.
{
  const source = hostileTick();
  const before = JSON.stringify(source.results[0].history);
  projectLivingWorldReactionEvents(source);
  const after = JSON.stringify(source.results[0].history);
  assert(before === after, 'projection does not mutate runtime history');
}

// 46. Queue entries contain compact relation semantics but not private owner payloads.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(hostileTick());
  for (const event of result.events) {
    assert(event.relation === 'hostile', 'queue event contains normalized relation');
    assert(event.wanted === 70, 'queue event contains bounded wanted level');
    assert(!Object.prototype.hasOwnProperty.call(event, 'result'), 'queue event omits private owner result payloads');
  }
}

// 47. A reportable neutral relation remains observable even without hostile diplomatic state.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(hostileTick({
    relation: {
      actorFaction: 'watch',
      targetFaction: 'citizen',
      reputation: 0,
      relation: 'neutral',
      diplomaticRelation: 'peace',
      wanted: 80,
      crimeSeverity: 90,
      hostile: false,
      reportable: true,
    },
    phase: 'patrol',
    history: [],
  }));
  assert(result.events.length === 1, 'reportable neutral patrol generates an observable reaction');
  assert(result.events[0].reportable === true, 'reportable fact survives projection');
}

// 48. Combat intent retains the owner-controlled attack profile via directive kind only.
{
  const result = projectLivingWorldReactionEvents(hostileTick({
    phase: 'attack',
    directive: { kind: 'attack', targetId: 'raider-1', damageOwner: true, attackProfile: 'owner-controlled' },
    history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }],
  }));
  const attack = result.find((event) => event.type === 'combat-intent');
  assert(attack?.directive?.kind === 'attack', 'combat-intent retains attack directive kind');
  assert(attack?.directive?.targetId === 'raider-1', 'combat-intent retains target identity');
  assert(!Object.prototype.hasOwnProperty.call(attack?.directive ?? {}, 'damageOwner'), 'ledger does not project damage ownership flag');
}

// 49. Cull LOD events are still normalized safely, but a culled reaction is never considered an invalid LOD.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({ lod: 'culled', phase: 'patrol', relation: {
    actorFaction: 'watch',
    targetFaction: 'neutral',
    reputation: 0,
    relation: 'neutral',
    diplomaticRelation: 'unknown',
    wanted: 0,
    crimeSeverity: 0,
    hostile: false,
    reportable: false,
  }, signal: null, history: [] }));
  assert(normalized.results[0].lod === 'culled', 'culled LOD is accepted as a valid runtime state');
}

// 50. Standalone event projection order remains stable across equal inputs.
{
  const input = tick({
    tick: 99,
    clockSeconds: 99,
    results: [reaction({ actorId: 'b' }), reaction({ actorId: 'a' })],
  });
  const one = projectLivingWorldReactionEvents(input);
  const two = projectLivingWorldReactionEvents(input);
  assert(JSON.stringify(one) === JSON.stringify(two), 'standalone event arrays are byte-stable for equal inputs');
}

// 51. Long-frame ingestion remains bounded by queue and actor caps.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  for (let tickIndex = 0; tickIndex < 40; tickIndex += 1) {
    const results = Array.from({ length: 128 }, (_, actorIndex) => reaction({
      actorId: `long-${actorIndex}`,
      targetId: `target-${tickIndex}-${actorIndex}`,
      phase: actorIndex % 4 === 0 ? 'attack' : 'investigate',
      history: actorIndex % 4 === 0
        ? [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: `target-${tickIndex}-${actorIndex}` }]
        : [{ from: 'patrol', to: 'investigate', reason: 'perception-signal', targetId: `target-${tickIndex}-${actorIndex}` }],
    }));
    ledger.ingest(tick({ tick: tickIndex + 1, clockSeconds: tickIndex * 10 + 1, results }));
  }
  const snapshot = ledger.snapshot();
  assert(snapshot.queuedEvents <= 96, 'long-frame stress never exceeds queue cap');
  assert(snapshot.trackedActors <= 128, 'long-frame stress never exceeds actor cap');
  assert(snapshot.droppedEvents > 0, 'long-frame stress records bounded drops');
  assert(snapshot.projectedEvents > snapshot.queuedEvents, 'long-frame stress proves queue truncation occurred');
  assert(auditLivingWorldReactionLedgerSnapshot(snapshot).ok, 'long-frame stress remains auditable');
}

// 52. Multiple ledgers remain isolated.
{
  const first = createLivingWorldReactionLedger();
  const second = createLivingWorldReactionLedger();
  first.ingest(hostileTick({ actorId: 'first-guard' }));
  assert(second.snapshot().queuedEvents === 0, 'ledger instances do not share queues');
  assert(second.snapshot().trackedActors === 0, 'ledger instances do not share actor state');
}

// 53. Dedupe state is scoped to each event key, not globally to a clock.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(hostileTick({ actorId: 'guard-a', targetId: 'target-a', clockSeconds: 1 }));
  const second = ledger.ingest(hostileTick({ actorId: 'guard-b', targetId: 'target-b', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'different actors produce distinct events at the same clock');
}

// 54. Different phases within the same actor are not accidentally deduped.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(hostileTick({ actorId: 'guard-a', phase: 'investigate', clockSeconds: 1 }));
  const second = ledger.ingest(hostileTick({ actorId: 'guard-a', phase: 'chase', history: [{ from: 'investigate', to: 'chase', reason: 'threat-confirmed', targetId: 'raider-1' }], clockSeconds: 1.2 }));
  assert(first.events.length > 0 && second.events.length > 0, 'real phase changes are not deduped as duplicates');
}

// 55. Target changes within the same actor/phase are observable.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(hostileTick({ actorId: 'guard-a', targetId: 'target-a', clockSeconds: 1 }));
  const second = ledger.ingest(hostileTick({ actorId: 'guard-a', targetId: 'target-b', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'target identity changes are observable');
}

// 56. Non-hostile investigate event still carries stable actor and directive metadata.
{
  const result = projectLivingWorldReactionEvents(hostileTick({
    relation: {
      actorFaction: 'watch',
      targetFaction: 'merchant',
      reputation: 0,
      relation: 'neutral',
      diplomaticRelation: 'peace',
      wanted: 0,
      crimeSeverity: 0,
      hostile: false,
      reportable: false,
    },
    phase: 'investigate',
    history: [],
    directive: { kind: 'investigate', targetId: 'merchant-1', destination: { x: 1, z: 2 }, radiusMeters: 5 },
    targetId: 'merchant-1',
  }));
  assert(result.length === 1, 'neutral investigate projects a single reaction event');
  assert(result[0].actorId === 'guard-1', 'neutral investigate keeps actor identity');
  assert(result[0].directive.kind === 'investigate', 'neutral investigate keeps directive kind');
}

// 57. Queue snapshot event entries are immutable projection objects.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  const snapshot = ledger.snapshot();
  assert(Object.isFrozen(snapshot), 'snapshot object is frozen');
  assert(Object.isFrozen(snapshot.queue), 'snapshot queue is frozen');
  assert(Object.isFrozen(snapshot.actors), 'snapshot actors array is frozen');
  assert(Object.isFrozen(snapshot.queue[0]), 'snapshot queue entries are frozen');
}

// 58. Ingestion response is immutable.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(hostileTick());
  assert(Object.isFrozen(result), 'ingest result is frozen');
  assert(Object.isFrozen(result.events), 'ingest events array is frozen');
  assert(Object.isFrozen(result.snapshot), 'ingest snapshot is frozen');
}

// 59. The read model does not add an EventBus-like publish method.
{
  const ledger = createLivingWorldReactionLedger();
  assert(typeof ledger.publish === 'undefined', 'ledger has no publish method');
  assert(typeof ledger.emit === 'undefined', 'ledger has no emit method');
  assert(typeof ledger.dispatch === 'undefined', 'ledger has no dispatch method');
}

// 60. The ledger exposes only projection/state lifecycle methods.
{
  const ledger = createLivingWorldReactionLedger();
  const methods = Object.keys(ledger).sort();
  assert(methods.join(',') === 'audit,dispose,drain,ingest,reset,snapshot', 'ledger public surface remains intentionally narrow');
}

// 61. Accepted tick count and rejected tick count are independently tracked.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest({ accepted: false });
  ledger.ingest(hostileTick());
  const snapshot = ledger.snapshot();
  assert(snapshot.rejectedTicks === 1, 'rejected ticks are counted');
  assert(snapshot.acceptedTicks === 1, 'accepted ticks are counted separately');
}

// 62. A disposed ledger snapshot remains structurally safe.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick());
  ledger.dispose();
  const snapshot = ledger.snapshot();
  assert(snapshot.queuedEvents === 0, 'disposed snapshot has no queued events');
  assert(snapshot.trackedActors === 0, 'disposed snapshot has no actor projections');
  assert(auditLivingWorldReactionLedgerSnapshot(snapshot).ok, 'disposed empty snapshot remains structurally auditable');
}

// 63. Reset clears dedupe history as well as state, making the next equivalent event observable.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick({ clockSeconds: 1 }));
  ledger.reset();
  const result = ledger.ingest(hostileTick({ clockSeconds: 1 }));
  assert(result.events.length === 2, 'reset clears dedupe memory so the same reaction can be projected again');
}

// 64. Expired events do not survive into later snapshots.
{
  const ledger = createLivingWorldReactionLedger({ options: { maxAgeSeconds: 2, dedupeTtlSeconds: 0 } });
  ledger.ingest(hostileTick({ clockSeconds: 1 }));
  ledger.ingest(hostileTick({ clockSeconds: 4, actorId: 'later' }));
  const snapshot = ledger.snapshot();
  assert(snapshot.queue.every((event) => snapshot.clockSeconds - event.clockSeconds <= 2), 'queue contains no entries older than configured max age');
}

// 65. Clock is monotonic at ledger level even when a caller sends a stale tick.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(hostileTick({ clockSeconds: 10 }));
  ledger.ingest(hostileTick({ clockSeconds: 5, actorId: 'older-clock' }));
  assert(ledger.snapshot().clockSeconds === 10, 'ledger clock remains monotonic across stale caller input');
}

// 66. Stable event sequence numbers are monotonic within one ingestion result.
{
  const events = projectLivingWorldReactionEvents(tick({
    tick: 42,
    clockSeconds: 42,
    results: [reaction({ actorId: 'a' }), reaction({ actorId: 'b' })],
  }));
  const sequences = events.map((event) => event.sequence);
  assert(sequences.every((value, index) => index === 0 || value > sequences[index - 1]), 'projection sequence numbers are strictly increasing before sort');
}

// 67. Ledger sequence numbers continue across ingestion calls even if the queue is drained.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  const first = ledger.ingest(hostileTick({ clockSeconds: 1 }));
  ledger.drain(99);
  const second = ledger.ingest(hostileTick({ clockSeconds: 4 }));
  assert(second.events[0].sequence > first.events[first.events.length - 1].sequence, 'ledger event sequence continues after drain');
}

// 68. Audit digest remains deterministic for equal ledger states.
{
  const run = () => {
    const ledger = createLivingWorldReactionLedger();
    ledger.ingest(hostileTick({ tick: 1, clockSeconds: 1 }));
    return ledger.audit().digest;
  };
  assert(run() === run(), 'ledger audit digest is deterministic across independent equivalent ledgers');
}

// 69. Invalid event phase in a standalone snapshot is rejected.
{
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 1,
    trackedActors: 1,
    clockSeconds: 1,
    actors: [{ actorId: 'bad-phase-actor', phase: 'attack', lod: 'near', cachedSignalCount: 0 }],
    queue: [{ actorId: 'bad-phase-event', type: 'reaction', phase: 'teleport', lod: 'near', clockSeconds: 1 }],
  });
  assert(audited.ok === false, 'invalid event phase is rejected');
  assert(audited.errors.includes('invalid-event-phase:bad-phase-event'), 'invalid event phase names the actor');
}

// 70. Invalid actor LOD in a standalone snapshot is rejected.
{
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 0,
    trackedActors: 1,
    clockSeconds: 1,
    actors: [{ actorId: 'bad-lod-actor', phase: 'attack', lod: 'teleport', cachedSignalCount: 0 }],
    queue: [],
  });
  assert(audited.ok === false, 'invalid actor LOD is rejected');
  assert(audited.errors.includes('invalid-lod:bad-lod-actor'), 'invalid actor LOD names the actor');
}

// 71. Excessive signal count in standalone actor snapshot is rejected.
{
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 0,
    trackedActors: 1,
    clockSeconds: 1,
    actors: [{ actorId: 'signal-overflow', phase: 'attack', lod: 'near', cachedSignalCount: 13 }],
    queue: [],
  });
  assert(audited.ok === false, 'signal overflow is rejected');
  assert(audited.errors.includes('signal-overflow:signal-overflow'), 'signal overflow identifies actor');
}

// 72. Maximum valid signal count is accepted.
{
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 0,
    trackedActors: 1,
    clockSeconds: 1,
    actors: [{ actorId: 'signal-max', phase: 'attack', lod: 'near', cachedSignalCount: 12 }],
    queue: [],
  });
  assert(audited.ok === true, 'maximum valid signal count remains accepted');
}

// 73. Maximum valid queue size remains accepted.
{
  const queue = Array.from({ length: 96 }, (_, index) => ({
    actorId: `actor-${index}`,
    type: 'reaction',
    phase: 'investigate',
    lod: 'near',
    clockSeconds: index,
  }));
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 96,
    trackedActors: 96,
    clockSeconds: 96,
    actors: [],
    queue,
  });
  assert(audited.ok === true, 'maximum valid queue size remains accepted');
}

// 74. Actor count ceiling is enforced at the standalone audit boundary.
{
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 0,
    trackedActors: 129,
    clockSeconds: 1,
    actors: [],
    queue: [],
  });
  assert(audited.ok === false, 'actor count above 128 is rejected');
  assert(audited.errors.includes('actor-overflow'), 'actor overflow is named');
}

// 75. A safe empty snapshot is valid.
{
  const audited = auditLivingWorldReactionLedgerSnapshot({
    queuedEvents: 0,
    trackedActors: 0,
    clockSeconds: 0,
    actors: [],
    queue: [],
  });
  assert(audited.ok === true, 'empty zero-clock snapshot is valid');
}

// 76. Snapshot actor digest changes when phase changes.
{
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(hostileTick({ phase: 'investigate', clockSeconds: 1 }));
  const before = ledger.snapshot().digest;
  ledger.ingest(hostileTick({ phase: 'chase', clockSeconds: 3, history: [{ from: 'investigate', to: 'chase', reason: 'threat-confirmed', targetId: 'raider-1' }] }));
  const after = ledger.snapshot().digest;
  assert(before !== after, 'snapshot digest changes on meaningful phase progression');
}

// 77. Quiet actor snapshots remain stable when ingested repeatedly.
{
  const quiet = hostileTick({
    phase: 'patrol',
    relation: {
      actorFaction: 'watch',
      targetFaction: 'neutral',
      reputation: 0,
      relation: 'neutral',
      diplomaticRelation: 'unknown',
      wanted: 0,
      crimeSeverity: 0,
      hostile: false,
      reportable: false,
    },
    history: [],
    signal: null,
  });
  const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
  ledger.ingest(quiet);
  const before = ledger.snapshot().digest;
  ledger.ingest({ ...quiet, tick: 2, clockSeconds: 2 });
  const after = ledger.snapshot().digest;
  assert(before !== after, 'snapshot digest reflects clock/tick progression even when no events are projected');
  assert(ledger.snapshot().queuedEvents === 0, 'quiet actor never adds queue events');
}

// 78. Reaction event type remains generic for non-attack phases.
{
  for (const phase of ['detect', 'investigate', 'chase', 'return', 'flee']) {
    const events = projectLivingWorldReactionEvents(hostileTick({ phase, history: [] }));
    assert(events.some((event) => event.type === 'reaction'), `${phase} uses generic reaction event type`);
    assert(events.every((event) => event.type !== 'combat-intent'), `${phase} does not masquerade as combat intent`);
  }
}

// 79. Attack phase can produce both combat and transition evidence.
{
  const events = projectLivingWorldReactionEvents(hostileTick({
    phase: 'attack',
    history: [{ from: 'chase', to: 'attack', reason: 'attack-window', targetId: 'raider-1' }],
  }));
  assert(events.some((event) => event.type === 'combat-intent'), 'attack produces combat intent');
  assert(events.some((event) => event.type === 'transition'), 'attack transition evidence remains present');
}

// 80. Different lod values remain visible in events.
{
  for (const lod of ['near', 'distant', 'far', 'culled']) {
    const events = projectLivingWorldReactionEvents(hostileTick({ lod }));
    assert(events.every((event) => event.lod === lod), `${lod} LOD is preserved in projected events`);
  }
}

// 81. Dedupe key includes LOD so a visibility-state change is not hidden.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(hostileTick({ lod: 'near', clockSeconds: 1 }));
  const second = ledger.ingest(hostileTick({ lod: 'distant', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'LOD change remains observable inside dedupe TTL');
}

// 82. Dedupe key includes runtime digest so distinct source evidence is not collapsed.
{
  const ledger = createLivingWorldReactionLedger();
  const first = ledger.ingest(hostileTick({ digest: 'aaaaaaaa' }));
  const second = ledger.ingest(hostileTick({ digest: 'bbbbbbbb', clockSeconds: 1.1 }));
  assert(first.events.length > 0 && second.events.length > 0, 'different runtime digests remain distinct projections');
}

// 83. A non-string runtime digest still yields a deterministic projection digest.
{
  const result = projectLivingWorldReactionEvents(hostileTick({ digest: 42 }));
  assert(result.every((event) => typeof event.digest === 'string'), 'non-string source digest is normalized to string output');
  assert(result.every((event) => event.digest.length > 0), 'normalized digest remains non-empty');
}

// 84. Null directive does not make a projection invalid.
{
  const result = projectLivingWorldReactionEvents(hostileTick({ directive: null }));
  assert(result.length > 0, 'reaction without a directive remains observable');
  assert(result.every((event) => event.directive === null), 'null directive is preserved as null');
}

// 85. Null relation uses safe neutral defaults.
{
  const result = projectLivingWorldReactionEvents(hostileTick({ relation: null }));
  assert(result.length > 0, 'null relation does not crash projection');
  assert(result.every((event) => event.relation === 'neutral'), 'null relation becomes neutral');
}

// 86. Extremely large numeric values remain bounded.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    relation: { reputation: 1e99, wanted: 1e99, crimeSeverity: 1e99, relation: 'hostile' },
    cachedSignalCount: 1e99,
    elapsedInPhase: 1e99,
  }));
  const result = normalized.results[0];
  assert(result.relation.reputation === 100, 'huge reputation remains bounded');
  assert(result.relation.wanted === 100, 'huge wanted remains bounded');
  assert(result.relation.crimeSeverity === 100, 'huge crime severity remains bounded');
  assert(result.cachedSignalCount === Math.floor(1e99), 'huge finite signal count is still integerized');
  assert(Number.isFinite(result.elapsedInPhase), 'huge elapsed duration remains finite for ordinary finite input');
}

// 87. Non-finite numeric values use explicit safe defaults.
{
  const normalized = normalizeLivingWorldReactionTick(hostileTick({
    elapsedInPhase: Infinity,
    cachedSignalCount: NaN,
    relation: { reputation: NaN, wanted: Infinity, crimeSeverity: -Infinity },
  }));
  const result = normalized.results[0];
  assert(result.elapsedInPhase === 0, 'non-finite elapsed duration becomes zero');
  assert(result.cachedSignalCount === 0, 'NaN signal count becomes zero');
  assert(result.relation.reputation === 0, 'NaN reputation becomes neutral zero');
  assert(result.relation.wanted === 0, 'infinite wanted becomes bounded zero fallback');
  assert(result.relation.crimeSeverity === 0, 'negative infinity crime severity becomes bounded zero fallback');
}

// 88. Queue projection remains read-only with no mutation of actor controller ownership.
{
  const actorPayload = reaction();
  const source = tick({ results: [actorPayload] });
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(source);
  assert(Object.prototype.hasOwnProperty.call(actorPayload, 'phase'), 'source phase remains owned by caller data');
  assert(!Object.prototype.hasOwnProperty.call(actorPayload, 'ledgerState'), 'ledger does not attach hidden controller state');
}

// 89. The projection digest is not used as a global singleton or static mutable state.
{
  const first = livingWorldReactionLedgerDigest({ value: 'first' });
  const second = livingWorldReactionLedgerDigest({ value: 'second' });
  const third = livingWorldReactionLedgerDigest({ value: 'first' });
  assert(first === third && first !== second, 'digest helper is pure across sequential calls');
}

// 90. Full lifecycle smoke repeatedly creates, ingests, drains, resets and disposes independent ledgers.
{
  for (let index = 0; index < 25; index += 1) {
    const ledger = createLivingWorldReactionLedger({ options: { maxQueueEntries: 12, maxEventsPerActor: 3, dedupeTtlSeconds: 0.5 } });
    const ingested = ledger.ingest(hostileTick({ actorId: `lifecycle-${index}`, clockSeconds: index + 1 }));
    assert(ingested.accepted === true, `lifecycle ${index} accepts initial tick`);
    ledger.drain(1);
    ledger.reset();
    const second = ledger.ingest(hostileTick({ actorId: `lifecycle-${index}`, clockSeconds: index + 2 }));
    assert(second.accepted === true, `lifecycle ${index} accepts after reset`);
    assert(ledger.dispose() === true, `lifecycle ${index} disposes cleanly`);
    assert(ledger.snapshot().queuedEvents === 0, `lifecycle ${index} leaves empty queue after dispose`);
  }
}

// 91. Stress audit is stable across a second independent replay.
{
  const run = () => {
    const ledger = createLivingWorldReactionLedger({ options: { dedupeTtlSeconds: 0 } });
    for (let index = 0; index < 12; index += 1) {
      ledger.ingest(tick({
        tick: index + 1,
        clockSeconds: index * 3,
        results: [reaction({ actorId: `s-${index % 6}`, targetId: `t-${index}`, phase: index % 2 ? 'chase' : 'investigate' })],
      }));
    }
    return ledger.snapshot();
  };
  const a = run();
  const b = run();
  assert(a.digest === b.digest, 'stress replay produces identical snapshot digest');
  assert(JSON.stringify(a.queue) === JSON.stringify(b.queue), 'stress replay produces identical queue content');
}

// 92. No event queue entry can carry a non-finite clock after ingestion.
{
  const ledger = createLivingWorldReactionLedger();
  ledger.ingest(hostileTick({ clockSeconds: Infinity }));
  const snapshot = ledger.snapshot();
  assert(snapshot.queue.every((event) => Number.isFinite(event.clockSeconds)), 'ingested queue events have finite clocks');
  assert(Number.isFinite(snapshot.clockSeconds), 'snapshot clock stays finite');
}

// 93. Invalid tick acceptance does not create an actor projection.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest({ accepted: false, results: [reaction({ actorId: 'invalid-tick-actor' })] });
  assert(result.accepted === false, 'invalid tick is rejected');
  assert(ledger.snapshot().trackedActors === 0, 'invalid tick does not create actor projection');
}

// 94. A source actor exceeding the runtime cap is truncated before projection.
{
  const ledger = createLivingWorldReactionLedger();
  const many = Array.from({ length: 140 }, (_, index) => reaction({ actorId: `actor-${index}`, targetId: `target-${index}` }));
  const result = ledger.ingest(tick({ tick: 1, clockSeconds: 1, results: many }));
  assert(result.snapshot.trackedActors === 128, 'ledger projects at most 128 normalized actors');
  assert(result.snapshot.actors[127].actorId === 'actor-99' || result.snapshot.actors[127].actorId === 'actor-127', 'bounded actor set stays within source normalization ceiling');
}

// 95. Empty projected event batches still return a valid immutable snapshot.
{
  const ledger = createLivingWorldReactionLedger();
  const result = ledger.ingest(tick({ results: [reaction({ phase: 'patrol', signal: null, relation: null, history: [] })] }));
  assert(result.events.length === 0, 'empty event batch is valid');
  assert(Object.isFrozen(result.snapshot), 'empty event batch still returns frozen snapshot');
  assert(ledger.audit().ok === true, 'empty event batch leaves valid ledger state');
}

// 96. Final end-to-end contract uses the actual policy id and audit pathway.
{
  const ledger = createLivingWorldReactionLedger();
  const runtimeLike = hostileTick({ tick: 123, clockSeconds: 12.3, actorId: 'end-to-end' });
  assert(runtimeLike.policyId.includes('living-world-reaction-runtime'), 'fixture uses the merged runtime policy namespace');
  const result = ledger.ingest(runtimeLike);
  assert(result.snapshot.policyId === LIVING_WORLD_REACTION_LEDGER_POLICY.id, 'ledger snapshot exposes its own policy id');
  assert(ledger.audit().ok === true, 'end-to-end ledger audit passes');
  assert(livingWorldReactionLedgerDigest(result.snapshot) === result.snapshot.digest, 'snapshot digest helper reproduces snapshot digest');
}

if (failures.length) {
  console.error(`[living-world-reaction-ledger] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[living-world-reaction-ledger] PASS: ${passed} assertions.`);
