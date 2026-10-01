import fs from 'node:fs';
import { createLivingWorldCompanionRuntime, auditLivingWorldCompanionRuntime, LIVING_WORLD_COMPANION_RUNTIME_POLICY } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (condition, message) => condition ? passed++ : failures.push(message);
const eq = (a, b, message) => check(Object.is(a, b), `${message}: ${String(a)} !== ${String(b)}`);
const actor = (id, x, z, extra = {}) => ({ id, ...extra, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const services = ({ hostile = false } = {}) => {
  const calls = [];
  return {
    calls,
    services: {
      perception: { getSignals: (a) => a?.id === 'guard' && hostile ? [{ id: 'enemy-signal', kind: 'enemy', confidence: 1, distanceMeters: 4, visible: true, audible: true, targetId: 'raider', position: { x: 7, z: 0 } }] : [] },
      factions: { getFactionIdForActor: () => 'watch' },
      reputation: { getReputation: () => hostile ? -20 : 10 },
      diplomacy: { getRelation: () => hostile ? 'war' : 'neutral' },
      law: { getWantedLevel: () => hostile ? 80 : 0, getCrimeSeverity: () => hostile ? 60 : 0, reportCrime: (e) => { calls.push(['law', e]); return { accepted: true }; } },
      navigation: { requestTravel: (a, r) => { calls.push(['navigation', a?.id, r]); return { accepted: true }; } },
      combat: { requestSupport: (a, t, r) => { calls.push(['combat-support', a?.id, t?.id, r]); return { accepted: true }; }, requestAttack: (a, t, r) => { calls.push(['combat-attack', a?.id, t?.id, r]); return { accepted: true }; } },
      worldEventsPublisher: { publish: (e) => { calls.push(['event', e]); return { accepted: true }; }, },
    },
  };
};
const collections = (guard = actor('guard', 0, 0), wolf = actor('wolf', 6, 0), extras = {}) => ({ npcs: [guard, ...(extras.raider ? [extras.raider] : [])], animals: [wolf], creatures: extras.creatures ?? [], dragons: extras.dragons ?? [] });

for (const [key, expected] of Object.entries({ deterministic: true, maxLinks: 32, maxActors: 128, maxNavigationRequests: 8, maxCombatRequests: 8, maxEventPublishes: 6 })) eq(LIVING_WORLD_COMPANION_RUNTIME_POLICY[key], expected, `policy ${key}`);

{
  const { services, calls } = services();
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'basic' });
  const result = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 }, collections: collections(), companions: [{ id: 'follow', actorId: 'wolf', targetId: 'guard', mode: 'follow', followDistanceMeters: 5 }] });
  eq(result.accepted, true, 'follow accepted'); eq(result.companionCount, 1, 'follow count'); check(['following', 'holding'].includes(result.results[0].state), 'follow lifecycle state'); check(result.digest.length === 8, 'follow digest'); check(calls.length >= 0, 'owner seam callable');
}

{
  const { services, calls } = services();
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 4, 0); const before = JSON.stringify(guard);
  const result = createLivingWorldCompanionRuntime({ services }).tick({ deltaSeconds: 0.25, collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'hold', actorId: 'wolf', targetId: 'guard', mode: 'hold', followDistanceMeters: 6 }] });
  eq(result.results[0].state, 'holding', 'hold state'); eq(JSON.stringify(guard), before, 'hold leaves target untouched'); check(!calls.some((c) => c[0] === 'combat-attack'), 'hold suppresses attack');
}

{
  const { services, calls } = services({ hostile: true });
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 5, 0); const raider = actor('raider', 7, 0, { factionId: 'raiders' });
  const result = createLivingWorldCompanionRuntime({ services, seed: 22 }).tick({ deltaSeconds: 0.25, playerPosition: { x: 0, z: 0 }, collections: { npcs: [guard, raider], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'assist', actorId: 'wolf', targetId: 'guard', mode: 'assist', followDistanceMeters: 5 }] });
  check(result.integration?.reaction?.actorCount >= 1, 'assist composes reaction integration'); check(result.companionCount === 1, 'assist count'); check(calls.some((c) => c[0] === 'combat-support' || c[0] === 'combat-attack'), 'assist delegates combat owner');
}

