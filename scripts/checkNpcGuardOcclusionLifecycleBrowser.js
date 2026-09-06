#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4190;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripBenignServerNoise(log) {
  return String(log)
    .replace(/^Traceback \(most recent call last\):\s*$/gm, '')
    .replace(/^BrokenPipeError: \[Errno 32\] Broken pipe\s*$/gm, '')
    .replace(/^ConnectionResetError: \[Errno 104\] Connection reset by peer\s*$/gm, '');
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverErrors = [];
  server.stderr.on('data', (chunk) => serverErrors.push(String(chunk)));
  await sleep(700);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(`pageerror:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(`console:${message.text()}`); });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');
      class FakeAssetLoader {
        async loadFBXModel() { const group = new THREE.Group(); group.animations = []; return group; }
      }

      let wallClosed = true;
      const groundCollider = { getGroundHeight: () => 0 };
      const playerCollider = {
        resolveXZ(x, z) {
          if (wallClosed && Math.abs(x) < 0.75 && z > 2.5 && z < 5.5) return { x: x + 0.2, z };
          return { x, z };
        },
      };
      const channel = { nextRevision: 1, groups: new Map() };
      const npc = await createNPC({
        assetLoader: new FakeAssetLoader(),
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        worldX: 0, worldZ: 0, groundY: 0, rotationYRadians: 0,
        name: 'occlusion-guard', displayName: 'Occlusion Guard',
        groundCollider, playerCollider, speedMps: 2,
        combatStanceTriggerRadiusMeters: 10, combatStanceTransitionSeconds: 0.05,
        perceptionEnabled: true, guardAlertChannel: channel, guardAlertGroupId: 'stannis',
        simulationLodEnabled: true, simulationLodNearRadiusMeters: 30,
        simulationLodFarIntervalSeconds: 0.25, simulationLodDistantRadiusMeters: 90,
        simulationLodDistantIntervalSeconds: 1, simulationLodMaxStepSeconds: 0.25,
      });

      const dt = 1 / 60;
      const player = { x: 0, z: 8 };
      const tick = (frames) => { for (let i = 0; i < frames; i += 1) npc.update(dt, player); };

      tick(60);
      const blocked = { ...(npc.object3D.userData.npcPerception ?? {}) };
      const blockedNeverAcquired = blocked.lineOfSight === false
        && blocked.reason === 'occluded'
        && blocked.intent === 'patrol'
        && blocked.suspicion === 0
        && channel.groups.size === 0;

      wallClosed = false;
      npc.object3D.rotation.y = 0;
      npc.update(dt, player);
      const opened = { ...(npc.object3D.userData.npcPerception ?? {}) };
      let acquiredFrames = null;
      for (let i = 0; i < 180; i += 1) {
        npc.update(dt, player);
        const perception = npc.object3D.userData.npcPerception;
        if ((perception?.intent === 'chase' || perception?.intent === 'combat')
          && channel.groups.get('stannis')?.sourceId === 'occlusion-guard') {
          acquiredFrames = i + 1;
          break;
        }
      }
      const acquired = acquiredFrames != null;
      const alertBeforeReocclusion = channel.groups.get('stannis');

      wallClosed = true;
      npc.update(dt, player);
      const lost = { ...(npc.object3D.userData.npcPerception ?? {}) };
      const alertReleasedOnOcclusion = !channel.groups.has('stannis');
      const fellBackToInvestigation = lost.lineOfSight === false
        && lost.reason === 'occluded'
        && lost.intent === 'investigate'
        && lost.lastKnown?.z === 8;
      const combatBlendFinite = Number.isFinite(npc.object3D.userData.combatStanceBlend)
        && npc.object3D.userData.combatStanceBlend >= 0
        && npc.object3D.userData.combatStanceBlend <= 1;

      npc.dispose();
      return {
        blockedNeverAcquired,
        openedObserved: opened.lineOfSight === true && opened.intent === 'observe',
        acquired,
        acquiredBounded: acquiredFrames != null && acquiredFrames <= 180,
        alertWasOwned: alertBeforeReocclusion?.sourceId === 'occlusion-guard',
        alertReleasedOnOcclusion,
        fellBackToInvestigation,
        combatBlendFinite,
        registryCleanAfterDispose: channel.groups.size === 0,
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const failed = Object.entries(result).filter(([, value]) => value !== true);
    if (failed.length) throw new Error(`guard occlusion lifecycle proof failed: ${JSON.stringify(result)}`);
    console.log('NPC_GUARD_OCCLUSION_LIFECYCLE_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close(); await browser.close(); server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
  if (/\" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) throw new Error(`static server errors: ${fatalServerLog}`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
