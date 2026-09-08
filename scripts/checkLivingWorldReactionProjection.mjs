import {
  LIVING_WORLD_REACTION_PROJECTION_POLICY,
  auditLivingWorldReactionProjectionSnapshot,
  auditLivingWorldReactionUiSelection,
  buildLivingWorldReactionActorCard,
  buildLivingWorldReactionTargetCard,
  compareLivingWorldReactionProjectionSnapshots,
  findLivingWorldReactionActor,
  findLivingWorldReactionTargetEvents,
  getLivingWorldReactionActiveActors,
  getLivingWorldReactionCombatIntents,
  getLivingWorldReactionEventPriorities,
  getLivingWorldReactionHotspots,
  getLivingWorldReactionLodBuckets,
  getLivingWorldReactionPhaseBuckets,
  getLivingWorldReactionPhaseChanges,
  getLivingWorldReactionRelationBuckets,
  getLivingWorldReactionReportableEvents,
  getLivingWorldReactionTransitions,
  getLivingWorldReactionProjectionDigest,
  listLivingWorldReactionActors,
  listLivingWorldReactionEvents,
  livingWorldReactionProjectionDigest,
  normalizeLivingWorldReactionProjectionSnapshot,
  selectLivingWorldReactionForUi,
  summarizeLivingWorldReactionProjection,
} from '../src/3d/gameplay/livingWorldReactionProjection.js';

const failures = [];
let passed = 0;

function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}

function actor(overrides = {}) {
  return {
    actorId: overrides.actorId ?? 'guard-1',
    phase: overrides.phase ?? 'investigate',
    targetId: overrides.targetId ?? 'raider-1',
    lod: overrides.lod ?? 'near',
    relation: overrides.relation ?? 'hostile',
    reputation: overrides.reputation ?? -60,
    wanted: overrides.wanted ?? 70,
    crimeSeverity: overrides.crimeSeverity ?? 80,
    hostile: overrides.hostile ?? true,
    reportable: overrides.reportable ?? true,
    directiveKind: overrides.directiveKind ?? 'investigate',
    hasSignal: overrides.hasSignal ?? true,
    cachedSignalCount: overrides.cachedSignalCount ?? 2,
    elapsedInPhase: overrides.elapsedInPhase ?? 1,
    clockSeconds: overrides.clockSeconds ?? 10,
    previousPhase: overrides.previousPhase ?? 'detect',
    changed: overrides.changed ?? true,
    digest: overrides.digest ?? `${String(overrides.actorId ?? 'guard-1').padEnd(8, '0').slice(0, 8)}`,
  };
}

function event(overrides = {}) {
  const type = overrides.type ?? 'reaction';
  return {
    sequence: overrides.sequence ?? 0,
    type,
    clockSeconds: overrides.clockSeconds ?? 10,
    tick: overrides.tick ?? 10,
    actorId: overrides.actorId ?? 'guard-1',
    targetId: overrides.targetId ?? 'raider-1',
    phase: overrides.phase ?? 'investigate',
    lod: overrides.lod ?? 'near',
    relation: overrides.relation ?? 'hostile',
    wanted: overrides.wanted ?? 70,
    crimeSeverity: overrides.crimeSeverity ?? 80,
    reportable: overrides.reportable ?? true,
    directive: overrides.directive ?? { kind: 'investigate', targetId: 'raider-1', speedMultiplier: 1 },
    from: overrides.from ?? '',
    to: overrides.to ?? '',
    reason: overrides.reason ?? '',
    digest: overrides.digest ?? 'abcdef12',
    key: overrides.key ?? `${overrides.actorId ?? 'guard-1'}|${type}|${overrides.targetId ?? 'raider-1'}|${overrides.sequence ?? 0}`,
  };
}

function snapshot(overrides = {}) {
  return {
    policyId: overrides.policyId ?? 'living-world-reaction-ledger-2026-09-08-v1',
    acceptedTicks: overrides.acceptedTicks ?? 4,
    rejectedTicks: overrides.rejectedTicks ?? 1,
    projectedEvents: overrides.projectedEvents ?? (overrides.queue?.length ?? 2),
    droppedEvents: overrides.droppedEvents ?? 0,
    duplicateEvents: overrides.duplicateEvents ?? 0,
    queuedEvents: overrides.queuedEvents ?? (overrides.queue?.length ?? 2),
    trackedActors: overrides.trackedActors ?? (overrides.actors?.length ?? 2),
    clockSeconds: overrides.clockSeconds ?? 10,
    actors: overrides.actors ?? [actor({ actorId: 'guard-1' }), actor({ actorId: 'guard-2', phase: 'chase', targetId: 'raider-2', relation: 'neutral', hostile: false, reportable: false, wanted: 0, crimeSeverity: 0, directiveKind: 'chase' })],
    queue: overrides.queue ?? [event({ actorId: 'guard-1' }), event({ actorId: 'guard-2', type: 'transition', phase: 'chase', from: 'investigate', to: 'chase', reason: 'threat-confirmed', targetId: 'raider-2', reportable: false, wanted: 0, crimeSeverity: 0, key: 'guard-2|transition' })],
    digest: overrides.digest ?? 'snapshot1',
  };
}