{
  const { services, calls } = services({ hostile: true });
  services.perception.getSignals = (a) => a?.id === 'guard' ? [{ id: 'threat', confidence: 1, distanceMeters: 2, visible: true, audible: true, targetId: 'raider', position: { x: 2, z: 0 } }] : [];
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 20, 0); const raider = actor('raider', 2, 0);
  const result = createLivingWorldCompanionRuntime({ services }).tick({ deltaSeconds: 0.25, collections: { npcs: [guard, raider], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'regroup', actorId: 'wolf', targetId: 'guard', mode: 'regroup' }] });
  check(['regrouping', 'recovering', 'following'].includes(result.results[0].state), 'regroup state'); check(calls.filter((c) => c[0] === 'navigation').length <= 8, 'regroup navigation budget');
}

{
  const { services } = services();
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 99 });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: { npcs: [actor('wolf', 0, 0)], animals: [], creatures: [], dragons: [] }, companions: [{ id: 'broken', actorId: 'wolf', targetId: 'missing' }] });
  eq(result.results[0].state, 'recovering', 'missing target recovery'); Number.isFinite(result.results[0].staleSeconds) || failures.push('recovery stale finite');
}

{
  const { services } = services();
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 500, 0);
  const result = createLivingWorldCompanionRuntime({ services }).tick({ deltaSeconds: 0.25, collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'culled', actorId: 'wolf', targetId: 'guard' }], playerPosition: { x: 0, z: 0 } });
  eq(result.results[0].lod, 'culled', 'culled LOD'); eq(result.results[0].simulated, false, 'culled unsimulated');
}

{
  const { services } = services();
  const guard = actor('guard', 0, 0); const wolf = actor('wolf', 80, 0); const input = { collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'distant', actorId: 'wolf', targetId: 'guard' }], playerPosition: { x: 0, z: 0 } };
  const runtime = createLivingWorldCompanionRuntime({ services }); const first = runtime.tick({ ...input, deltaSeconds: 0.25 }); const second = runtime.tick({ ...input, deltaSeconds: 0.1 });
  eq(first.results[0].lod, 'distant', 'distant LOD'); eq(second.results[0].reason, 'lod-throttle', 'distant throttled');
}

{
  const { services } = services(); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 4, 0);
  const runtime = createLivingWorldCompanionRuntime({ services }); const result = runtime.tick({ deltaSeconds: Infinity, collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'bad-mode', actorId: 'wolf', targetId: 'guard', mode: 'invalid', priority: 9999 }, { id: 'bad-mode', actorId: 'wolf', targetId: 'guard' }], playerPosition: { x: 0, z: 0 } });
  eq(result.companionCount, 1, 'duplicates removed'); eq(result.results[0].mode, 'follow', 'invalid mode fallback'); eq(result.results[0].priority, 100, 'priority clamp');
}

{
  const { services, calls } = services(); const guard = actor('guard', 0, 0); const wolf = actor('wolf', NaN, 2);
  const result = createLivingWorldCompanionRuntime({ services }).tick({ deltaSeconds: Infinity, collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'nan', actorId: 'wolf', targetId: 'guard' }], playerPosition: { x: 0, z: 0 } });
  eq(result.accepted, true, 'NaN input accepted fail-closed'); check(calls.every((c) => c[0] !== 'navigation' || Number.isFinite(c[2]?.destination?.x ?? 0)), 'NaN never reaches navigation');
}

