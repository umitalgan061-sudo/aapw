import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`));

function summarizeErrors() {
  return [
    ...consoleErrors.map((value) => `console:${value}`),
    ...pageErrors.map((value) => `page:${value}`),
    ...requestFailures.map((value) => `request:${value}`),
  ];
}

try {
  await page.goto(`${baseUrl}/game3d.html?livingWorldReactionProof=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  const result = await page.evaluate(async () => {
    const THREE = await import('./src/3d/vendor/three/three.module.js');
    const {
      createLivingWorldReactionRuntime,
      auditLivingWorldReactionResult,
      LIVING_WORLD_REACTION_RUNTIME_POLICY,
    } = await import('./src/3d/gameplay/livingWorldReactionRuntime.js');
    const {
      collectLivingWorldReactionEvidence,
      validateLivingWorldReactionEvidence,
      buildLivingWorldReactionAcceptanceSummary,
    } = await import('./src/3d/gameplay/livingWorldReactionEvidence.js');

    const makeActor = ({ id, x, z, factionId = 'north-watch', kind = 'npc', traits = {}, schedule = null }) => {
      const object3D = new THREE.Object3D();
      object3D.name = id;
      object3D.position.set(x, 0, z);
      object3D.userData = {
        kind,
        factionId,
        materialEvidence: {
          validated: true,
          surfaceCount: kind === 'npc' ? 5 : 4,
          materialSlotCount: kind === 'npc' ? 5 : 4,
          roles: kind === 'npc' ? ['skin', 'hair', 'cloth', 'boots', 'gear'] : ['fur', 'eye', 'claw', 'tooth'],
          paletteIds: [kind === 'npc' ? 'watch-npc' : 'wolf-coat'],
          textures: [{ name: 'albedo', width: 1024, height: 1024, map: 'map' }],
        },
        placementEvidence: {
          accepted: true,
          groundAligned: true,
          navAligned: true,
          habitatAccepted: true,
          waterSafe: true,
          slopeSafe: true,
          placementDigest: `placement:${id}`,
          materialDigest: `material:${id}`,
          provenance: '#590',
        },
      };
      return {
        id,
        object3D,
        factionId,
        traits,
        occupationSchedule: schedule,
        updates: 0,
        update(delta) {
          if (Number.isFinite(delta) && delta >= 0) this.updates += 1;
        },
      };
    };

    const calls = [];
    const patrol = makeActor({ id: 'browser-guard', x: 10, z: 10, schedule: { phase: 'work', activityId: 'gate-watch', locationId: 'north-gate', shouldTravel: false } });
    const hostile = makeActor({ id: 'browser-raider', x: 18, z: 10, factionId: 'raiders' });
    const wolf = makeActor({ id: 'browser-wolf', x: 30, z: 30, factionId: 'wildlife', kind: 'animal', traits: { fleeWhenOutnumbered: true } });
    let senseMode = 'hostile';
    const services = {
      perception: {
        sense(actor) {
          calls.push(`sense:${actor.id}`);
          if (actor.id === hostile.id) {
            return senseMode === 'none' ? [] : [{
              id: 'raider-seen', kind: 'enemy', confidence: 0.99, distanceMeters: 12,
              visible: true, suspicious: true, audible: false, targetId: hostile.id,
              position: { x: 18, z: 10 }, severity: 80,
            }];
          }
          if (actor.id === wolf.id) {
            return [{
              id: 'hunter-seen', kind: 'predator', confidence: 1, distanceMeters: 8,
              visible: true, suspicious: true, targetId: 'hunter',
              position: { x: 30, z: 38 }, severity: 40,
            }];
          }
          return [];
        },
      },
      factions: { getFactionIdForActor(actor) { return actor.factionId; } },
      reputation: { getReputation(_actor, target) { return target?.id === hostile.id ? -75 : 0; } },
      diplomacy: { getRelation(actorFaction, targetFaction) { return actorFaction === 'north-watch' && targetFaction === 'raiders' ? 'war' : 'neutral'; } },
      law: {
        getWantedLevel(target) { return target?.id === hostile.id ? 90 : 0; },
        getCrimeSeverity(target) { return target?.id === hostile.id ? 75 : 0; },
        reportCrime(event) { calls.push(`crime:${event.actorId}:${event.targetId}`); return true; },
      },
      encounters: {
        shouldChase(_relation, signal) { return signal?.target?.id === hostile.id; },
        canAttack(relation, signal) { return relation.hostile && signal?.target?.id === hostile.id; },
        requestAttack(actor, targetId) { calls.push(`attack:${actor.id}:${targetId}`); return true; },
      },
      navigation: {
        requestTravel(actor, destination, directive) { calls.push(`nav:${actor.id}:${directive.kind}`); return Boolean(destination); },
      },
      worldEvents: { publish(event) { calls.push(`event:${event.type}:${event.actorId}`); return true; } },
      occupation: {
        buildOccupationDirective(schedule) {
          calls.push(`occupation:${schedule.activityId}`);
          return { phase: schedule.phase, activityId: schedule.activityId, locationId: schedule.locationId, shouldTravel: false };
        },
      },
    };

    const runtime = createLivingWorldReactionRuntime({ actors: [patrol, hostile, wolf], services, seed: 'browser-reaction', clockSeconds: 21600 });
    const ticks = [];
    ticks.push(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
    ticks.push(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
    ticks.push(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));
    ticks.push(runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } }));

    const hostilePhases = ticks.map((tick) => tick.results.find((entry) => entry.actorId === hostile.id)?.phase);
    if (JSON.stringify(hostilePhases) !== JSON.stringify(['detect', 'investigate', 'chase', 'attack'])) throw new Error(`unexpected hostile chain ${JSON.stringify(hostilePhases)}`);
    const attackResult = ticks[3].results.find((entry) => entry.actorId === hostile.id);
    if (!attackResult?.combat?.invoked) throw new Error('browser combat adapter was not invoked');
    if (attackResult.relation.reputation !== -75 || attackResult.relation.wanted !== 90 || !attackResult.relation.reportable) throw new Error('browser law/reputation/diplomacy reaction missing');
    if (patrol.updates < 1 || hostile.updates < 1 || wolf.updates < 1) throw new Error('browser controller collection did not update');
    if (!calls.some((entry) => entry.startsWith('nav:browser-raider:chase'))) throw new Error('chase navigation was not delegated');
    if (!calls.some((entry) => entry.startsWith('attack:browser-raider'))) throw new Error('attack was not delegated');
    if (!calls.some((entry) => entry.startsWith('crime:browser-raider'))) throw new Error('law report was not delegated');
    if (!calls.some((entry) => entry.startsWith('event:'))) throw new Error('world event was not delegated');
    if (!calls.includes('occupation:gate-watch')) throw new Error('occupation was not observed');

    senseMode = 'none';
    const recovered = runtime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    const recoveredHostile = recovered.results.find((entry) => entry.actorId === hostile.id);
    if (recoveredHostile?.phase !== 'return') throw new Error(`lost target did not return: ${recoveredHostile?.phase}`);
    if (recoveredHostile.directive.kind !== 'return') throw new Error('return directive missing');

    const evidence = collectLivingWorldReactionEvidence({ actors: [patrol, hostile, wolf], playerPosition: { x: 0, z: 0 }, frameMs: 14.2, tickMs: 2.1, sceneAssetCount: 3 });
    const evidenceValidation = validateLivingWorldReactionEvidence(evidence);
    if (!evidenceValidation.ok) throw new Error(`reaction evidence invalid: ${evidenceValidation.errors.join(',')}`);
    const acceptance = buildLivingWorldReactionAcceptanceSummary(evidence, recovered);
    if (!acceptance.accepted) throw new Error(`reaction acceptance failed: ${JSON.stringify(acceptance)}`);
    if (evidence.summary.rejectedActors !== 0) throw new Error('evidence contains rejected actors');
    if (evidence.sharedContract.material !== 'src/3d/materials/MaterialAssignmentCore.js') throw new Error('shared material core drift');
    if (evidence.sharedContract.placement !== 'src/3d/world/WorldAssetPlacementPipeline.js') throw new Error('shared placement core drift');

    const farA = makeActor({ id: 'far-a', x: 210, z: 0 });
    const farB = makeActor({ id: 'far-b', x: 500, z: 0 });
    const lodRuntime = createLivingWorldReactionRuntime({ actors: [farA, farB], services: { perception: { sense() { return []; } } }, seed: 'lod-proof' });
    const lodFirst = lodRuntime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    const lodSecond = lodRuntime.tick({ deltaSeconds: 0.2, playerPosition: { x: 0, z: 0 } });
    const lodThird = lodRuntime.tick({ deltaSeconds: 1, playerPosition: { x: 0, z: 0 } });
    const farOne = lodFirst.results.find((entry) => entry.actorId === 'far-a');
    const farTwo = lodFirst.results.find((entry) => entry.actorId === 'far-b');
    if (farOne?.lod !== 'far' || farTwo?.lod !== 'culled') throw new Error('browser LOD classification failed');
    if (lodSecond.results.find((entry) => entry.actorId === 'far-a')?.simulated !== false) throw new Error('far LOD did not throttle');
    if (lodThird.results.find((entry) => entry.actorId === 'far-a')?.simulated !== false) throw new Error('far LOD simulation cadence exceeded the bounded interval');

    const audited = auditLivingWorldReactionResult(recovered);
    if (!audited.ok) throw new Error(`runtime result audit failed: ${audited.errors.join(',')}`);
    return {
      threeRevision: THREE.REVISION,
      object3DCount: [patrol, hostile, wolf].filter((actor) => actor.object3D instanceof THREE.Object3D).length,
      hostilePhases,
      recoveredPhase: recoveredHostile.phase,
      evidenceDigest: evidence.digest,
      evidenceAccepted: acceptance.accepted,
      sharedMaterialCore: evidence.sharedContract.material,
      sharedPlacementCore: evidence.sharedContract.placement,
      lod: { sensingInterval: LIVING_WORLD_REACTION_RUNTIME_POLICY.sensingIntervalSeconds, far: farOne.lod, culled: farTwo.lod },
      callCount: calls.length,
    };
  });

  assert.equal(result.object3DCount, 3);
  assert.deepEqual(result.hostilePhases, ['detect', 'investigate', 'chase', 'attack']);
  assert.equal(result.recoveredPhase, 'return');
  assert.equal(result.evidenceAccepted, true);
  assert.equal(result.lod.far, 'far');
  assert.equal(result.lod.culled, 'culled');
  assert.ok(result.callCount >= 8);
  assert.equal(consoleErrors.length, 0, summarizeErrors().join(' | '));
  assert.equal(pageErrors.length, 0, summarizeErrors().join(' | '));
  assert.equal(requestFailures.length, 0, summarizeErrors().join(' | '));
  console.log(JSON.stringify({ pass: true, ...result }, null, 2));
} finally {
  await browser.close();
}