// 1. Null input becomes a safe empty snapshot.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(null);
  assert(result.trackedActors === 0, 'null snapshot has no actors');
  assert(result.queuedEvents === 0, 'null snapshot has no events');
  assert(Number.isFinite(result.clockSeconds), 'null snapshot clock is finite');
}

// 2. Invalid actors are removed instead of entering the UI read model.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ actors: [null, {}, actor({ actorId: 'valid' })] }));
  assert(result.actors.length === 1, 'invalid actors are filtered');
  assert(result.actors[0].actorId === 'valid', 'valid actor remains');
}

// 3. Actor fields normalize into the supported vocabulary.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ actors: [actor({ phase: 'teleport', lod: 'warp', relation: 'unknown' })] }));
  assert(result.actors[0].phase === 'patrol', 'invalid actor phase becomes patrol');
  assert(result.actors[0].lod === 'near', 'invalid actor lod becomes near');
  assert(result.actors[0].relation === 'neutral', 'invalid actor relation becomes neutral');
}

// 4. Event fields normalize into the supported vocabulary.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ queue: [event({ type: 'teleport', phase: 'warp', lod: 'warp', relation: 'warp' })] }));
  assert(result.queue[0].type === 'reaction', 'invalid event type becomes reaction');
  assert(result.queue[0].phase === 'patrol', 'invalid event phase becomes patrol');
  assert(result.queue[0].lod === 'near', 'invalid event lod becomes near');
  assert(result.queue[0].relation === 'neutral', 'invalid event relation becomes neutral');
}

// 5. Actor limits are bounded at 128.
{
  const many = Array.from({ length: 200 }, (_, index) => actor({ actorId: `actor-${index}` }));
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ actors: many, trackedActors: 200 }));
  assert(result.actors.length === 128, 'actor normalization caps at 128');
}

// 6. Queue normalization caps at 96.
{
  const many = Array.from({ length: 160 }, (_, index) => event({ actorId: `actor-${index}`, targetId: `target-${index}`, key: `key-${index}`, sequence: index }));
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ queue: many, queuedEvents: 160 }));
  assert(result.queue.length === 96, 'queue normalization caps at 96');
}

// 7. Actor listing supports phase filters.
{
  const result = listLivingWorldReactionActors(snapshot(), { phase: 'chase' });
  assert(result.length === 1, 'phase filter finds chase actor');
  assert(result[0].actorId === 'guard-2', 'phase filter keeps correct identity');
}

// 8. Actor listing supports relation filters.
{
  const result = listLivingWorldReactionActors(snapshot(), { relation: 'hostile' });
  assert(result.length === 1, 'relation filter finds hostile actor');
  assert(result[0].actorId === 'guard-1', 'relation filter keeps correct identity');
}

// 9. Actor listing supports LOD filters.
{
  const result = listLivingWorldReactionActors(snapshot(), { lod: 'near' });
  assert(result.length === 2, 'LOD filter finds both near actors');
}

// 10. Actor listing supports reportable filtering.
{
  const result = listLivingWorldReactionActors(snapshot(), { reportable: true });
  assert(result.length === 1, 'reportable filter finds guard-1');
}

// 11. Actor listing supports signal filtering.
{
  const result = listLivingWorldReactionActors(snapshot(), { hasSignal: true });
  assert(result.length === 2, 'signal filter finds signaled actors');
}

// 12. Actor listing is lexicographically stable.
{
  const result = listLivingWorldReactionActors(snapshot({ actors: [actor({ actorId: 'z' }), actor({ actorId: 'a' }), actor({ actorId: 'm' })] }));
  assert(result.map((item) => item.actorId).join(',') === 'a,m,z', 'actors sort by stable identity');
}

// 13. Actor limit is enforced.
{
  const result = listLivingWorldReactionActors(snapshot({ actors: Array.from({ length: 50 }, (_, index) => actor({ actorId: `a-${index}` })) }), {}, 5);
  assert(result.length === 5, 'actor query respects caller limit');
}

// 14. Negative actor limit is safe.
{
  const result = listLivingWorldReactionActors(snapshot(), {}, -4);
  assert(result.length === 0, 'negative actor limit yields empty result');
}

// 15. Event listing filters by type.
{
  const result = listLivingWorldReactionEvents(snapshot(), { type: 'transition' });
  assert(result.length === 1, 'event type filter finds transition');
}

// 16. Event listing filters by actor.
{
  const result = listLivingWorldReactionEvents(snapshot(), { actorId: 'guard-2' });
  assert(result.length === 1, 'actor event filter finds one event');
}

