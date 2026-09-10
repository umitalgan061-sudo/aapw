import fs from 'node:fs';
import { createLivingWorldCompanionRuntime } from '../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js';

const failures = [];
let passed = 0;
const check = (value, message) => value ? passed++ : failures.push(message);
const actor = (id, x, z) => ({ id, position: { x, z }, object3D: { position: { x, z }, userData: {} } });
const makeServices = () => {
  const calls = [];
  return {
    calls,
    services: {
      perception: { getSignals: () => [] },
      factions: { getFactionIdForActor: () => 'watch' },
      reputation: { getReputation: () => 0 },
      diplomacy: { getRelation: () => 'neutral' },
      law: { getWantedLevel: () => 0, getCrimeSeverity: () => 0, reportCrime: (event) => { calls.push(['law', event]); return { accepted: true }; } },
      navigation: { requestTravel: (a, r) => { calls.push(['navigation', a.id, r]); return { accepted: true }; } },
      combat: { requestSupport: (a, t, r) => { calls.push(['support', a.id, t.id, r]); return { accepted: true }; }, requestAttack: (a, t, r) => { calls.push(['attack', a.id, t.id, r]); return { accepted: true }; } },
      worldEventsPublisher: { publish: (event) => { calls.push(['event', event]); return { accepted: true }; } },
    },
  };
};

// Ownership boundary: runtime applies commands but never takes ownership of the core registries.
{
  const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js', import.meta.url), 'utf8');
  check(!source.includes('new ActorRegistry'), 'does not instantiate ActorRegistry');
  check(!source.includes('createActorRegistry'), 'does not create ActorRegistry');
  check(!source.includes('EventBus'), 'does not create a second event bus');
  check(!source.includes('dispatchEvent'), 'does not own generic event dispatch');
  check(!source.includes('EditorMaterialStudio'), 'does not import editor material UI');
  check(!source.includes('new THREE.'), 'does not create scene objects');
  check(!source.includes('GLTFLoader'), 'does not load models');
  check(source.includes('existing-navigation-service'), 'navigation ownership is explicit');
  check(source.includes('existing-combat-service'), 'combat ownership is explicit');
  check(source.includes('worldEventsPublisher'), 'world event ownership is explicit');
}

// Navigation failures do not corrupt the companion lifecycle.
{
  const { services, calls } = makeServices();
  services.navigation.requestTravel = () => { throw new Error('navigation-outage'); };
  const target = actor('leader', 0, 0); const follower = actor('wolf', 15, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'nav-outage' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: { npcs: [target], animals: [follower], creatures: [], dragons: [] }, companions: [{ id: 'link', actorId: 'wolf', targetId: 'leader', mode: 'follow' }] });
  check(result.accepted === true, 'navigation exception does not reject runtime');
  check(result.results[0]?.navigation?.invoked === true, 'navigation exception is recorded as invoked');
  check(result.results[0]?.navigation?.error === 'navigation-outage', 'navigation error is visible');
  check(calls.length === 0, 'failed owner does not fabricate a successful call');
}

// Combat failures are similarly contained.
{
  const { services } = makeServices();
  services.perception.getSignals = (a) => a.id === 'leader' ? [{ id: 'enemy', confidence: 1, visible: true, audible: true, distanceMeters: 3, targetId: 'raider', position: { x: 4, z: 0 } }] : [];
  services.diplomacy.getRelation = () => 'war';
  services.combat.requestSupport = () => { throw new Error('combat-outage'); };
  const target = actor('leader', 0, 0); const follower = actor('wolf', 4, 0); const raider = actor('raider', 4, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'combat-outage' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: { npcs: [target, raider], animals: [follower], creatures: [], dragons: [] }, companions: [{ id: 'assist', actorId: 'wolf', targetId: 'leader', mode: 'assist' }] });
  check(result.accepted === true, 'combat exception does not reject runtime');
  check(result.results[0]?.combat?.error === 'combat-outage', 'combat error is recorded');
}

// Event publication failure stays out of navigation/combat state.
{
  const { services } = makeServices(); services.worldEventsPublisher.publish = () => { throw new Error('event-outage'); };
  const target = actor('leader', 0, 0); const follower = actor('wolf', 18, 0);
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'event-outage' });
  const result = runtime.tick({ deltaSeconds: 0.25, collections: { npcs: [target], animals: [follower], creatures: [], dragons: [] }, companions: [{ id: 'event', actorId: 'wolf', targetId: 'leader', mode: 'follow' }] });
  check(result.accepted === true, 'event exception does not reject runtime');
  check(result.results[0]?.state !== 'detached', 'event failure does not detach link');
}

// Per-link history never exceeds eight entries even after repeated movement/recovery cycles.
{
  const { services } = makeServices(); const target = actor('leader', 0, 0); const follower = actor('wolf', 40, 0); const collections = { npcs: [target], animals: [follower], creatures: [], dragons: [] }; const companions = [{ id: 'history', actorId: 'wolf', targetId: 'leader' }];
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'history' });
  for (let i = 0; i < 32; i += 1) {
    follower.position = { x: i % 2 ? 40 : 5, z: 0 }; follower.object3D.position = { x: i % 2 ? 40 : 5, z: 0 };
    runtime.tick({ deltaSeconds: 0.25, collections, companions, playerPosition: { x: 0, z: 0 } });
  }
  check(runtime.snapshot().links[0].history.length <= 8, 'history cap remains enforced');
}

// Reset is idempotent and returns the same initial state after repeated calls.
{
  const { services } = makeServices(); const target = actor('leader', 0, 0); const follower = actor('wolf', 8, 0); const runtime = createLivingWorldCompanionRuntime({ services, seed: 'idempotent-reset' }); const collections = { npcs: [target], animals: [follower], creatures: [], dragons: [] }; const companions = [{ id: 'reset', actorId: 'wolf', targetId: 'leader' }];
  const first = runtime.tick({ deltaSeconds: 0.25, collections, companions });
  runtime.reset(); runtime.reset();
  const second = runtime.tick({ deltaSeconds: 0.25, collections, companions });
  check(first.digest === second.digest, 'double reset preserves deterministic first digest');
}

// Dispose does not call downstream owners after shutdown.
{
  const { services, calls } = makeServices(); const target = actor('leader', 0, 0); const follower = actor('wolf', 8, 0); const runtime = createLivingWorldCompanionRuntime({ services }); const collections = { npcs: [target], animals: [follower], creatures: [], dragons: [] }; const companions = [{ id: 'disposed', actorId: 'wolf', targetId: 'leader' }];
  runtime.tick({ deltaSeconds: 0.25, collections, companions }); const before = calls.length; runtime.dispose(); runtime.tick({ deltaSeconds: 0.25, collections, companions });
  check(calls.length === before, 'disposed runtime does not call owners');
}

// Material/placement authority is explicitly outside this runtime.
{
  const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js', import.meta.url), 'utf8');
  check(!source.includes('MaterialAssignmentCore'), 'does not duplicate material assignment core');
  check(!source.includes('WorldAssetPlacementPipeline'), 'does not duplicate placement pipeline');
  check(!source.includes('assets/models/'), 'does not invent runtime asset paths');
}

if (failures.length) {
  console.error(`LIVING_WORLD_COMPANION_OWNERSHIP_FAIL ${failures.length}`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`LIVING_WORLD_COMPANION_OWNERSHIP_PASS checks=${passed}`);
