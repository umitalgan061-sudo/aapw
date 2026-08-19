#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const proof = await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    .then(() => page.evaluate(async () => {
      const { createNPC } = await import('/src/3d/gameplay/npc.js');
      const { wrapNpcWithCombatDamage, wrapNpcWithHomeLeash } = await import('/src/3d/gameplay/livingWorldSpawner.js');
      const { AssetLoader } = await import('/src/3d/assetLoader.js');
      const { NPC_CONFIG } = await import('/src/3d/gameplay/npcConfig.js');
      const { EVENTS } = await import('/src/3d/config.js');

      const spawn = NPC_CONFIG.SPAWNS.find((entry) => entry.id === 'stannis-guard-1') ?? NPC_CONFIG.SPAWNS[0];
      if (!spawn?.patrol) throw new Error('configured patrol guard required');
      const assetLoader = new AssetLoader();
      const delta = 1 / 60;
      const groundCollider = { getGroundHeight: () => 0 };
      const passThroughCollider = { resolveXZ: (x, z) => ({ x, z }) };
      const damageEvents = [];
      const raw = await createNPC({
        assetLoader,
        modelUrl: spawn.modelUrl,
        idleAnimationUrl: NPC_CONFIG.IDLE_ANIMATION_URL,
        walkAnimationUrl: NPC_CONFIG.WALK_ANIMATION_URL,
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        rotationYRadians: 0,
        name: spawn.id,
        displayName: spawn.displayName,
        groundCollider,
        playerCollider: passThroughCollider,
        patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: -24 }],
        speedMps: NPC_CONFIG.PATROL_SPEED_MPS,
        pauseSeconds: NPC_CONFIG.PATROL_PAUSE_SECONDS,
        turnRateRadiansPerSecond: NPC_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
        combatStanceTriggerRadiusMeters: NPC_CONFIG.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
        combatStanceIdleTimeScale: NPC_CONFIG.COMBAT_STANCE_IDLE_TIME_SCALE,
        combatStanceTransitionSeconds: NPC_CONFIG.COMBAT_STANCE_TRANSITION_SECONDS,
        perceptionEnabled: true,
      });
      const leashed = wrapNpcWithHomeLeash(raw);
      const guard = wrapNpcWithCombatDamage(leashed, {
        eventsBus: { emit: (name, payload) => damageEvents.push({ name, payload }) },
        damageEventName: EVENTS.PLAYER_DAMAGED,
        attackerId: spawn.id,
      });

      let player = { x: 0, z: 8 };
      let sawChase = false;
      let maxHomeDistance = 0;
      let leashTriggered = false;
      for (let frame = 0; frame < 900; frame += 1) {
        guard.update(delta, player);
        const perception = guard.object3D.userData.npcPerception;
        if (perception?.intent === 'chase') sawChase = true;
        const homeDistance = Math.hypot(guard.object3D.position.x, guard.object3D.position.z);
        maxHomeDistance = Math.max(maxHomeDistance, homeDistance);
        if (guard.object3D.userData.npcLeash?.returning) {
          leashTriggered = true;
          break;
        }
        if (sawChase) player = { x: guard.object3D.position.x, z: guard.object3D.position.z + 8 };
      }
      const leashStateAtTrigger = { ...guard.object3D.userData.npcLeash };
      const perceptionAtTrigger = { ...guard.object3D.userData.npcPerception };
      const damageAtTrigger = damageEvents.length;

      const farPlayer = { x: 0, z: 60 };
      let minimumReturnDistance = Infinity;
      for (let frame = 0; frame < 1500; frame += 1) {
        guard.update(delta, farPlayer);
        minimumReturnDistance = Math.min(
          minimumReturnDistance,
          Math.hypot(guard.object3D.position.x, guard.object3D.position.z),
        );
        if (minimumReturnDistance <= 0.5) break;
      }
      const returnState = { ...guard.object3D.userData.npcLeash };
      const damageAfterReturn = damageEvents.length;

      const nearPlayer = { x: 0, z: 8 };
      let reacquired = false;
      for (let frame = 0; frame < 240; frame += 1) {
        guard.update(delta, nearPlayer);
        const leash = guard.object3D.userData.npcLeash;
        const perception = guard.object3D.userData.npcPerception;
        if (leash?.returning === false && ['observe', 'chase', 'combat'].includes(perception?.intent)) {
          reacquired = true;
          break;
        }
      }
      const finalLeash = { ...guard.object3D.userData.npcLeash };
      guard.dispose();

      return {
        modelUrl: spawn.modelUrl,
        patrolLengthMeters: 24,
        sawChase,
        maxHomeDistance,
        leashTriggered,
        leashStateAtTrigger,
        perceptionAtTrigger,
        damageAtTrigger,
        damageAfterReturn,
        minimumReturnDistance,
        returnState,
        reacquired,
        finalLeash,
      };
    }));

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.match(proof.modelUrl, /assets\/models\/characters\/.+\.fbx$/i, 'configured real character FBX must be used');
  assert.equal(proof.sawChase, true, 'real guard never entered chase');
  assert.equal(proof.leashTriggered, true, 'kited guard never triggered bounded home leash');
  assert.ok(proof.leashStateAtTrigger.playerHomeDistanceMeters > proof.leashStateAtTrigger.leashRadiusMeters,
    'leash must trigger from authored-home distance rather than arbitrary chase time');
  assert.equal(proof.perceptionAtTrigger.intent, 'return');
  assert.equal(proof.perceptionAtTrigger.reason, 'leash');
  assert.equal(proof.perceptionAtTrigger.lineOfSight, false, 'return must invalidate stale combat LOS');
  assert.equal(proof.damageAtTrigger, 0, '8m kite must remain chase-only before leash');
  assert.equal(proof.damageAfterReturn, proof.damageAtTrigger, 'returning guard must not deal stale combat damage');
  assert.ok(proof.minimumReturnDistance <= 0.5, `guard did not physically return home: ${proof.minimumReturnDistance}`);
  assert.equal(proof.returnState.returning, true, 'far player must not reacquire guard immediately after return');
  assert.equal(proof.reacquired, true, 'guard did not safely reacquire after player returned inside rejoin envelope');
  assert.equal(proof.finalLeash.returning, false);
  assert.ok(proof.patrolLengthMeters < proof.leashStateAtTrigger.leashRadiusMeters,
    'authored patrol span must stay inside home leash envelope');
  console.log('NPC_GUARD_LEASH_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
