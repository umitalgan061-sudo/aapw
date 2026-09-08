import { auditLivingWorldReactionResult, createLivingWorldReactionRuntime } from '../src/3d/gameplay/livingWorldReactionRuntime.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function actor(id, x = 0, z = 0, extra = {}) {
  return { id, object3D: { name: id, position: { x, z }, userData: {} }, factionId: extra.factionId ?? 'watch', traits: extra.traits ?? {}, ...extra };
}
function signal(id, targetId, overrides = {}) {
  return { id, kind: overrides.kind ?? 'contact', confidence: overrides.confidence ?? 1, distanceMeters: overrides.distanceMeters ?? 8, visible: overrides.visible ?? true, audible: overrides.audible ?? false, suspicious: overrides.suspicious ?? true, targetId, position: overrides.position ?? { x: 8, z: 0 }, severity: overrides.severity ?? 50 };
}
function hostileServices({ signals, reputation = -70, wanted = 70, crime = 60, events = [], attacks = [], navigation = [] }) {
  return {
    perception: { sense() { return signals; } },
    factions: { getFactionIdForActor() { return 'watch'; } },
    reputation: { getReputation() { return reputation; } },
    diplomacy: { getRelation() { return 'war'; } },
    law: { getWantedLevel() { return wanted; }, getCrimeSeverity() { return crime; }, reportCrime(event) { events.push(event); return true; } },
    encounters: { shouldChase() { return true; }, canAttack() { return true; }, requestAttack(_actor, targetId) { attacks.push(targetId); return true; } },
    navigation: { requestTravel(_actor, destination, directive) { navigation.push({ destination, directive }); return true; } },
    worldEvents: { publish(event) { events.push(event); return true; } },
  };
}

// Telemetry must expose the same actor identity and phase that drove the decision.
{
  const guard = actor('telemetry-guard');
  const runtime = createLivingWorldReactionRuntime({ actors: [guard], services: { perception: { sense() { return []; } } } });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 1, z: 1 } });
  const telemetry = guard.object3D.userData.livingWorldReaction;
  assert(telemetry?.actorId === 'telemetry-guard', 'telemetry carries stable actor identity');
  assert(telemetry?.phase === result.results[0].phase, 'telemetry phase matches returned phase');
  assert(telemetry?.lod === result.results[0].lod, 'telemetry LOD matches returned LOD');
  assert(typeof telemetry?.digest === 'string' && telemetry.digest.length === 8, 'telemetry carries fixed-width digest');
}

// Transition history is causal evidence, not merely a counter.
{
  const events = [];
  const attacks = [];
  const navigation = [];
  const guard = actor('history-guard');
  const target = signal('history-threat', 'history-raider', { distanceMeters: 10, position: { x: 10, z: 0 } });
  let active = true;
  const runtime = createLivingWorldReactionRuntime({ actors: [guard], services: hostileServices({ signals: () => active ? [target] : [], events, attacks, navigation }) });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  active = false;
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const history = runtime.snapshot().actors[0].history;
  assert(history.length >= 3, 'history records multiple real phase changes');
  assert(history.every((entry) => entry.from && entry.to && entry.reason), 'history records from/to/reason for every transition');
  assert(history.some((entry) => entry.to === 'chase'), 'history contains chase transition');
  assert(history.some((entry) => entry.to === 'return'), 'history contains return transition');
  assert(events.length >= 1, 'law/world-event evidence is emitted during hostile response');
  assert(attacks.length >= 1, 'combat evidence records attack delegation');
  assert(navigation.length >= 1, 'navigation evidence records movement delegation');
}

// Relation telemetry is bounded and serializable for downstream UI/event adapters.
{
  const guard = actor('relation-guard');
  const target = signal('relation-target', 'wanted-citizen', { distanceMeters: 14 });
  const runtime = createLivingWorldReactionRuntime({ actors: [guard], services: hostileServices({ signals: [target], reputation: -100, wanted: 100, crime: 100 }) });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const relation = result.results[0].relation;
  assert(relation.reputation >= -100 && relation.reputation <= 100, 'reputation remains in bounded range');
  assert(relation.wanted >= 0 && relation.wanted <= 100, 'wanted remains in bounded range');
  assert(relation.crimeSeverity >= 0 && relation.crimeSeverity <= 100, 'crime severity remains in bounded range');
  assert(typeof JSON.stringify(result) === 'string', 'runtime result is JSON serializable');
  assert(auditLivingWorldReactionResult(result).ok, 'relation-rich result passes runtime audit');
}

// Event identities must be deterministic for the same actor/target/phase tuple.
{
  const target = signal('digest-target', 'raider-digest', { distanceMeters: 6 });
  function run() {
    const guard = actor('digest-guard');
    const events = [];
    const runtime = createLivingWorldReactionRuntime({ actors: [guard], services: hostileServices({ signals: [target], events }) });
    const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    return result.results[0].digest;
  }
  const a = run();
  const b = run();
  assert(a === b, 'same actor/target/phase evidence keeps a stable digest');
  assert(/^[0-9a-f]{8}$/.test(a), 'digest is a compact lowercase hexadecimal token');
}

// Flee telemetry includes an actionable destination and urgency without owning movement.
{
  const wolf = actor('telemetry-wolf', 20, 20, { factionId: 'wildlife', traits: { fleeWhenOutnumbered: true }, groupThreatCount: 4 });
  const target = signal('telemetry-predator', 'hunter', { distanceMeters: 10, position: { x: 20, z: 30 } });
  const runtime = createLivingWorldReactionRuntime({ actors: [wolf], services: { perception: { sense() { return [target]; } } } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const telemetry = wolf.object3D.userData.livingWorldReaction;
  assert(result.results[0].phase === 'flee', 'wildlife telemetry phase is flee');
  assert(telemetry?.directive?.kind === 'flee', 'wildlife telemetry carries flee directive');
  assert(telemetry?.directive?.destination != null, 'wildlife telemetry carries flee destination');
  assert(telemetry?.directive?.speedMultiplier > 1, 'wildlife telemetry carries flee urgency');
}

// Audit remains fail-closed for malformed telemetry-like output.
{
  const malformed = auditLivingWorldReactionResult({ accepted: true, actorCount: 1, results: [{ actorId: 'broken', phase: 'attack', lod: 'near', relation: { wanted: -2, reputation: 101 } }] });
  assert(malformed.ok === false, 'malformed relationship telemetry is rejected');
  assert(malformed.errors.includes('invalid-wanted:broken'), 'malformed wanted level is reported');
  assert(malformed.errors.includes('invalid-reputation:broken'), 'malformed reputation is reported');
}

if (failures.length) {
  console.error(`[living-world-reaction-telemetry] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[living-world-reaction-telemetry] PASS: ${passed} telemetry assertions.`);
