import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
const errors = [];
const requests = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('requestfailed', (request) => requests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`));

try {
  await page.goto(`${baseUrl}/game3d.html?livingWorldReactionIntegrationProof=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const proof = await page.evaluate(async () => {
    const THREE = await import('./src/3d/vendor/three/three.module.js');
    const { createLivingWorldReactionIntegration, auditLivingWorldReactionIntegration } = await import('./src/3d/gameplay/livingWorldReactionIntegrationAdapter.js');
    const { LIVING_WORLD_GROUP_DIRECTOR_POLICY } = await import('./src/3d/gameplay/livingWorldGroupDirectorAdapter.js');
    const { LIVING_WORLD_DIRECTOR_POLICY } = await import('./src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js');

    const calls = [];
    function makeActor(id, x, z, factionId, kind = 'npc') {
      const object3D = new THREE.Object3D();
      object3D.name = id;
      object3D.position.set(x, 0, z);
      object3D.userData = {};
      return { id, factionId, kind, object3D, update() { calls.push(`update:${id}`); } };
    }

    const guardA = makeActor('integration-browser-a', 10, 10, 'watch');
    const guardB = makeActor('integration-browser-b', 12, 10, 'watch');
    const wolf = makeActor('integration-browser-wolf', 40, 40, 'wildlife', 'animal');
    const integration = createLivingWorldReactionIntegration({
      seed: 'browser-integration',
      clockSeconds: 21600,
      services: {
        perception: { sense(actor) { calls.push(`sense:${actor.id}`); return []; } },
        factions: { getFactionIdForActor(actor) { return actor.factionId; } },
        occupation: { buildOccupationDirective(schedule) { calls.push(`occupation:${schedule.activityId ?? 'none'}`); return { phase: schedule.phase ?? 'work', activityId: schedule.activityId ?? 'idle', locationId: schedule.locationId ?? '', shouldTravel: false }; } },
        navigation: { requestTravel(actor, destination, directive) { calls.push(`nav:${actor.id}:${directive.kind}`); return Boolean(destination); } },
        worldEvents: { publish(event) { calls.push(`event:${event.type}`); return true; } },
      },
    });

    const result = integration.tick({
      deltaSeconds: 0.2,
      collections: { npcs: [guardA, guardB], animals: [wolf], creatures: [], dragons: [] },
      occupations: [{ controller: guardA, definition: { phase: 'work', activityId: 'watch', locationId: 'gate' } }],
      groups: [{ id: 'watch-group', members: [guardA, guardB], threatPositions: [{ x: 11, z: 12 }], seed: 'formation-proof' }],
      faunaRequests: [],
      eventContext: { worldSeed: 'browser-integration', playerX: 0, playerZ: 0, clockSeconds: 21600 },
      eventTypes: ['traveller_sighting'],
      playerPosition: { x: 0, z: 0 },
    });

    if (!result.accepted) throw new Error('composed result is not accepted');
    if (result.actorCount !== 3) throw new Error(`unexpected actor count ${result.actorCount}`);
    if (result.reaction.actorCount !== 3) throw new Error('reaction layer did not see the same collection');
    if (result.groups.groupCount !== 1) throw new Error('existing group director did not produce group evidence');
    if (result.director == null) throw new Error('existing living-world director output is missing');
    if (result.reaction.results.some((entry) => entry.phase !== 'patrol')) throw new Error('no-signal composition left patrol');
    if (!calls.includes('occupation:watch')) throw new Error('occupation owner was not read by composed director');
    if (!calls.includes('sense:integration-browser-a') || !calls.includes('sense:integration-browser-wolf')) throw new Error('perception owner did not observe all actor classes');
    if (auditLivingWorldReactionIntegration(result).ok !== true) throw new Error('composition audit failed');
    if (result.groups.policyId !== LIVING_WORLD_GROUP_DIRECTOR_POLICY.id) throw new Error('group policy identity drift');
    if (result.director.policyId !== LIVING_WORLD_DIRECTOR_POLICY.id) throw new Error('director policy identity drift');

    const second = integration.tick({ deltaSeconds: 0.2, collections: { npcs: [guardA, guardB], animals: [wolf] }, groups: [], playerPosition: { x: 0, z: 0 } });
    if (second.tick !== 2) throw new Error('integration tick counter did not advance exactly once');
    if (second.ownerSnapshot.actors.length !== 3) throw new Error('owner snapshot actor count drifted');

    const auditBeforeDispose = integration.audit();
    if (!auditBeforeDispose.ok) throw new Error(`audit-before-dispose failed: ${auditBeforeDispose.errors.join(',')}`);
    integration.dispose();
    if (integration.tick({ deltaSeconds: 0.1, collections: { npcs: [guardA] } }).accepted) throw new Error('disposed integration accepted a tick');

    return {
      threeRevision: THREE.REVISION,
      actorCount: result.actorCount,
      reactionActorCount: result.reaction.actorCount,
      groupCount: result.groups.groupCount,
      directorPolicy: result.director.policyId,
      groupPolicy: result.groups.policyId,
      tick: second.tick,
      callCount: calls.length,
    };
  });

  assert.equal(proof.actorCount, 3);
  assert.equal(proof.reactionActorCount, 3);
  assert.equal(proof.groupCount, 1);
  assert.equal(proof.tick, 2);
  assert.ok(proof.callCount >= 5);
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.equal(requests.length, 0, requests.join(' | '));
  console.log(JSON.stringify({ pass: true, ...proof }, null, 2));
} finally {
  await browser.close();
}
