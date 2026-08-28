#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNPC } from '../src/3d/gameplay/npc.js';

function makeModel() {
  const model = new THREE.Group();
  model.animations = [];
  return model;
}

const assetLoader = {
  async loadFBXModel() {
    return makeModel();
  },
};

const groundCollider = {
  getGroundHeight() { return 0; },
};

const playerCollider = {
  resolveXZ(x, z) { return { x, z }; },
};

const npc = await createNPC({
  assetLoader,
  modelUrl: 'guard.fbx',
  idleAnimationUrl: 'idle.fbx',
  walkAnimationUrl: 'walk.fbx',
  worldX: 0,
  worldZ: 0,
  groundY: 0,
  rotationYRadians: 0,
  name: 'return-guard',
  groundCollider,
  playerCollider,
  patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: 12 }],
  speedMps: 1.4,
  pauseSeconds: 0,
  combatStanceTriggerRadiusMeters: 10,
  perceptionEnabled: true,
  simulationLodEnabled: false,
});

const intents = [];
const tick = (player) => {
  npc.update(0.25, player);
  intents.push(npc.object3D.userData.npcPerception?.intent ?? 'none');
};

// Acquire a visible target and leave the authored patrol route.
tick({ x: 0, z: 8 });
assert.equal(intents.at(-1), 'chase', 'visible acquired target outside engage radius must enter chase');
assert.ok(npc.object3D.position.z > 0, 'chase must physically displace the guard from its home waypoint');

// Lose contact. Investigation must persist before route recovery begins.
for (let i = 0; i < 48 && intents.at(-1) !== 'return'; i += 1) tick({ x: 100, z: 100 });
assert.ok(intents.includes('investigate'), 'lost contact must enter last-known investigation');
assert.equal(intents.at(-1), 'return', 'expired investigation must enter explicit route-return state');
assert.equal(npc.object3D.userData.npcPerception.returningToRoute, true,
  'return telemetry must stay latched until the patrol route is reacquired');

const returnStartDistance = Math.hypot(npc.object3D.position.x, npc.object3D.position.z);
assert.ok(returnStartDistance > 0.35, 'return must start while displaced from the patrol waypoint');

for (let i = 0; i < 80 && npc.object3D.userData.npcPerception?.intent !== 'patrol'; i += 1) tick({ x: 100, z: 100 });

const finalDistance = Math.hypot(npc.object3D.position.x, npc.object3D.position.z);
assert.equal(npc.object3D.userData.npcPerception.intent, 'patrol',
  'guard must only resume patrol after route reacquisition');
assert.equal(npc.object3D.userData.npcPerception.returningToRoute, false,
  'route-recovery latch must clear after arrival');
assert.equal(npc.object3D.userData.npcPerception.lastKnown, null,
  'stale last-known player target must clear after route recovery');
assert.ok(finalDistance <= 0.35, `guard must recover the patrol waypoint, got ${finalDistance.toFixed(3)}m`);
assert.ok(npc.object3D.userData.simulationTicks >= intents.length,
  'acceptance must run through shipped NPC simulation ticks');

npc.dispose();

console.log('NPC_GUARD_RETURN_TO_PATROL_PASS', JSON.stringify({
  intents: [...new Set(intents)],
  returnStartDistance: Number(returnStartDistance.toFixed(3)),
  finalDistance: Number(finalDistance.toFixed(3)),
  simulationTicks: npc.object3D.userData.simulationTicks,
}));