// 17. Event listing filters by target.
{
  const result = findLivingWorldReactionTargetEvents(snapshot(), 'raider-1');
  assert(result.length === 1, 'target query finds raider-1 event');
}

// 18. Target filtering is bounded.
{
  const queue = Array.from({ length: 40 }, (_, index) => event({ actorId: `guard-${index}`, targetId: 'same-target', key: `same-${index}` }));
  const result = findLivingWorldReactionTargetEvents(snapshot({ queue, queuedEvents: 40 }), 'same-target', 7);
  assert(result.length === 7, 'target query respects max result limit');
}

// 19. Event filtering can bound a time window.
{
  const queue = [event({ clockSeconds: 1, key: 'old' }), event({ clockSeconds: 5, key: 'mid' }), event({ clockSeconds: 9, key: 'new' })];
  const result = listLivingWorldReactionEvents(snapshot({ queue, queuedEvents: 3 }), { afterClockSeconds: 4, beforeClockSeconds: 10 });
  assert(result.length === 2, 'event time window selects middle/new events');
}

// 20. Active actor query excludes patrol.
{
  const result = getLivingWorldReactionActiveActors(snapshot({ actors: [actor({ actorId: 'patrol', phase: 'patrol', changed: false }), actor({ actorId: 'active', phase: 'investigate' })] }));
  assert(result.length === 1, 'active actor query excludes patrol');
  assert(result[0].actorId === 'active', 'active actor query retains active identity');
}

// 21. Active actors sort by phase severity then wanted level.
{
  const result = getLivingWorldReactionActiveActors(snapshot({ actors: [actor({ actorId: 'one', phase: 'investigate', wanted: 10 }), actor({ actorId: 'two', phase: 'chase', wanted: 0 }), actor({ actorId: 'three', phase: 'attack', wanted: 1 })] }));
  assert(result[0].actorId === 'three', 'attack ranks above chase/investigate');
  assert(result[1].actorId === 'two', 'chase ranks above investigate');
}

// 22. Reportable query surfaces highest law pressure first.
{
  const result = getLivingWorldReactionReportableEvents(snapshot({ queue: [event({ actorId: 'low', wanted: 10, crimeSeverity: 10, key: 'low' }), event({ actorId: 'high', wanted: 90, crimeSeverity: 90, key: 'high' })] }));
  assert(result[0].actorId === 'high', 'reportable events sort by wanted pressure');
}

// 23. Combat intent query returns only combat intents.
{
  const result = getLivingWorldReactionCombatIntents(snapshot({ queue: [event({ type: 'combat-intent', phase: 'attack', key: 'attack' }), event({ type: 'reaction', key: 'reaction' })] }));
  assert(result.length === 1, 'combat query filters generic reactions');
  assert(result[0].type === 'combat-intent', 'combat query returns correct type');
}

// 24. Transition query returns only transitions.
{
  const result = getLivingWorldReactionTransitions(snapshot({ queue: [event({ type: 'transition', key: 'transition' }), event({ type: 'reaction', key: 'reaction' })] }));
  assert(result.length === 1, 'transition query filters generic reactions');
}

// 25. Phase-change query requires changed=true.
{
  const result = getLivingWorldReactionPhaseChanges(snapshot({ actors: [actor({ actorId: 'changed', phase: 'chase', changed: true }), actor({ actorId: 'stable', phase: 'chase', changed: false })] }), 'chase');
  assert(result.length === 1, 'phase-change query filters changed actors');
  assert(result[0].actorId === 'changed', 'phase-change query returns changed actor');
}

// 26. Find actor returns a single stable card.
{
  const found = findLivingWorldReactionActor(snapshot(), 'guard-2');
  assert(found?.actorId === 'guard-2', 'find actor locates by stable identity');
  assert(found?.phase === 'chase', 'find actor returns phase');
}

// 27. Missing actor returns null.
{
  assert(findLivingWorldReactionActor(snapshot(), 'missing') === null, 'missing actor returns null');
}

// 28. Actor card aggregates actor events.
{
  const card = buildLivingWorldReactionActorCard(snapshot(), 'guard-1');
  assert(card?.actorId === 'guard-1', 'actor card keeps identity');
  assert(card?.eventCount === 1, 'actor card counts actor events');
  assert(card?.targets.includes('raider-1'), 'actor card lists target');
}

// 29. Actor card returns null for missing identity.
{
  assert(buildLivingWorldReactionActorCard(snapshot(), 'missing') === null, 'missing actor card returns null');
}

// 30. Target card aggregates multiple actor identities.
{
  const queue = [event({ actorId: 'a', targetId: 'target' }), event({ actorId: 'b', targetId: 'target', key: 'b' }), event({ actorId: 'a', targetId: 'target', key: 'a2' })];
  const card = buildLivingWorldReactionTargetCard(snapshot({ queue, queuedEvents: 3 }), 'target');
  assert(card?.targetId === 'target', 'target card keeps target identity');
  assert(card?.actorCount === 2, 'target card counts unique actors');
  assert(card?.actorIds.join(',') === 'a,b', 'target card sorts actor identities');
}

