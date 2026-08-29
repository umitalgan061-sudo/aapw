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

const tickSeconds = 0.25;
const speedMps = 1.4;
const returnSpeedMps = speedMps * 0.8;
const patrolWaypoints = [{ x: 0, z: 0 }, { x: 0, z: 12 }];
const recoveryWaypoint = patrolWaypoints[1];

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
  patrolWaypoints,
  speedMps,
  pauseSeconds: 0,
  combatStanceTriggerRadiusMeters: 10,
  perceptionEnabled: true,
  simulationLodEnabled: false,
});

const intents = [];
const tick = (player, delta = tickSeconds) => {
  npc.update(delta, player);
  intents.push(npc.object3D.userData.npcPerception?.intent ?? 'none');
};

// Begin on the authored route with no actionable target. The acceptance must prove the
// full shipped patrol -> detect/observe -> chase chain instead of starting after detection.
tick({ x: 100, z: 100 });
assert.equal(intents.at(-1), 'patrol', 'guard must begin in authored patrol state before detection');

// A short visible sample must register deterministic visual detection without immediately
// skipping the shipped suspicion/observe stage.
tick({ x: 0, z: 8 }, 0.1);
assert.equal(intents.at(-1), 'observe', 'first visible sample must enter the shipped detect/observe stage');
assert.equal(npc.object3D.userData.npcPerception.lineOfSight, true,
  'visual detection must be backed by the shipped line-of-sight query');
assert.match(npc.object3D.userData.npcPerception.reason, /^(vision|peripheral)$/,
  'detect/observe must report a visual awareness reason');

// Sustained visual acquisition must cross suspicion threshold and leave the authored route.
tick({ x: 0, z: 8 }, 0.1);
assert.equal(intents.at(-1), 'chase', 'sustained visible target outside engage radius must enter chase');
assert.ok(npc.object3D.position.z > 0, 'chase must physically displace the guard from its home waypoint');

// Close into the shipped engage radius before contact is lost. This keeps the acceptance
// vertical slice honest: patrol/detect must prove the real chase -> combat handoff, not just pursuit.
tick({ x: npc.object3D.position.x, z: npc.object3D.position.z + 1 });
assert.equal(intents.at(-1), 'combat', 'chase must hand off to combat inside the shipped engage radius');
assert.ok(npc.object3D.userData.combatStanceBlend > 0,
  'combat intent must drive the shipped combat-stance runtime blend');

// Lose contact. Investigation must persist before route recovery begins.
for (let i = 0; i < 48 && intents.at(-1) !== 'return'; i += 1) tick({ x: 100, z: 100 });
assert.ok(intents.includes('investigate'), 'lost contact must enter last-known investigation');
assert.equal(intents.at(-1), 'return', 'expired investigation must enter explicit route-return state');
assert.equal(npc.object3D.userData.npcPerception.returningToRoute, true,
  'return telemetry must stay latched until the patrol route is reacquired');

const distanceToRecoveryWaypoint = () => Math.hypot(
  npc.object3D.position.x - recoveryWaypoint.x,
  npc.object3D.position.z - recoveryWaypoint.z,
);
const returnStartDistance = distanceToRecoveryWaypoint();
assert.ok(returnStartDistance > 0.35, 'return must start while displaced from the active patrol waypoint');
const returnStartTick = npc.object3D.userData.simulationTicks;
const maxReturnTicks = Math.ceil(returnStartDistance / (returnSpeedMps * tickSeconds)) + 2;

for (let i = 0; i < 80 && npc.object3D.userData.npcPerception?.intent !== 'patrol'; i += 1) tick({ x: 100, z: 100 });

const finalDistance = distanceToRecoveryWaypoint();
const returnTicks = npc.object3D.userData.simulationTicks - returnStartTick;
assert.equal(npc.object3D.userData.npcPerception.intent, 'patrol',
  'guard must only resume patrol after route reacquisition');
assert.equal(npc.object3D.userData.npcPerception.returningToRoute, false,
  'route-recovery latch must clear after arrival');
assert.equal(npc.object3D.userData.npcPerception.lastKnown, null,
  'stale last-known player target must clear after route recovery');
assert.ok(finalDistance <= 0.35, `guard must recover the active patrol waypoint, got ${finalDistance.toFixed(3)}m`);
assert.ok(returnTicks <= maxReturnTicks,
  `route recovery must stay within deterministic tick budget (${returnTicks}/${maxReturnTicks})`);
