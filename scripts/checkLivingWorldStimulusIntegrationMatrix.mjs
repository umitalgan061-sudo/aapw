import assert from 'node:assert/strict';
import { createLivingWorldStimulusOrchestrator } from '../src/3d/gameplay/livingWorldStimulusOrchestrator.js';
import { createLivingWorldStimulusAdapter } from '../src/3d/gameplay/livingWorldStimulusAdapter.js';
import { createLivingWorldStimulusWorkBudget } from '../src/3d/gameplay/livingWorldStimulusWorkBudget.js';
import { getLivingWorldRoleProfile } from '../src/3d/gameplay/livingWorldStimulusRolePolicy.js';

const roles = ['civilian', 'guard', 'hunter', 'predator', 'prey', 'merchant', 'traveler', 'healer', 'beast', 'unknown'];
const kinds = ['combat', 'damage', 'death', 'alarm', 'noise', 'fire', 'weather', 'resource', 'threat', 'sighting', 'territory', 'social', 'quest', 'environment', 'unknown'];
const channels = ['visual', 'auditory', 'tactical', 'social', 'environmental', 'system'];

function makeActor(index, role) {
  return {
    id: `${role}-${index}`,
    role,
    position: { x: index * 0.5, y: 0, z: index % 7 },
    staminaRatio: 0.75,
    healthRatio: 1,
    nearHome: index % 3 === 0,
    inCombat: index % 4 === 0,
    capabilities: {
      canAttack: role !== 'civilian' && role !== 'merchant',
      canAssist: role !== 'predator',
      canGather: role !== 'guard',
      canSocialize: !['predator', 'prey'].includes(role),
      canShelter: true,
      canPursue: !['civilian', 'merchant'].includes(role),
    },
  };
}

function makeSignal(kind, channel, index) {
  return {
    id: `${kind}-${channel}-${index}`,
    kind,
    channel,
    actorId: `actor-${index % 24}`,
    targetId: index % 2 ? 'player' : `target-${index % 8}`,
    position: { x: (index % 12) * 2, y: 0, z: (index % 9) * 3 },
    confidence: ((index * 19) % 101) / 100,
    intensity: ((index * 23) % 101) / 100,
    radius: 10 + (index % 60),
    timestampMs: index * 16,
    sequence: index,
    tags: [kind, channel, 'integration'],
  };
}

const actors = roles.flatMap((role, roleIndex) => Array.from({ length: 4 }, (_, i) => makeActor(roleIndex * 4 + i, role)));
const signals = kinds.flatMap((kind, kindIndex) => channels.map((channel, channelIndex) => makeSignal(kind, channel, kindIndex * channels.length + channelIndex)));

const runtime = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 48, maxPlansPerTick: 12 } });
const frames = [];
for (let tick = 0; tick < 20; tick += 1) {
  const frame = runtime.tickOnce({ deltaSeconds: 0.12, nowSeconds: tick * 0.12, actors, signals: tick === 0 ? signals : signals.slice(tick, tick + 20) });
  frames.push(frame);
  assert.ok(frame.decisions.length <= 12);
  assert.ok(frame.stats.rememberedSignals <= 192);
  assert.equal(frame.tick, tick + 1);
}
assert.ok(frames.some((frame) => frame.decisions.some((decision) => decision.decision.intent !== 'idle')));

const adapter = createLivingWorldStimulusAdapter();
let delivered = 0;
const unsubscribers = roles.slice(0, 6).map((role) => adapter.subscribe(role, (frame) => {
  delivered += frame.decisions.filter((decision) => decision.actorId.startsWith(role)).length;
}));
adapter.tick({ deltaSeconds: 0.16, nowSeconds: 4, actors, signals });
assert.ok(delivered >= 0);
for (const unsubscribe of unsubscribers) unsubscribe();
adapter.dispose();

const budget = createLivingWorldStimulusWorkBudget({ bucketCount: 8 });
const budgetPlan = budget.plan(actors.map((actor, index) => ({ ...actor, urgency: index % 5 === 0 ? 0.95 : 0.15, ageTicks: index }))); 
assert.equal(budgetPlan.length, 8);
assert.equal(budgetPlan.reduce((sum, bucket) => sum + bucket.count, 0), actors.length);
const selected = budget.select(actors.map((actor, index) => ({ ...actor, urgency: index % 5 === 0 ? 0.95 : 0.15 })), 16);
assert.equal(selected.selected.length, 16);
assert.equal(new Set(selected.selected.map((actor) => actor.id)).size, 16);

for (const role of roles) {
  const profile = getLivingWorldRoleProfile(role);
  assert.ok(profile.caution >= 0 && profile.caution <= 1);
  assert.ok(Object.keys(profile.weights).length > 0);
}

runtime.dispose();
console.log(`living-world stimulus integration matrix: PASS (${actors.length} actors, ${signals.length} signal combinations)`);