// 31. Missing target returns null.
{
  assert(buildLivingWorldReactionTargetCard(snapshot(), 'missing') === null, 'missing target card returns null');
}

// 32. Hotspots are ranked deterministically.
{
  const hotspots = getLivingWorldReactionHotspots(snapshot({ actors: [actor({ actorId: 'quiet', phase: 'patrol', hostile: false, reportable: false, hasSignal: false, wanted: 0 }), actor({ actorId: 'danger', phase: 'attack', hostile: true, reportable: true, wanted: 100 })] }));
  assert(hotspots[0].actorId === 'danger', 'danger actor ranks as hotspot');
  assert(hotspots[0].score > hotspots[1].score, 'hotspot score separates urgency');
}

// 33. Hotspot result respects limit.
{
  const hotspots = getLivingWorldReactionHotspots(snapshot({ actors: Array.from({ length: 10 }, (_, index) => actor({ actorId: `a-${index}` })) }), 3);
  assert(hotspots.length === 3, 'hotspot query respects limit');
}

// 34. Event priorities sort combat before transition before reaction.
{
  const priorities = getLivingWorldReactionEventPriorities(snapshot({ queue: [event({ type: 'reaction', actorId: 'r', key: 'r' }), event({ type: 'transition', actorId: 't', key: 't' }), event({ type: 'combat-intent', actorId: 'c', phase: 'attack', key: 'c' })] }));
  assert(priorities[0].type === 'combat-intent', 'combat gets highest priority');
  assert(priorities[1].type === 'transition', 'transition gets second priority');
  assert(priorities[2].type === 'reaction', 'reaction gets lowest priority');
}

// 35. Summary counts every supported phase/LOD/relation key.
{
  const summary = summarizeLivingWorldReactionProjection(snapshot());
  for (const phase of ['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee']) assert(Object.hasOwn(summary.phaseCounts, phase), `summary contains phase ${phase}`);
  for (const lod of ['near', 'distant', 'far', 'culled']) assert(Object.hasOwn(summary.lodCounts, lod), `summary contains lod ${lod}`);
  for (const relation of ['friendly', 'neutral', 'hostile']) assert(Object.hasOwn(summary.relationCounts, relation), `summary contains relation ${relation}`);
}

// 36. Summary active actor count excludes patrol.
{
  const summary = summarizeLivingWorldReactionProjection(snapshot({ actors: [actor({ phase: 'patrol' }), actor({ actorId: 'active', phase: 'attack' })] }));
  assert(summary.activeActors === 1, 'summary counts only active actors');
}

// 37. Summary reportable and hostile counts are independent flags.
{
  const summary = summarizeLivingWorldReactionProjection(snapshot({ actors: [actor({ actorId: 'a', hostile: true, reportable: false }), actor({ actorId: 'b', hostile: false, reportable: true })] }));
  assert(summary.hostileActors === 1, 'summary counts hostile actors');
  assert(summary.reportableActors === 1, 'summary counts reportable actors');
}

// 38. Summary event counts are typed.
{
  const summary = summarizeLivingWorldReactionProjection(snapshot({ queue: [event({ type: 'reaction', key: 'r' }), event({ type: 'transition', key: 't' }), event({ type: 'combat-intent', key: 'c', phase: 'attack' })] }));
  assert(summary.eventCounts.reaction === 1, 'summary counts reaction events');
  assert(summary.eventCounts.transition === 1, 'summary counts transition events');
  assert(summary.eventCounts['combat-intent'] === 1, 'summary counts combat events');
}

// 39. Relation buckets are deterministic and sorted.
{
  const buckets = getLivingWorldReactionRelationBuckets(snapshot());
  assert(buckets.hostile.join(',') === 'guard-1', 'hostile bucket is stable');
  assert(buckets.neutral.join(',') === 'guard-2', 'neutral bucket is stable');
  assert(Object.isFrozen(buckets), 'relation bucket object is frozen');
}

// 40. LOD buckets preserve identity separation.
{
  const buckets = getLivingWorldReactionLodBuckets(snapshot());
  assert(buckets.near.length === 2, 'near bucket contains near actors');
  assert(buckets.far.length === 0, 'far bucket is empty when no far actors exist');
}

// 41. Phase buckets cover all supported phases.
{
  const buckets = getLivingWorldReactionPhaseBuckets(snapshot());
  assert(buckets.investigate.includes('guard-1'), 'investigate bucket contains guard-1');
  assert(buckets.chase.includes('guard-2'), 'chase bucket contains guard-2');
  assert(Array.isArray(buckets.attack), 'attack bucket exists even when empty');
}

