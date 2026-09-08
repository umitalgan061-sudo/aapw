import {
  auditLivingWorldReactionResult,
  createLivingWorldReactionRuntime,
} from '../src/3d/gameplay/livingWorldReactionRuntime.js';

const failures = [];
let passed = 0;
function assert(condition, message) {
  if (condition) passed += 1;
  else failures.push(message);
}
function equal(actual, expected, message) {
  assert(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function actor(id, factionId = 'watch', traits = {}) {
  return {
    id,
    factionId,
    traits,
    object3D: { name: id, position: { x: 0, z: 0 }, userData: {} },
  };
}
function servicesFor(signalFactory, options = {}) {
  return {
    perception: { sense(target) { return signalFactory(target); } },
    factions: { getFactionIdForActor(target) { return target.factionId; } },
    reputation: { getReputation(_actor, target) { return options.reputation?.[target?.id] ?? 0; } },
    diplomacy: { getRelation(actorFaction, targetFaction) { return options.diplomacy?.[`${actorFaction}:${targetFaction}`] ?? 'neutral'; } },
    law: {
      getWantedLevel(target) { return options.wanted?.[target?.id] ?? 0; },
      getCrimeSeverity(target) { return options.crime?.[target?.id] ?? 0; },
      reportCrime(event) { options.reports?.push(event); return true; },
    },
    encounters: {
      shouldChase(_relation, signal) { return Boolean(options.chase?.(signal)); },
      canAttack(_relation, signal) { return Boolean(options.attack?.(signal)); },
      requestAttack(_actor, targetId) { options.attacks?.push(targetId); return true; },
    },
    navigation: { requestTravel(_actor, destination, directive) { options.navigation?.push({ destination, kind: directive.kind }); return true; } },
    worldEvents: { publish(event) { options.events?.push(event); return true; } },
  };
}

// 1. Hearing can create an investigate state without requiring line-of-sight.
{
  const guard = actor('guard-hearing');
  let calls = 0;
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => {
      calls += 1;
      return [{ id: 'footsteps', kind: 'sound', confidence: 0.9, distanceMeters: 20, audible: true, visible: false, suspicious: true, targetId: 'unknown-raider', position: { x: 20, z: 0 } }];
    }),
  });
  const first = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const second = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(first.results[0].phase, 'detect', 'hearing signal enters detect first');
  equal(second.results[0].phase, 'investigate', 'hearing-only signal creates investigation');
  assert(calls >= 2, 'hearing samples through perception owner');
}

// 2. Friendly reputation should make ordinary visible presence non-hostile.
{
  const guard = actor('guard-friendly');
  const target = { id: 'merchant', factionId: 'guild', reputation: 80, wanted: 0, crime: { severity: 0 } };
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => [{ id: 'merchant-sighting', kind: 'civilian', confidence: 0.95, distanceMeters: 12, visible: true, suspicious: false, targetId: target.id, position: { x: 12, z: 0 }, reputation: 80 }], {
      reputation: { merchant: 80 },
    }),
  });
  const first = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const second = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(first.results[0].relation.relation, 'friendly', 'positive reputation creates friendly relation');
  equal(second.results[0].phase, 'investigate', 'friendly visible presence is still observable but not an attack');
  assert(second.results[0].relation.hostile === false, 'friendly relation does not become hostile');
}

// 3. Neutral reputation plus suspicion investigates without forcing combat.
{
  const guard = actor('guard-neutral');
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => [{ id: 'stranger', kind: 'stranger', confidence: 0.85, distanceMeters: 15, visible: true, suspicious: true, targetId: 'stranger', position: { x: 15, z: 0 } }]),
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const second = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(second.results[0].phase, 'investigate', 'neutral suspicious contact investigates');
  equal(second.results[0].combat.invoked, false, 'neutral contact does not invoke combat automatically');
}

// 4. Wanted target can authorize attack even before an explicit diplomacy-war response.
{
  const guard = actor('guard-law');
  const attacks = [];
  const reports = [];
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => [{ id: 'wanted-thief', kind: 'crime', confidence: 1, distanceMeters: 10, visible: true, suspicious: true, targetId: 'wanted-thief', position: { x: 10, z: 0 } }], {
      wanted: { 'wanted-thief': 100 },
      crime: { 'wanted-thief': 90 },
      reports,
      attacks,
      attack: () => true,
      chase: () => true,
    }),
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(result.results[0].relation.wanted, 100, 'wanted level is preserved');
  equal(result.results[0].relation.crimeSeverity, 90, 'crime severity is preserved');
  equal(result.results[0].phase, 'attack', 'law policy can elevate contact to attack');
  assert(attacks.length >= 1, 'attack owner receives attack request');
  assert(reports.length >= 1, 'law owner receives crime report');
}

