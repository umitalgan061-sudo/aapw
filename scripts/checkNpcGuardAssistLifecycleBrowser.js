#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4182;
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
      const { evaluateNpcGuardAssistAlert, releaseNpcGuardAlertOwnership } = await import('/src/3d/gameplay/npc.js');
      const channel = { groups: new Map() };
      const sourceId = 'stannis-guard-1';
      const receiverId = 'stannis-guard-2';
      const groupId = 'stannis';
      const alert = Object.freeze({
        revision: 11,
        groupId,
        sourceId,
        sourcePosition: Object.freeze({ x: 0, z: 0 }),
        lastKnown: Object.freeze({ x: 3, z: 4 }),
      });
      channel.groups.set(groupId, alert);

      let receiverRevision = 0;
      const outside = evaluateNpcGuardAssistAlert({
        alert: channel.groups.get(groupId),
        observer: { x: 30, z: 0 },
        groupId,
        sourceId: receiverId,
        lastRevision: receiverRevision,
        assistRadiusMeters: 25,
      });
      if (outside.accepted || outside.reason !== 'range') throw new Error(`outside receiver contract failed: ${JSON.stringify(outside)}`);

      const afterPatrolReentry = evaluateNpcGuardAssistAlert({
        alert: channel.groups.get(groupId),
        observer: { x: 24, z: 0 },
        groupId,
        sourceId: receiverId,
        lastRevision: receiverRevision,
        assistRadiusMeters: 25,
      });
      if (!afterPatrolReentry.accepted) throw new Error(`reentry assist failed: ${JSON.stringify(afterPatrolReentry)}`);
      receiverRevision = afterPatrolReentry.revision;

      const singleConsume = evaluateNpcGuardAssistAlert({
        alert: channel.groups.get(groupId),
        observer: { x: 20, z: 0 },
        groupId,
        sourceId: receiverId,
        lastRevision: receiverRevision,
        assistRadiusMeters: 25,
      });
      if (singleConsume.reason !== 'stale') throw new Error(`single-consume failed: ${JSON.stringify(singleConsume)}`);

      const nonOwnerRelease = releaseNpcGuardAlertOwnership({ alertChannel: channel, groupId, sourceId: receiverId });
      if (nonOwnerRelease || channel.groups.get(groupId) !== alert) throw new Error('non-owner release deleted the publisher alert');
      const ownerRelease = releaseNpcGuardAlertOwnership({ alertChannel: channel, groupId, sourceId });
      if (!ownerRelease || channel.groups.size !== 0) throw new Error('publisher dispose/loss failed to clear owned alert');

      const afterPublisherLoss = evaluateNpcGuardAssistAlert({
        alert: channel.groups.get(groupId),
        observer: { x: 20, z: 0 },
        groupId,
        sourceId: 'stannis-guard-3',
        lastRevision: 0,
        assistRadiusMeters: 25,
      });
      if (afterPublisherLoss.accepted) throw new Error('cleared publisher alert remained actionable');

      const replacement = Object.freeze({ ...alert, revision: 12, sourceId: 'stannis-guard-3' });
      channel.groups.set(groupId, replacement);
      const staleOwnerRelease = releaseNpcGuardAlertOwnership({ alertChannel: channel, groupId, sourceId });
      if (staleOwnerRelease || channel.groups.get(groupId) !== replacement) {
        throw new Error('stale publisher teardown erased a replacement alert');
      }

      return {
        moduleLoadedFromShippedGame: true,
        outsideReason: outside.reason,
        reentryAccepted: afterPatrolReentry.accepted,
        reentryLastKnown: afterPatrolReentry.lastKnown,
        singleConsumeReason: singleConsume.reason,
        nonOwnerReleaseBlocked: !nonOwnerRelease,
        publisherAlertCleared: ownerRelease,
        stalePublisherReplacementPreserved: !staleOwnerRelease,
        staleFutureAssistBlocked: !afterPublisherLoss.accepted,
      };
    });

    if (browserErrors.length) throw new Error(`browser errors: ${browserErrors.join(' | ')}`);
    console.log('NPC_GUARD_ASSIST_LIFECYCLE_BROWSER_PASS', JSON.stringify(result));
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