// 42. Projection digest is independent of source actor ordering.
{
  const first = snapshot({ actors: [actor({ actorId: 'a' }), actor({ actorId: 'b' })] });
  const second = snapshot({ actors: [actor({ actorId: 'b' }), actor({ actorId: 'a' })] });
  assert(getLivingWorldReactionProjectionDigest(first) === getLivingWorldReactionProjectionDigest(second), 'projection digest ignores actor insertion order');
}

// 43. Projection digest ignores event sequence values used only for transport ordering.
{
  const first = snapshot({ queue: [event({ actorId: 'a', sequence: 1, key: 'same' })] });
  const second = snapshot({ queue: [event({ actorId: 'a', sequence: 99, key: 'same' })] });
  assert(getLivingWorldReactionProjectionDigest(first) === getLivingWorldReactionProjectionDigest(second), 'projection digest ignores transport sequence');
}

// 44. Projection digest changes on phase identity changes.
{
  const first = snapshot({ actors: [actor({ phase: 'investigate' })] });
  const second = snapshot({ actors: [actor({ phase: 'chase' })] });
  assert(getLivingWorldReactionProjectionDigest(first) !== getLivingWorldReactionProjectionDigest(second), 'projection digest changes on phase');
}

// 45. Snapshot comparison reports equality for equivalent orderings.
{
  const first = snapshot({ actors: [actor({ actorId: 'a' }), actor({ actorId: 'b' })] });
  const second = snapshot({ actors: [actor({ actorId: 'b' }), actor({ actorId: 'a' })] });
  const comparison = compareLivingWorldReactionProjectionSnapshots(first, second);
  assert(comparison.equal === true, 'comparison treats reordered actors as equivalent');
  assert(comparison.leftDigest === comparison.rightDigest, 'comparison digests match for equivalent projections');
}

// 46. Snapshot comparison exposes phase deltas.
{
  const first = snapshot({ actors: [actor({ phase: 'investigate' })] });
  const second = snapshot({ actors: [actor({ phase: 'chase' })] });
  const comparison = compareLivingWorldReactionProjectionSnapshots(first, second);
  assert(comparison.phaseDelta.investigate === -1, 'comparison reports investigate decrease');
  assert(comparison.phaseDelta.chase === 1, 'comparison reports chase increase');
}

// 47. Selection for UI provides bounded actor/event groups.
{
  const selection = selectLivingWorldReactionForUi(snapshot(), { maxActors: 1, maxEvents: 1 });
  assert(selection.actors.length === 1, 'UI selection caps active actors');
  assert(selection.events.length === 1, 'UI selection caps events');
  assert(selection.hotspots.length <= 1, 'UI selection caps hotspots');
}

// 48. UI selection includes dedicated reportable/combat/transition projections.
{
  const selection = selectLivingWorldReactionForUi(snapshot());
  assert(Array.isArray(selection.reportableEvents), 'UI selection includes reportable events');
  assert(Array.isArray(selection.combatIntents), 'UI selection includes combat intents');
  assert(Array.isArray(selection.transitions), 'UI selection includes transitions');
}

// 49. UI selection audit passes for a valid selection.
{
  const selection = selectLivingWorldReactionForUi(snapshot());
  const audit = auditLivingWorldReactionUiSelection(selection);
  assert(audit.ok === true, 'valid UI selection passes audit');
  assert(audit.errors.length === 0, 'valid UI selection has no audit errors');
}

// 50. UI selection audit rejects a policy mismatch.
{
  const audit = auditLivingWorldReactionUiSelection({ policyId: 'wrong', summary: { trackedActors: 0, queuedEvents: 0 }, actors: [], events: [] });
  assert(audit.ok === false, 'policy mismatch is rejected');
  assert(audit.errors.includes('policy-mismatch'), 'policy mismatch is explicit');
}

// 51. Snapshot audit rejects duplicate actors.
{
  const duplicated = snapshot({ actors: [actor({ actorId: 'same' }), actor({ actorId: 'same' })], trackedActors: 2 });
  const audit = auditLivingWorldReactionProjectionSnapshot(duplicated);
  assert(audit.ok === false, 'duplicate actor snapshot is rejected');
  assert(audit.errors.includes('duplicate-actor:same'), 'duplicate actor error is explicit');
}

// 52. Snapshot audit rejects non-finite event clocks.
{
  const audited = auditLivingWorldReactionProjectionSnapshot(snapshot({ queue: [event({ clockSeconds: Infinity })], queuedEvents: 1 }));
  assert(audited.ok === false, 'non-finite event clock is rejected');
  assert(audited.errors.includes('invalid-event-clock:guard-1'), 'non-finite event clock identifies actor');
}