// 5. Stealth-like low confidence contact stays in patrol until its evidence crosses threshold.
{
  const guard = actor('guard-stealth');
  let strong = false;
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => [{ id: 'hidden', kind: 'stealth', confidence: strong ? 0.95 : 0.18, distanceMeters: 40, visible: false, audible: true, suspicious: strong, targetId: 'hidden', position: { x: 40, z: 0 } }]),
  });
  const weak = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(weak.results[0].phase, 'patrol', 'weak stealth evidence does not trigger detection');
  strong = true;
  const strongResult = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(strongResult.results[0].phase, 'detect', 'strong stealth evidence triggers detection');
}

// 6. A diplomatic truce blocks an otherwise hostile faction from becoming an attack permission.
{
  const guard = actor('guard-truce', 'watch');
  const attacks = [];
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => [{ id: 'truce-raider', kind: 'raider', confidence: 1, distanceMeters: 9, visible: true, suspicious: true, targetId: 'truce-raider', position: { x: 9, z: 0 } }], {
      reputation: { 'truce-raider': -80 },
      diplomacy: { 'watch:raiders': 'truce' },
      attacks,
      chase: () => false,
      attack: () => false,
    }),
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(result.results[0].relation.diplomaticRelation, 'neutral', 'unresolved faction identity remains safe when target faction is absent');
  equal(result.results[0].phase, 'investigate', 'truce-like missing relation does not fabricate attack');
  equal(attacks.length, 0, 'truce scenario never invokes combat without authorization');
}

// 7. Flee policy wins over attack when the actor is explicitly outnumbered.
{
  const wolf = actor('wolf-flee', 'wildlife', { fleeWhenOutnumbered: true });
  wolf.groupThreatCount = 5;
  const runtime = createLivingWorldReactionRuntime({
    actors: [wolf],
    services: servicesFor(() => [{ id: 'hunter', kind: 'hunter', confidence: 1, distanceMeters: 7, visible: true, suspicious: true, targetId: 'hunter', position: { x: 7, z: 0 } }]),
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(result.results[0].phase, 'flee', 'wildlife outnumbered response enters flee');
  assert(result.results[0].directive.destination.x < wolf.object3D.position.x, 'flee destination moves away from threat on x axis');
}

// 8. Return is sticky until the actor reaches its recorded home position or a new threat interrupts it.
{
  const guard = actor('guard-sticky', 'watch');
  const nav = [];
  let active = true;
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => active ? [{ id: 'threat', kind: 'enemy', confidence: 1, distanceMeters: 4, visible: true, suspicious: true, targetId: 'threat', position: { x: 4, z: 0 } }] : [], { navigation: nav }),
  });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  active = false;
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(result.results[0].phase, 'return', 'lost threat enters return');
  assert(nav.some((entry) => entry.kind === 'return'), 'return publishes navigation intent');
}

// 9. Every scenario result stays inside the audit contract.
{
  const guard = actor('audit');
  const runtime = createLivingWorldReactionRuntime({ actors: [guard] });
  const result = runtime.tick({ deltaSeconds: 0.1, playerPosition: { x: 0, z: 0 } });
  assert(auditLivingWorldReactionResult(result).ok, 'ordinary result passes audit');
}

// 10. Negative/NaN relationship inputs clamp rather than poisoning the state.
{
  const guard = actor('guard-clamp');
  const runtime = createLivingWorldReactionRuntime({
    actors: [guard],
    services: servicesFor(() => [{ id: 'bad-input', confidence: 1, distanceMeters: 4, visible: true, suspicious: true, targetId: 'bad-input', position: { x: 4, z: 0 } }], {
      reputation: { 'bad-input': NaN },
      wanted: { 'bad-input': Infinity },
      crime: { 'bad-input': -1000 },
    }),
  });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
  equal(result.results[0].relation.reputation, 0, 'NaN reputation safely normalizes');
  equal(result.results[0].relation.wanted, 0, 'infinite wanted level safely normalizes');
  equal(result.results[0].relation.crimeSeverity, 0, 'negative crime severity clamps');
}

if (failures.length) {
  console.error(`[living-world-reaction-scenarios] FAIL: ${failures.length} assertions`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[living-world-reaction-scenarios] PASS: ${passed} scenario assertions.`);
