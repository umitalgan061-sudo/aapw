#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4197;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(700);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console:${message.text()}`); });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');
      class FakeAssetLoader {
        async loadFBXModel() { const group = new THREE.Group(); group.animations = []; return group; }
      }
      const channel = { nextRevision: 1, groups: new Map() };
      const occluder = { resolveXZ: (x, z) => (z < -2.5 && z > -3.5 ? { x: x + 0.5, z } : { x, z }) };
      const npc = await createNPC({
        assetLoader: new FakeAssetLoader(),
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        worldX: 0, worldZ: 0, groundY: 0, rotationYRadians: 0,
        name: 'input-safe-guard', groundCollider: { getGroundHeight: () => 0 }, playerCollider: occluder,
        speedMps: 0, combatStanceTriggerRadiusMeters: 10, perceptionEnabled: true,
        guardAlertChannel: channel, guardAlertGroupId: 'winterfell', simulationLodMaxStepSeconds: 0.25,
      });
      const dt = 1 / 60;
      npc.update(dt, { x: 0, z: -6 });
      const beforeInvalid = npc.object3D.userData.npcPerception ? { ...npc.object3D.userData.npcPerception } : null;
      npc.update(dt, { x: Number.NaN, z: -6 });
      npc.update(dt, { x: Number.POSITIVE_INFINITY, z: -6 });
      const afterInvalid = npc.object3D.userData.npcPerception ? { ...npc.object3D.userData.npcPerception } : null;
      const invalidInputIgnored = JSON.stringify(afterInvalid) === JSON.stringify(beforeInvalid)
        && channel.groups.size === 0 && channel.nextRevision === 1;

      npc.update(dt, { x: 0, z: -6 });
      npc.update(dt, { x: 0.22, z: -6 });
      const recovered = { ...(npc.object3D.userData.npcPerception ?? {}) };
      const validRecoveryHeard = recovered.heard === true && recovered.intent === 'investigate'
        && recovered.reason === 'hearing' && recovered.lastKnown?.x === 0.22;
      const transformFinite = Number.isFinite(npc.object3D.position.x)
        && Number.isFinite(npc.object3D.position.y) && Number.isFinite(npc.object3D.position.z);
      npc.dispose();
      return { invalidInputIgnored, validRecoveryHeard, transformFinite, alertChannelClean: channel.groups.size === 0 };
    });
    if (browserErrors.length) throw new Error(`browser errors: ${browserErrors.join(' | ')}`);
    const failed = Object.entries(result).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`NPC perception input safety failed: ${JSON.stringify(result)}`);
    console.log('NPC_PERCEPTION_INPUT_SAFETY_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close(); await browser.close(); server.kill('SIGTERM');
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