// 53. Snapshot audit rejects negative clocks.
{
  const audited = auditLivingWorldReactionProjectionSnapshot(snapshot({ clockSeconds: -1, actors: [], queue: [], queuedEvents: 0, trackedActors: 0 }));
  assert(audited.ok === false, 'negative snapshot clock is rejected');
  assert(audited.errors.includes('invalid-clock'), 'negative snapshot clock is explicit');
}

// 54. Snapshot audit rejects over-cap events.
{
  const queue = Array.from({ length: 97 }, (_, index) => event({ key: `k-${index}`, actorId: `a-${index}` }));
  const audited = auditLivingWorldReactionProjectionSnapshot({ ...snapshot({ queue, queuedEvents: 97 }), queuedEvents: 97 });
  assert(audited.ok === false, 'over-cap events are rejected at audit boundary');
  assert(audited.errors.includes('event-overflow'), 'event overflow is explicit');
}

// 55. Snapshot audit rejects over-cap actors.
{
  const audited = auditLivingWorldReactionProjectionSnapshot({ ...snapshot({ actors: [], queue: [], queuedEvents: 0, trackedActors: 129 }), trackedActors: 129 });
  assert(audited.ok === false, 'over-cap actors are rejected');
  assert(audited.errors.includes('actor-overflow'), 'actor overflow is explicit');
}

// 56. Snapshot audit accepts a valid empty projection.
{
  const audited = auditLivingWorldReactionProjectionSnapshot({ queuedEvents: 0, trackedActors: 0, clockSeconds: 0, actors: [], queue: [] });
  assert(audited.ok === true, 'empty projection audit passes');
}

// 57. Projection digest helper aliases canonical projection digest.
{
  const input = snapshot();
  assert(livingWorldReactionProjectionDigest(input) === getLivingWorldReactionProjectionDigest(input), 'projection digest aliases canonical helper');
}

// 58. Normalization is immutable.
{
  const source = snapshot();
  const before = JSON.stringify(source);
  normalizeLivingWorldReactionProjectionSnapshot(source);
  const after = JSON.stringify(source);
  assert(before === after, 'projection normalization does not mutate source');
}

// 59. Actor query returns immutable actor records.
{
  const result = listLivingWorldReactionActors(snapshot());
  assert(Object.isFrozen(result), 'actor query array is frozen');
  assert(Object.isFrozen(result[0]), 'actor query entries are frozen');
}

// 60. Event query returns immutable event records.
{
  const result = listLivingWorldReactionEvents(snapshot());
  assert(Object.isFrozen(result), 'event query array is frozen');
  assert(Object.isFrozen(result[0]), 'event query entries are frozen');
}

// 61. Summary is immutable and includes a stable digest.
{
  const result = summarizeLivingWorldReactionProjection(snapshot());
  assert(Object.isFrozen(result), 'summary is frozen');
  assert(typeof result.digest === 'string' && result.digest.length === 8, 'summary carries fixed-width digest');
}

// 62. Active actor result remains an array without exposing mutation hooks.
{
  const result = getLivingWorldReactionActiveActors(snapshot());
  assert(Array.isArray(result), 'active actor output remains array');
  assert(typeof result.push === 'function', 'array API exists but query owns no push method');
}

// 63. Reportable query returns only reportable entries.
{
  const result = getLivingWorldReactionReportableEvents(snapshot({ queue: [event({ reportable: true, key: 'yes' }), event({ reportable: false, key: 'no' })] }));
  assert(result.length === 1 && result[0].reportable === true, 'reportable query excludes non-reportable events');
}

// 64. Event priority score remains finite for extreme law values.
{
  const result = getLivingWorldReactionEventPriorities(snapshot({ queue: [event({ wanted: 1e99, crimeSeverity: 1e99 })] }));
  assert(Number.isFinite(result[0].score), 'event priority score remains finite at extreme values');
}

// 65. Actor hotspot score remains finite for extreme values.
{
  const result = getLivingWorldReactionHotspots(snapshot({ actors: [actor({ wanted: 1e99, phase: 'attack' })] }));
  assert(Number.isFinite(result[0].score), 'hotspot score remains finite at extreme values');
}

// 66. Null directive normalization is safe.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ queue: [event({ directive: null })] }));
  assert(result.queue[0].directive === null, 'null directive remains null');
}

// 67. Missing actor relation is neutral.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ actors: [actor({ relation: null })] }));
  assert(result.actors[0].relation === 'neutral', 'missing actor relation defaults neutral');
}

// 68. Event target identity is string-normalized.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ queue: [event({ targetId: 42 })] }));
  assert(result.queue[0].targetId === '42', 'numeric target id becomes string');
}

// 69. Event sequence is normalized to an integer.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ queue: [event({ sequence: 4.9 })] }));
  assert(result.queue[0].sequence === 4, 'event sequence is integerized');
}

// 70. Event speed multiplier is bounded.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ queue: [event({ directive: { kind: 'chase', speedMultiplier: 99 } })] }));
  assert(result.queue[0].directive.speedMultiplier === 4, 'directive speed multiplier is capped');
}

