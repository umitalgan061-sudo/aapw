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
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const proof = await page.evaluate(async () => {
    const { createNPC } = await import('/src/3d/gameplay/npc.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');
    const { NPC_CONFIG } = await import('/src/3d/gameplay/npcConfig.js');
    const { wrapNpcWithCombatDamage } = await import('/src/3d/gameplay/livingWorldSpawner.js');

    const grouped = new Map();
    for (const spawn of NPC_CONFIG.SPAWNS) {
      const peers = grouped.get(spawn.seatId) ?? [];
      peers.push(spawn);
      grouped.set(spawn.seatId, peers);
    }
    const pair = [...grouped.values()].find((peers) => peers.length >= 2)?.slice(0, 2);
    if (!pair) throw new Error('two configured same-settlement guards are required');

    const assetLoader = new AssetLoader();
    const delta = 1 / 60;
    const player = { x: 0, z: 0 };
    const groundCollider = { getGroundHeight: () => 0 };
    const passThroughCollider = { resolveXZ: (x, z) => ({ x, z }) };
    const attackChannel = { holders: new Map() };
    const events = [];
    let frame = 0;

    async function makeGuard(spawn, worldX) {
      const npc = await createNPC({
        assetLoader,
        modelUrl: spawn.modelUrl,
        idleAnimationUrl: NPC_CONFIG.IDLE_ANIMATION_URL,
        walkAnimationUrl: NPC_CONFIG.WALK_ANIMATION_URL,
        worldX,
        worldZ: 0,
        groundY: 0,
        rotationYRadians: 0,
        name: spawn.id,
        displayName: spawn.displayName,
        groundCollider,
        playerCollider: passThroughCollider,
        speedMps: NPC_CONFIG.PATROL_SPEED_MPS,
        turnRateRadiansPerSecond: NPC_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
        combatStanceTriggerRadiusMeters: NPC_CONFIG.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
        combatStanceIdleTimeScale: NPC_CONFIG.COMBAT_STANCE_IDLE_TIME_SCALE,
        combatStanceTransitionSeconds: NPC_CONFIG.COMBAT_STANCE_TRANSITION_SECONDS,
        perceptionEnabled: true,
      });
      return wrapNpcWithCombatDamage(npc, {
        eventsBus: { emit: (name, payload) => events.push({ frame, name, payload }) },
        damageEventName: 'player:damaged',
        attackChannel,
        attackGroupId: spawn.seatId,
        attackerId: spawn.id,
      });
    }

    const first = await makeGuard(pair[0], -2);
    const second = await makeGuard(pair[1], 2);
    let sawHold = false;
    let sawSingleSlot = false;
    for (frame = 0; frame < 360; frame += 1) {
      first.update(delta, player);
      second.update(delta, player);
      const firstAttack = first.object3D.userData.npcAttack;
      const secondAttack = second.object3D.userData.npcAttack;
      if (firstAttack?.phase === 'hold' || secondAttack?.phase === 'hold') sawHold = true;
      if (Number(firstAttack?.ownsAttackSlot) + Number(secondAttack?.ownsAttackSlot) === 1) sawSingleSlot = true;
      if (events.some((entry) => entry.payload.sourceId === pair[0].id)
        && events.some((entry) => entry.payload.sourceId === pair[1].id)) break;
    }

    const hitsByFrame = new Map();
    for (const event of events) hitsByFrame.set(event.frame, (hitsByFrame.get(event.frame) ?? 0) + 1);
    const maxHitsInFrame = Math.max(0, ...hitsByFrame.values());
    const firstHits = events.filter((entry) => entry.payload.sourceId === pair[0].id).length;
    const secondHits = events.filter((entry) => entry.payload.sourceId === pair[1].id).length;
    const finalHolderCount = attackChannel.holders.size;
    first.dispose();
    second.dispose();

    return {
      groupId: pair[0].seatId,
      modelUrls: pair.map((spawn) => spawn.modelUrl),
      firstHits,
      secondHits,
      totalHits: events.length,
      maxHitsInFrame,
      sawHold,
      sawSingleSlot,
      finalHolderCount,
      holdersAfterDispose: attackChannel.holders.size,
    };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(proof.modelUrls.length, 2);
  assert.ok(proof.modelUrls.every((url) => /assets\/models\/characters\/.+\.fbx$/i.test(url)), `configured FBX models not used: ${proof.modelUrls.join(', ')}`);
  assert.ok(proof.firstHits >= 1, 'first configured guard never completed an attack');
  assert.ok(proof.secondHits >= 1, 'waiting same-settlement guard never received a later attack turn');
  assert.equal(proof.maxHitsInFrame, 1, 'same-settlement guards stacked damage in one frame');
  assert.equal(proof.sawHold, true, 'browser runtime never exposed a blocked teammate hold state');
  assert.equal(proof.sawSingleSlot, true, 'browser runtime never exposed exactly one active attack slot');
  assert.ok(proof.finalHolderCount <= 1, 'attack channel exceeded one holder before dispose');
  assert.equal(proof.holdersAfterDispose, 0, 'dispose leaked a settlement attack slot');
  console.log('NPC_GUARD_ATTACK_GROUP_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