assert.ok(npc.object3D.userData.simulationTicks >= intents.length,
  'acceptance must run through shipped NPC simulation ticks');

// Reacquiring the route is not enough: the authored patrol must become live again. The first
// patrol tick advances the recovered waypoint index; the next must physically move toward the
// next canonical waypoint instead of leaving the guard stranded at its return point.
const recoveredPosition = { x: npc.object3D.position.x, z: npc.object3D.position.z };
tick({ x: 100, z: 100 });
tick({ x: 100, z: 100 });
const resumedPatrolDistance = Math.hypot(
  npc.object3D.position.x - recoveredPosition.x,
  npc.object3D.position.z - recoveredPosition.z,
);
assert.equal(npc.object3D.userData.npcPerception.intent, 'patrol',
  'guard must remain in patrol after route recovery');
assert.ok(resumedPatrolDistance > 0,
  'guard must physically resume movement toward the next canonical patrol waypoint after recovery');

// Hearing must use the same shipped recovery contract. A fast player moving behind the guard
// is outside its forward vision cone but inside the deterministic hearing radius, so the guard
// must investigate the heard last-known position and eventually recover its authored route.
const hearingWaypoints = [{ x: 0, z: 0 }, { x: 0, z: 6 }];
const hearingNpc = await createNPC({
  assetLoader,
  modelUrl: 'guard.fbx',
  idleAnimationUrl: 'idle.fbx',
  walkAnimationUrl: 'walk.fbx',
  worldX: 0,
  worldZ: 0,
  groundY: 0,
  rotationYRadians: 0,
  name: 'hearing-return-guard',
  groundCollider,
  playerCollider,
  patrolWaypoints: hearingWaypoints,
  speedMps,
  pauseSeconds: 0,
  combatStanceTriggerRadiusMeters: 10,
  perceptionEnabled: true,
  simulationLodEnabled: false,
});
const hearingIntents = [];
const hearingTick = (player, delta = tickSeconds) => {
  hearingNpc.update(delta, player);
  hearingIntents.push(hearingNpc.object3D.userData.npcPerception?.intent ?? 'none');
};

hearingTick({ x: 0, z: -9 });
hearingTick({ x: 0, z: -6 });
assert.equal(hearingNpc.object3D.userData.npcPerception.lineOfSight, true,
  'hearing sample may have clear LOS while remaining outside the guard vision cone');
assert.equal(hearingNpc.object3D.userData.npcPerception.heard, true,
  'fast movement behind the guard must trigger shipped hearing');
assert.equal(hearingNpc.object3D.userData.npcPerception.reason, 'hearing',
  'hearing acquisition must expose the hearing telemetry reason');
assert.equal(hearingIntents.at(-1), 'investigate',
  'hearing must enter last-known investigation without skipping directly to combat');

for (let i = 0; i < 120 && hearingIntents.at(-1) !== 'return'; i += 1) hearingTick({ x: 100, z: 100 });
assert.equal(hearingIntents.at(-1), 'return', 'expired hearing investigation must enter route return');
for (let i = 0; i < 120 && hearingNpc.object3D.userData.npcPerception?.intent !== 'patrol'; i += 1) hearingTick({ x: 100, z: 100 });
assert.equal(hearingNpc.object3D.userData.npcPerception.intent, 'patrol',
  'hearing-driven investigation must recover back to authored patrol');
assert.equal(hearingNpc.object3D.userData.npcPerception.returningToRoute, false,
  'hearing-driven route recovery must clear the route-return latch');
assert.equal(hearingNpc.object3D.userData.npcPerception.lastKnown, null,
  'hearing-driven route recovery must clear stale last-known coordinates');

const hearingSimulationTicks = hearingNpc.object3D.userData.simulationTicks;
hearingNpc.dispose();
npc.dispose();

console.log('NPC_GUARD_RETURN_TO_PATROL_PASS', JSON.stringify({
  intents: [...new Set(intents)],
  hearingIntents: [...new Set(hearingIntents)],
  recoveryWaypoint,
  returnStartDistance: Number(returnStartDistance.toFixed(3)),
  finalDistance: Number(finalDistance.toFixed(3)),
  returnTicks,
  maxReturnTicks,
  resumedPatrolDistance: Number(resumedPatrolDistance.toFixed(3)),
  tickSeconds,
  simulationTicks: npc.object3D.userData.simulationTicks,
  hearingSimulationTicks,
}));