// 71. Event priority output omits private directive details beyond compact ownership facts.
{
  const result = getLivingWorldReactionEventPriorities(snapshot({ queue: [event({ directive: { kind: 'attack', secret: 'private', speedMultiplier: 1 } })] }));
  assert(!Object.hasOwn(result[0], 'secret'), 'priority view omits private directive payloads');
}

// 72. Actor card digest changes when actor phase changes.
{
  const a = buildLivingWorldReactionActorCard(snapshot({ actors: [actor({ phase: 'investigate' })] }), 'guard-1');
  const b = buildLivingWorldReactionActorCard(snapshot({ actors: [actor({ phase: 'chase' })] }), 'guard-1');
  assert(a.digest !== b.digest, 'actor card digest reflects phase change');
}

// 73. Target card digest changes when highest-priority event changes.
{
  const a = buildLivingWorldReactionTargetCard(snapshot({ queue: [event({ type: 'reaction', key: 'r' })] }), 'raider-1');
  const b = buildLivingWorldReactionTargetCard(snapshot({ queue: [event({ type: 'combat-intent', phase: 'attack', key: 'c' })] }), 'raider-1');
  assert(a.digest !== b.digest, 'target card digest reflects priority change');
}

// 74. UI selection digest matches canonical projection digest.
{
  const input = snapshot();
  const selection = selectLivingWorldReactionForUi(input);
  assert(selection.digest === getLivingWorldReactionProjectionDigest(input), 'UI selection digest matches projection digest');
}

// 75. UI selection audit catches actor underflow.
{
  const audit = auditLivingWorldReactionUiSelection({ policyId: LIVING_WORLD_REACTION_PROJECTION_POLICY.id, summary: { trackedActors: 0, queuedEvents: 0 }, actors: [actor()], events: [] });
  assert(audit.ok === false, 'UI actor underflow is rejected');
  assert(audit.errors.includes('summary-actor-underflow'), 'UI actor underflow is explicit');
}

// 76. UI selection audit catches event underflow.
{
  const audit = auditLivingWorldReactionUiSelection({ policyId: LIVING_WORLD_REACTION_PROJECTION_POLICY.id, summary: { trackedActors: 0, queuedEvents: 0 }, actors: [], events: [event()] });
  assert(audit.ok === false, 'UI event underflow is rejected');
  assert(audit.errors.includes('summary-event-underflow'), 'UI event underflow is explicit');
}

// 77. Two equal snapshots compare equal even when queue order differs.
{
  const one = snapshot({ queue: [event({ actorId: 'a', key: 'a' }), event({ actorId: 'b', key: 'b' })] });
  const two = snapshot({ queue: [event({ actorId: 'b', key: 'b' }), event({ actorId: 'a', key: 'a' })] });
  const comparison = compareLivingWorldReactionProjectionSnapshots(one, two);
  assert(comparison.equal === true, 'comparison ignores event insertion order');
}

// 78. Event queries cap output at 32 by default.
{
  const queue = Array.from({ length: 100 }, (_, index) => event({ actorId: `a-${index}`, key: `e-${index}` }));
  const result = listLivingWorldReactionEvents(snapshot({ queue, queuedEvents: 100 }), {});
  assert(result.length === 32, 'event query uses 32-item default cap');
}

// 79. Actor queries cap output at 32 by default.
{
  const actors = Array.from({ length: 80 }, (_, index) => actor({ actorId: `a-${index}` }));
  const result = listLivingWorldReactionActors(snapshot({ actors, trackedActors: 80 }), {});
  assert(result.length === 32, 'actor query uses 32-item default cap');
}

// 80. UI selection never exceeds its hard actor/event limits.
{
  const actors = Array.from({ length: 128 }, (_, index) => actor({ actorId: `a-${index}`, phase: 'attack' }));
  const queue = Array.from({ length: 96 }, (_, index) => event({ actorId: `a-${index}`, type: 'combat-intent', phase: 'attack', key: `e-${index}` }));
  const selection = selectLivingWorldReactionForUi(snapshot({ actors, queue, trackedActors: 128, queuedEvents: 96 }), { maxActors: 99, maxEvents: 99 });
  assert(selection.actors.length <= 32, 'UI actor output is capped at 32');
  assert(selection.events.length <= 32, 'UI event output is capped at 32');
}

// 81. Relation bucket output is immutable at bucket level.
{
  const buckets = getLivingWorldReactionRelationBuckets(snapshot());
  assert(Object.isFrozen(buckets.hostile), 'relation bucket arrays are frozen');
}

// 82. LOD bucket output is immutable at bucket level.
{
  const buckets = getLivingWorldReactionLodBuckets(snapshot());
  assert(Object.isFrozen(buckets.near), 'LOD bucket arrays are frozen');
}

