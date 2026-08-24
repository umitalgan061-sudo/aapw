#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PORT = 4193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripBenignServerNoise(log) {
  return String(log)
    .replace(/^Traceback \(most recent call last\):\s*$/gm, '')
    .replace(/^BrokenPipeError: \[Errno 32\] Broken pipe\s*$/gm, '')
    .replace(/^ConnectionResetError: \[Errno 104\] Connection reset by peer\s*$/gm, '');
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverErrors = [];
server.stderr.on('data', (chunk) => serverErrors.push(String(chunk)));
await sleep(700);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(`pageerror:${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(`console:${message.text()}`);
});

try {
  await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createNPC } = await import('/src/3d/gameplay/npc.js');

    const loader = {
      async loadFBXModel() {
        const group = new THREE.Group();
        group.animations = [];
        return group;
      },
    };

    async function runHearingTrace(stepSeconds, steps) {
      const guard = await createNPC({
        assetLoader: loader,
        modelUrl: '/assets/models/characters/paladin_j_nordstrom.fbx',
        idleAnimationUrl: '/assets/animations/peasant_girl/idle.fbx',
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        rotationYRadians: 0,
        name: `hearing-${steps}`,
        speedMps: 0,
        turnRateRadiansPerSecond: 0,
        combatStanceTriggerRadiusMeters: 20,
        perceptionEnabled: true,
        simulationLodEnabled: false,
        simulationLodMaxStepSeconds: 0.25,
      });

      guard.update(stepSeconds, { x: 0, z: -10 });
      for (let i = 0; i < steps; i += 1) {
        const elapsed = (i + 1) * stepSeconds;
        guard.update(stepSeconds, { x: 7 * elapsed, z: -10 });
      }

      const perception = { ...guard.object3D.userData.npcPerception };
      guard.dispose();
      return perception;
    }

    return {
      sixtyHz: await runHearingTrace(1 / 60, 60),
      fourHz: await runHearingTrace(0.25, 4),
    };
  });

  assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);
  assert.equal(result.sixtyHz.reason, 'hearing', '60 Hz target must be acquired by hearing');
  assert.equal(result.fourHz.reason, 'hearing', '4 Hz target must be acquired by hearing');
  assert.equal(result.sixtyHz.heard, true, '60 Hz target must remain audible');
  assert.equal(result.fourHz.heard, true, '4 Hz target must remain audible');
  assert.equal(result.sixtyHz.suspicion, 0.72, '60 Hz one-second hearing suspicion must equal 0.72');
  assert.equal(result.fourHz.suspicion, 0.72, '4 Hz one-second hearing suspicion must equal 0.72');
  assert.equal(result.sixtyHz.suspicion, result.fourHz.suspicion, 'equal simulated time must be frame-rate invariant');

  console.log('NPC_HEARING_FRAMERATE_DETERMINISM_PASS', JSON.stringify({
    sixtyHzSuspicion: result.sixtyHz.suspicion,
    fourHzSuspicion: result.fourHz.suspicion,
    simulatedSeconds: 1,
    browserErrors: pageErrors.length,
  }));
} finally {
  await page.close();
  await browser.close();
  server.kill('SIGTERM');
}

const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
if (/\" [45]\d\d |(?:^|\n)\w*(?:Error|Exception):|Traceback/im.test(fatalServerLog)) {
  throw new Error(`static server errors: ${fatalServerLog}`);
}
