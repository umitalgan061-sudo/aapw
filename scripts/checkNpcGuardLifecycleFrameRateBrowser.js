#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4189;
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
    await page.goto(`${BASE_URL}/service-worker.js`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.addScriptTag({
      type: 'importmap',
      content: JSON.stringify({ imports: {
        three: '/src/3d/vendor/three/three.module.js',
        'three/addons/': '/src/3d/vendor/three/addons/',
      } }),
    });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNPC } = await import('/src/3d/gameplay/npc.js');
      class FakeAssetLoader {
        async loadFBXModel() { const group = new THREE.Group(); group.animations = []; return group; }
      }
      const loader = new FakeAssetLoader();
      const groundCollider = { getGroundHeight: () => 0 };
      const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };

      async function runScenario(fps) {
        const dt = 1 / fps;
        const channel = { nextRevision: 1, groups: new Map() };
        const npc = await createNPC({
          assetLoader: loader,
          modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
          idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
          walkAnimationUrl: '/assets/animations/peasant_girl/walking.fbx',
          worldX: 0, worldZ: 0, groundY: 0, rotationYRadians: 0,
          name: `framerate-guard-${fps}`, displayName: `Frame Guard ${fps}`,
          groundCollider, playerCollider,
          patrolWaypoints: [{ x: 0, z: 0 }, { x: 0, z: 5 }],
          speedMps: 2, pauseSeconds: 0.1, turnRateRadiansPerSecond: 8,
          combatStanceTriggerRadiusMeters: 10, combatStanceTransitionSeconds: 0.05,
          perceptionEnabled: true, guardAlertChannel: channel, guardAlertGroupId: 'stannis',
          simulationLodEnabled: true, simulationLodNearRadiusMeters: 100,
          simulationLodFarIntervalSeconds: 0.25, simulationLodDistantRadiusMeters: 200,
          simulationLodDistantIntervalSeconds: 1, simulationLodMaxStepSeconds: 0.25,
        });

        let elapsed = 0;
        const intents = [];
        const firstAt = {};
        const sampleIntent = () => {
          const intent = npc.object3D.userData.npcPerception?.intent ?? null;
          if (intent && !intents.includes(intent)) intents.push(intent);
          if (intent && firstAt[intent] == null) firstAt[intent] = elapsed;
          return intent;
        };
        const tick = (player) => { npc.update(dt, player); elapsed += dt; return sampleIntent(); };
        const tickFor = (seconds, player) => {
          const frames = Math.ceil(seconds * fps);
          for (let i = 0; i < frames; i += 1) tick(player);
        };
        const tickUntil = (predicate, maxSeconds, player) => {
          const frames = Math.ceil(maxSeconds * fps);
          for (let i = 0; i < frames; i += 1) {
            const intent = tick(player);
            if (predicate(intent)) return true;
          }
          return false;
        };

        const quiet = { x: 50, z: 50 };
        tickFor(1, quiet);
        const patrolMoved = Math.hypot(npc.object3D.position.x, npc.object3D.position.z) > 0.05;

        npc.object3D.rotation.y = 0;
        const visible = { x: npc.object3D.position.x, z: npc.object3D.position.z + 8 };
        const observed = tickUntil((intent) => intent === 'observe', 0.5, visible);
        const chased = tickUntil((intent) => intent === 'chase', 1, visible);
        const chaseStartDistance = Math.hypot(npc.object3D.position.x - visible.x, npc.object3D.position.z - visible.z);
        const combated = tickUntil((intent) => intent === 'combat', 5, visible);
        const combatDistance = Math.hypot(npc.object3D.position.x - visible.x, npc.object3D.position.z - visible.z);

        const lost = { x: 60, z: -60 };
        const investigated = tickUntil((intent) => intent === 'investigate', 1, lost);
        const investigateStart = { x: npc.object3D.position.x, z: npc.object3D.position.z };
        tickFor(1, lost);
        const investigateMoved = Math.hypot(
          npc.object3D.position.x - investigateStart.x,
          npc.object3D.position.z - investigateStart.z,
        ) > 0.05;
        const returned = tickUntil((intent) => intent === 'patrol', 12, lost);
        const alertReleased = channel.groups.size === 0;
        const finitePosition = Number.isFinite(npc.object3D.position.x)
          && Number.isFinite(npc.object3D.position.y)
          && Number.isFinite(npc.object3D.position.z);
        const maxStepBounded = npc.object3D.userData.simulationTicks > 0;
        const combatBlendFinite = Number.isFinite(npc.object3D.userData.combatStanceBlend)
          && npc.object3D.userData.combatStanceBlend >= 0
          && npc.object3D.userData.combatStanceBlend <= 1;
        npc.dispose();

        return {
          fps, observed, chased, combated, investigated, returned,
          patrolMoved, investigateMoved, alertReleased, finitePosition, maxStepBounded, combatBlendFinite,
          chaseClosedDistance: combatDistance < chaseStartDistance,
          intents, firstAt,
        };
      }

      const runs = [];
      for (const fps of [30, 60, 120]) runs.push(await runScenario(fps));
      const requiredOrder = ['patrol', 'observe', 'chase', 'combat', 'investigate'];
      const orderStable = runs.every((run) => {
        let cursor = -1;
        for (const intent of requiredOrder) {
          const next = run.intents.indexOf(intent);
          if (next <= cursor) return false;
          cursor = next;
        }
        return true;
      });
      const milestones = ['observe', 'chase', 'combat', 'investigate'];
      const maxTimingSpreadSeconds = Math.max(...milestones.map((milestone) => {
        const values = runs.map((run) => run.firstAt[milestone]);
        return Math.max(...values) - Math.min(...values);
      }));
      return {
        runs,
        orderStable,
        timingBounded: maxTimingSpreadSeconds <= 0.35,
        maxTimingSpreadSeconds: Number(maxTimingSpreadSeconds.toFixed(4)),
        allLifecycleChecks: runs.every((run) => run.observed && run.chased && run.combated && run.investigated
          && run.returned && run.patrolMoved && run.investigateMoved && run.alertReleased && run.finitePosition
          && run.maxStepBounded && run.combatBlendFinite && run.chaseClosedDistance),
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    if (!result.orderStable || !result.timingBounded || !result.allLifecycleChecks) {
      throw new Error(`guard frame-rate lifecycle proof failed: ${JSON.stringify(result)}`);
    }
    console.log('NPC_GUARD_LIFECYCLE_FRAMERATE_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close(); await browser.close(); server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
  if (/\" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) throw new Error(`static server errors: ${fatalServerLog}`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