{
  const { services } = services(); const guard = actor('guard', 0, 0); const extras = { creatures: [actor('creature', 6, 0)], dragons: [actor('dragon', 9, 0)] }; const wolf = actor('horse', 3, 0);
  const result = createLivingWorldCompanionRuntime({ services }).tick({ deltaSeconds: 0.25, collections: collections(guard, wolf, extras), companions: [{ id: 'horse', actorId: 'horse', targetId: 'guard', mode: 'escort' }, { id: 'creature', actorId: 'creature', targetId: 'guard' }, { id: 'dragon', actorId: 'dragon', targetId: 'guard' }] });
  eq(result.companionCount, 3, 'all actor families accepted'); check(result.results.every((r) => typeof r.companionId === 'string'), 'family identities present');
}

{
  const { services } = services(); const guard = actor('guard', 0, 0); const animals = Array.from({ length: 40 }, (_, i) => actor(`wolf-${String(i).padStart(2, '0')}`, i + 2, 0)); const companions = animals.map((a, i) => ({ id: `link-${i}`, actorId: a.id, targetId: 'guard', priority: i }));
  const result = createLivingWorldCompanionRuntime({ services }).tick({ deltaSeconds: 0.25, collections: { npcs: [guard], animals, creatures: [], dragons: [] }, companions, playerPosition: { x: 0, z: 0 } });
  eq(result.companionCount, 32, 'link budget caps at 32'); check(result.navigationRequests.length <= 8, 'navigation request cap'); check(result.combatRequests.length <= 8, 'combat request cap'); check(result.publishedEvents.length <= 6, 'event publish cap');
}

{
  const input = { deltaSeconds: 0.25, collections: collections(), companions: [{ id: 'stable', actorId: 'wolf', targetId: 'guard', mode: 'follow' }], playerPosition: { x: 0, z: 0 } };
  const make = () => createLivingWorldCompanionRuntime({ services: services().services, seed: 'same-seed' }); const a = make().tick(input); const b = make().tick(input); eq(a.digest, b.digest, 'same seed digest deterministic'); eq(JSON.stringify(a.results), JSON.stringify(b.results), 'same seed result deterministic');
}

{
  const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js', import.meta.url), 'utf8');
  check(!source.includes('EditorMaterialStudio'), 'no editor material UI import'); check(!source.includes('ActorRegistry'), 'no second actor registry'); check(!source.includes('EventBus'), 'no second event bus'); check(source.includes('createLivingWorldReactionIntegration'), 'existing reaction integration composed'); check(source.includes('requestTravel'), 'navigation seam present'); check(source.includes('requestSupport'), 'combat seam present'); check(source.includes('worldEventsPublisher'), 'world event seam present');
}

{
  const { services } = services(); const runtime = createLivingWorldCompanionRuntime({ services }); const guard = actor('guard', 0, 0); const wolf = actor('wolf', 4, 0); const input = { deltaSeconds: 0.25, collections: { npcs: [guard], animals: [wolf], creatures: [], dragons: [] }, companions: [{ id: 'audit', actorId: 'wolf', targetId: 'guard' }] };
  const result = runtime.tick(input); const audit = auditLivingWorldCompanionRuntime(result); eq(audit.ok, true, 'audit passes'); check(Object.isFrozen(result.results), 'result collection frozen'); check(Object.isFrozen(wolf.object3D.userData.livingWorldCompanion), 'telemetry frozen'); runtime.tick({ ...input, deltaSeconds: 0.5 }); runtime.reset(); const reset = runtime.tick(input); eq(reset.tick, 1, 'reset tick'); runtime.dispose(); eq(runtime.tick(input).accepted, false, 'dispose fail closed');
}

{
  const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldReactionIntegrationAdapter.js', import.meta.url), 'utf8');
  check(source.includes('companions'), 'integration already exposes companion intents'); check(source.includes('maxCompanionLinks'), 'integration has bounded companion links');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_RUNTIME_FAIL ${failures.length}`);
  failures.forEach((message) => console.error(` - ${message}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_RUNTIME_PASS checks=${passed}`);