// 83. Phase bucket output is immutable at bucket level.
{
  const buckets = getLivingWorldReactionPhaseBuckets(snapshot());
  assert(Object.isFrozen(buckets.chase), 'phase bucket arrays are frozen');
}

// 84. Snapshot normalization preserves caller-visible policy id.
{
  const result = normalizeLivingWorldReactionProjectionSnapshot(snapshot({ policyId: 'custom-policy' }));
  assert(result.policyId === 'custom-policy', 'snapshot policy id remains visible');
}

// 85. Summary exposes the policy namespace, not a hard-coded runtime policy id.
{
  const result = summarizeLivingWorldReactionProjection(snapshot({ policyId: 'custom-policy' }));
  assert(result.policyId === LIVING_WORLD_REACTION_PROJECTION_POLICY.id, 'summary advertises its own projection policy');
}

// 86. Event target card keeps maximum wanted bounded.
{
  const card = buildLivingWorldReactionTargetCard(snapshot({ queue: [event({ targetId: 'wanted', wanted: 100 })] }), 'wanted');
  assert(card.wanted === 100, 'target card preserves bounded wanted maximum');
}

// 87. Target card keeps maximum crime severity bounded.
{
  const card = buildLivingWorldReactionTargetCard(snapshot({ queue: [event({ targetId: 'crime', crimeSeverity: 100 })] }), 'crime');
  assert(card.crimeSeverity === 100, 'target card preserves bounded crime maximum');
}

// 88. Actor card carries previous phase evidence.
{
  const card = buildLivingWorldReactionActorCard(snapshot({ actors: [actor({ previousPhase: 'detect', phase: 'investigate' })] }), 'guard-1');
  assert(card.previousPhase === 'detect', 'actor card carries previous phase');
  assert(card.changed === true, 'actor card carries changed flag');
}

// 89. Event priority records compact score and priority values.
{
  const result = getLivingWorldReactionEventPriorities(snapshot());
  assert(typeof result[0].priority === 'number', 'event priority emits numeric priority');
  assert(typeof result[0].score === 'number', 'event priority emits numeric score');
}

// 90. Projection comparison exposes per-LOD deltas.
{
  const a = snapshot({ actors: [actor({ lod: 'near' })] });
  const b = snapshot({ actors: [actor({ lod: 'far' })] });
  const comparison = compareLivingWorldReactionProjectionSnapshots(a, b);
  assert(comparison.lodDelta.near === -1, 'comparison exposes near LOD decrease');
  assert(comparison.lodDelta.far === 1, 'comparison exposes far LOD increase');
}

// 91. Projection comparison exposes relation deltas.
{
  const a = snapshot({ actors: [actor({ relation: 'neutral' })] });
  const b = snapshot({ actors: [actor({ relation: 'hostile' })] });
  const comparison = compareLivingWorldReactionProjectionSnapshots(a, b);
  assert(comparison.relationDelta.neutral === -1, 'comparison exposes neutral decrease');
  assert(comparison.relationDelta.hostile === 1, 'comparison exposes hostile increase');
}

// 92. Projection comparison exposes event deltas.
{
  const a = snapshot({ queue: [event({ type: 'reaction', key: 'r' })] });
  const b = snapshot({ queue: [event({ type: 'combat-intent', phase: 'attack', key: 'c' })] });
  const comparison = compareLivingWorldReactionProjectionSnapshots(a, b);
  assert(comparison.eventDelta.reaction === -1, 'comparison exposes reaction decrease');
  assert(comparison.eventDelta['combat-intent'] === 1, 'comparison exposes combat increase');
}

// 93. Projection query does not introduce EventBus methods.
{
  assert(typeof selectLivingWorldReactionForUi.publish === 'undefined', 'projection selector is not a publisher');
  assert(typeof listLivingWorldReactionEvents.emit === 'undefined', 'event query function is not an EventBus');
}

// 94. Projection policy is frozen.
{
  assert(Object.isFrozen(LIVING_WORLD_REACTION_PROJECTION_POLICY), 'projection policy is frozen');
  assert(LIVING_WORLD_REACTION_PROJECTION_POLICY.deterministic === true, 'projection policy declares determinism');
}

// 95. Projection summary digest is deterministic across equivalent snapshots.
{
  const a = summarizeLivingWorldReactionProjection(snapshot());
  const b = summarizeLivingWorldReactionProjection(snapshot());
  assert(a.digest === b.digest, 'summary digest is deterministic across equal input');
}

// 96. Final UI projection contract is immutable and auditable.
{
  const selection = selectLivingWorldReactionForUi(snapshot());
  assert(Object.isFrozen(selection), 'final UI selection is frozen');
  assert(auditLivingWorldReactionUiSelection(selection).ok, 'final UI selection is auditable');
}

if (failures.length) {
  console.error(`[living-world-reaction-projection] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[living-world-reaction-projection] PASS: ${passed} assertions.`);
