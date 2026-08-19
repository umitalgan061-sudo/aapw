#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4186;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripBenignServerNoise(log) {
  return String(log).replace(
    /-{20,}\nException occurred during processing of request[\s\S]*?ConnectionResetError: \[Errno 104\] Connection reset by peer\n-{20,}\n?/g,
    '',
  );
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
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
  });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const result = await page.evaluate(async () => {
      const { evaluateNpcGuardAssistAlert, createNpcSimulationLod } = await import('/src/3d/gameplay/npc.js');
      const frame = 1 / 60;
      const playerDistance = 500;
      const receiver = { x: 20, z: 0 };
      const groupId = 'stannis';
      const receiverId = 'stannis-guard-2';
      const alert = Object.freeze({
        revision: 21,
        groupId,
        sourceId: 'stannis-guard-1',
        sourcePosition: Object.freeze({ x: 0, z: 0 }),
        lastKnown: Object.freeze({ x: 4, z: 2 }),
      });

      const lod = createNpcSimulationLod({ id: receiverId });
      for (let i = 0; i < 12; i += 1) lod.step(frame, playerDistance, false);
      if (lod.tier !== 'distant') throw new Error(`receiver did not enter distant tier: ${lod.tier}`);

      const assist = evaluateNpcGuardAssistAlert({
        alert,
        observer: receiver,
        groupId,
        sourceId: receiverId,
        lastRevision: 0,
        assistRadiusMeters: 25,
      });
      if (!assist.accepted) throw new Error(`fresh assist was rejected: ${JSON.stringify(assist)}`);
      const wakeStep = lod.step(frame, playerDistance, assist.accepted);
      if (wakeStep !== frame || lod.tier !== 'urgent') {
        throw new Error(`accepted assist did not wake distant LOD immediately: step=${wakeStep}, tier=${lod.tier}`);
      }

      const consumed = evaluateNpcGuardAssistAlert({
        alert,
        observer: receiver,
        groupId,
        sourceId: receiverId,
        lastRevision: assist.revision,
        assistRadiusMeters: 25,
      });
      if (consumed.accepted || consumed.reason !== 'stale') throw new Error(`consumed alert remained urgent: ${JSON.stringify(consumed)}`);
      lod.step(frame, playerDistance, consumed.accepted);
      if (lod.tier !== 'distant') throw new Error(`stale assist pinned receiver outside bounded LOD: ${lod.tier}`);

      const foreign = evaluateNpcGuardAssistAlert({
        alert,
        observer: receiver,
        groupId: 'cersei',
        sourceId: 'cersei-guard-2',
        lastRevision: 0,
        assistRadiusMeters: 25,
      });
      if (foreign.accepted) throw new Error('cross-settlement alert qualified as urgent');

      const outOfRange = evaluateNpcGuardAssistAlert({
        alert,
        observer: { x: 30, z: 0 },
        groupId,
        sourceId: receiverId,
        lastRevision: 0,
        assistRadiusMeters: 25,
      });
      if (outOfRange.accepted || outOfRange.reason !== 'range') throw new Error(`out-of-range alert woke receiver: ${JSON.stringify(outOfRange)}`);

      const nextAlert = Object.freeze({ ...alert, revision: 22, lastKnown: Object.freeze({ x: 5, z: 3 }) });
      const nextAssist = evaluateNpcGuardAssistAlert({
        alert: nextAlert,
        observer: receiver,
        groupId,
        sourceId: receiverId,
        lastRevision: assist.revision,
        assistRadiusMeters: 25,
      });
      const secondWake = lod.step(frame, playerDistance, nextAssist.accepted);
      if (!nextAssist.accepted || secondWake !== frame || lod.tier !== 'urgent') {
        throw new Error('newer valid revision failed to wake receiver again');
      }

      return {
        shippedModuleLoaded: true,
        initialTier: 'distant',
        firstWakeTier: 'urgent',
        wakeStepSeconds: wakeStep,
        staleReleasedToDistant: true,
        settlementIsolation: !foreign.accepted,
        radiusBounded: !outOfRange.accepted,
        newerRevisionRewakes: nextAssist.accepted,
      };
    });

    if (browserErrors.length) throw new Error(`browser errors: ${browserErrors.join(' | ')}`);
    console.log('NPC_GUARD_ASSIST_LOD_WAKE_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close();
    await browser.close();
    server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignServerNoise(serverErrors.join(''));
  if (/Traceback|(?:^|\n)\w*Error:|" [45]\d\d /im.test(fatalServerLog)) {
    throw new Error(`static server errors: ${fatalServerLog}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
