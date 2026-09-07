#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NPC_CONFIG } from '../src/3d/gameplay/npcConfig.js';

const spawns = NPC_CONFIG.SPAWNS;
assert.ok(Array.isArray(spawns) && spawns.length > 0, 'NPC_CONFIG.SPAWNS must contain shipped NPCs');
assert.ok(spawns.length <= 24, 'full-rate authored NPC spawn count must remain bounded for mobile/PWA');

const ids = new Set();
const modelUrls = new Set();
let patrolling = 0;
let maxPatrolMeters = 0;
let minKeepClearanceMeters = Infinity;

for (const spawn of spawns) {
  assert.equal(typeof spawn.id, 'string');
  assert.ok(spawn.id.length > 0, 'spawn id must be non-empty');
  assert.equal(ids.has(spawn.id), false, `duplicate NPC id: ${spawn.id}`);
  ids.add(spawn.id);

  assert.match(spawn.modelUrl, /^assets\/models\/characters\/.+\.fbx$/i,
    `${spawn.id} must use a real character FBX asset, not a primitive/fallback path`);
  modelUrls.add(spawn.modelUrl);

  assert.equal(typeof spawn.seatId, 'string', `${spawn.id} must anchor to a canonical seat`);
  assert.ok(spawn.seatId.length > 0, `${spawn.id} seatId must be non-empty`);
  assert.ok(Number.isFinite(spawn.offsetXMeters) && Number.isFinite(spawn.offsetZMeters),
    `${spawn.id} placement offsets must be finite`);

  const clearance = Math.hypot(spawn.offsetXMeters, spawn.offsetZMeters);
  minKeepClearanceMeters = Math.min(minKeepClearanceMeters, clearance);
  assert.ok(clearance >= 12 && clearance <= 40,
    `${spawn.id} must stay outside the keep footprint without drifting away from its settlement`);

  if (spawn.patrol) {
    patrolling += 1;
    assert.ok(Number.isFinite(spawn.patrol.toOffsetXMeters) && Number.isFinite(spawn.patrol.toOffsetZMeters),
      `${spawn.id} patrol offsets must be finite`);
    const patrolMeters = Math.hypot(
      spawn.patrol.toOffsetXMeters - spawn.offsetXMeters,
      spawn.patrol.toOffsetZMeters - spawn.offsetZMeters,
    );
    maxPatrolMeters = Math.max(maxPatrolMeters, patrolMeters);
    assert.ok(patrolMeters > 0 && patrolMeters <= 32,
      `${spawn.id} patrol must remain a bounded settlement-scale route`);
  }
}

assert.ok(modelUrls.size >= 4, 'NPC roster should retain multiple real character assets');
assert.ok(modelUrls.size <= 8, 'NPC roster must reuse a bounded model family rather than clone unique heavy assets');
assert.ok(patrolling > 0, 'at least one shipped NPC must exercise patrol runtime');

for (const animationUrl of [NPC_CONFIG.IDLE_ANIMATION_URL, NPC_CONFIG.WALK_ANIMATION_URL]) {
  assert.match(animationUrl, /^assets\/animations\/.+\.fbx$/i,
    `NPC animation must resolve to a shipped FBX clip: ${animationUrl}`);
}

const serviceWorker = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
for (const assetUrl of [...modelUrls, NPC_CONFIG.IDLE_ANIMATION_URL, NPC_CONFIG.WALK_ANIMATION_URL]) {
  assert.ok(serviceWorker.includes(assetUrl), `offline shell must include shipped NPC asset: ${assetUrl}`);
}

const npcSource = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');
assert.ok(npcSource.includes('resolveConfiguredNpcSpawnPlacement'),
  'configured NPCs must route spawn geography through the canonical placement pipeline');
assert.ok(npcSource.includes('const sampleGroundHeight = groundCollider?.getGroundHeight'),
  'configured NPC placement must prefer the canonical ground collider height sampler');
assert.ok(npcSource.includes('sampleGroundY;'),
  'configured NPC placement must retain the canonical terrain sampler fallback');
assert.ok(npcSource.includes('groundCollider.getGroundHeight'), 'patrol movement must remain aligned to ground collider height');
assert.ok(npcSource.includes('playerCollider'), 'NPC movement must retain shared collision/navigation adapter');
assert.ok(npcSource.includes('simulationLodEnabled = false'),
  'direct createNPC consumers must remain full-rate unless population LOD is explicitly requested');
assert.ok(npcSource.includes('simulationLodEnabled: true'),
  'shipped configured population must explicitly opt into simulation LOD');
assert.ok(npcSource.includes('simulationLodBootstrapDormant = false'),
  'direct createNPC consumers must preserve full-rate bootstrap compatibility');
assert.ok(npcSource.includes('simulationLodBootstrapDormant: true'),
  'shipped configured population must explicitly opt into bootstrap dormancy');
assert.ok(npcSource.includes("simulationLodEnabled ? simulationLod.tier : 'near'"),
  'compatibility-mode direct NPCs must report the near/full-rate tier rather than a dormant population tier');
assert.ok(npcSource.includes('hasPlayerPosition && combatStanceEnabled'),
  'missing player position must never fabricate an urgent combat stance');
assert.equal(npcSource.includes('EditorMaterialStudio'), false,
  'runtime NPC code must never import editor/DOM material UI');

for (const requiredCore of [
  'src/3d/materials/MaterialAssignmentCore.js',
  'src/3d/world/WorldAssetPlacementPipeline.js',
]) {
  assert.ok(fs.existsSync(new URL(`../${requiredCore}`, import.meta.url)),
    `shared material/placement core missing: ${requiredCore}`);
}

console.log('NPC_ASSET_SPAWN_CONTRACT_PASS', JSON.stringify({
  spawnCount: spawns.length,
  uniqueModelCount: modelUrls.size,
  patrolling,
  maxPatrolMeters: Number(maxPatrolMeters.toFixed(2)),
  minKeepClearanceMeters: Number(minKeepClearanceMeters.toFixed(2)),
  offlineAssetCount: modelUrls.size + 2,
}));
