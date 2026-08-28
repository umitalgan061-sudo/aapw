#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4179;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripBenignConnectionResetTracebacks(log) {
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
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console:${message.text()}`);
  });

  try {
    await page.goto(`${BASE_URL}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const result = await page.evaluate(async () => {
      const { spawnConfiguredCreatures, CREATURE_BEHAVIOR_PROFILES } = await import('/src/3d/gameplay/creatureBrain.js');
      const { wrapCreatureWithThreatMemory } = await import('/src/3d/gameplay/livingWorldSpawner.js');
      const { wrapCreatureWithSimulationLod } = await import('/src/3d/gameplay/creatureSpawner.js');
      const { mulberry32 } = await import('/src/3d/world/terrain.js');
      const groundCollider = { getGroundHeight: () => 0 };
      const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };
      const spawns = [
        { id: 'flock-raven-leader', speciesId: 'kuzgun', x: 0, z: 0, rotationYRadians: 0 },
        { id: 'flock-raven-wingman', speciesId: 'kuzgun', x: 8, z: 0, rotationYRadians: 0 },
        { id: 'flock-raven-relay', speciesId: 'kuzgun', x: 16, z: 0, rotationYRadians: 0 },
        { id: 'flock-eagle-neighbor', speciesId: 'kartal', x: 8, z: 2, rotationYRadians: 0 },
      ];
      const raw = spawnConfiguredCreatures({ spawns, groundCollider, playerCollider, mulberry32 });
      const herdRegistry = new Map();
      const ecologyRegistry = new Map();
      const flock = raw.map((creature, index) => {
        const spawn = spawns[index];
        const profile = CREATURE_BEHAVIOR_PROFILES[spawn.speciesId];
        const threatAware = wrapCreatureWithThreatMemory(creature, {
          triggerRadiusMeters: profile.reactiveTriggerRadiusMeters,
          reactiveDirection: profile.reactiveDirection,
          memorySeconds: 1.25,
          speciesId: spawn.speciesId,
          packAlertRadiusMeters: profile.packAlertRadiusMeters,
          herdRegistry,
          sourceId: spawn.id,
          ecologyRegistry,
        });
        return wrapCreatureWithSimulationLod(threatAware, {
          id: spawn.id,
          nearRadiusMeters: 70,
          farIntervalSeconds: 0.25,
          distantRadiusMeters: 180,
          distantIntervalSeconds: 1,
          maxStepSeconds: 0.25,
        });
      });
      const [leader, wingman, relay, eagle] = flock;
      const dt = 1 / 60;
      const playerNearLeader = { x: 0, z: 4 };
      for (let i = 0; i < 8; i += 1) leader.update(dt, playerNearLeader, []);
      const leaderTakeoff = leader.isFleeing && leader.object3D.position.y > 0.05;

      const wingmanBefore = { x: wingman.object3D.position.x, y: wingman.object3D.position.y };
      const urgentBeforeTick = wingman.isFleeing;
      wingman.update(dt, { x: 200, z: 200 }, []);
      const wingmanThreat = { ...wingman.object3D.userData.creatureThreat };
      const wingmanFlockTakeoff = urgentBeforeTick
        && wingmanThreat.phase === 'herd-flee'
        && wingmanThreat.herd === true
        && wingman.object3D.position.y > wingmanBefore.y;
      const wingmanMovesAwayFromLeader = wingman.object3D.position.x > wingmanBefore.x;
      const urgentLod = wingman.object3D.userData.simulationLodTier === 'urgent';

      relay.update(dt, { x: 200, z: 200 }, []);
      eagle.update(dt, { x: 200, z: 200 }, []);
      const noRelayStorm = !relay.isFleeing && relay.object3D.userData.creatureThreat.phase === 'roam';
      const crossSpeciesIsolated = !eagle.isFleeing && eagle.object3D.userData.creatureThreat.phase === 'roam';

      // Move the player well away and run the real flight controller through its entire recovery.
      // Both ravens must finish their bounded climb/cruise/land sequence, release urgent LOD, and
      // return to ordinary calm simulation without waking the relay bird after landing.
      const playerFar = { x: 220, z: 220 };
      let leaderPeakAltitude = leader.object3D.position.y;
      let wingmanPeakAltitude = wingman.object3D.position.y;
      let landingFrame = null;
      let urgentFrames = 0;
      for (let frame = 0; frame < 900; frame += 1) {
        leader.update(dt, playerFar, []);
        wingman.update(dt, playerFar, []);
        relay.update(dt, playerFar, []);
        eagle.update(dt, playerFar, []);
        leaderPeakAltitude = Math.max(leaderPeakAltitude, leader.object3D.position.y);
        wingmanPeakAltitude = Math.max(wingmanPeakAltitude, wingman.object3D.position.y);
        if (leader.object3D.userData.simulationLodTier === 'urgent' || wingman.object3D.userData.simulationLodTier === 'urgent') urgentFrames += 1;
        const bothGrounded = leader.object3D.position.y <= 0.02 && wingman.object3D.position.y <= 0.02;
        const bothCalm = !leader.isFleeing && !wingman.isFleeing;
        if (frame > 120 && bothGrounded && bothCalm) {
          landingFrame = frame;
          break;
        }
      }

      // LOD consumes pre-update fleeing state; release is observable on the next real scheduler tick.
      if (landingFrame != null) { leader.update(dt, playerFar, []); wingman.update(dt, playerFar, []); }
      const landedAfterBoundedFlight = landingFrame != null && landingFrame < 900;
      const altitudeCeilingRespected = leaderPeakAltitude <= CREATURE_BEHAVIOR_PROFILES.kuzgun.flightAltitudeMeters + 0.05
        && wingmanPeakAltitude <= CREATURE_BEHAVIOR_PROFILES.kuzgun.flightAltitudeMeters + 0.05
        && leaderPeakAltitude >= CREATURE_BEHAVIOR_PROFILES.kuzgun.flightAltitudeMeters - 0.2
        && wingmanPeakAltitude >= CREATURE_BEHAVIOR_PROFILES.kuzgun.flightAltitudeMeters - 0.2;
      const urgentReleasedAfterLanding = landedAfterBoundedFlight
        && leader.object3D.userData.simulationLodTier !== 'urgent'
        && wingman.object3D.userData.simulationLodTier !== 'urgent';
      const calmThreatTelemetry = leader.object3D.userData.creatureThreat.phase === 'roam'
        && wingman.object3D.userData.creatureThreat.phase === 'roam'
        && leader.object3D.userData.creatureThreat.direct === false
        && wingman.object3D.userData.creatureThreat.herd === false;
      const noPostLandingRelay = !relay.isFleeing
        && relay.object3D.userData.creatureThreat.phase === 'roam'
        && eagle.object3D.userData.creatureThreat.phase === 'roam';
      const boundedUrgentWindow = urgentFrames > 30 && urgentFrames < 900 * 2;

      for (const creature of flock) creature.dispose();
      const registryClean = herdRegistry.size === 0 && ecologyRegistry.size === 0;
      return {
        leaderTakeoff,
        wingmanFlockTakeoff,
        wingmanMovesAwayFromLeader,
        urgentLod,
        noRelayStorm,
        crossSpeciesIsolated,
        landedAfterBoundedFlight,
        altitudeCeilingRespected,
        urgentReleasedAfterLanding,
        calmThreatTelemetry,
        noPostLandingRelay,
        boundedUrgentWindow,
        registryClean,
        landingFrame,
        leaderPeakAltitude: Number(leaderPeakAltitude.toFixed(3)),
        wingmanPeakAltitude: Number(wingmanPeakAltitude.toFixed(3)),
      };
    });

    if (pageErrors.length) throw new Error(`browser errors: ${pageErrors.join(' | ')}`);
    const nonBooleanDiagnostics = new Set(['landingFrame', 'leaderPeakAltitude', 'wingmanPeakAltitude']);
    const failed = Object.entries(result).filter(([key, value]) => !nonBooleanDiagnostics.has(key) && value !== true);
    if (failed.length) throw new Error(`flock proof failed: ${JSON.stringify(result)}`);
    console.log('CREATURE_BIRD_FLOCK_BROWSER_PASS', JSON.stringify(result));
  } finally {
    await page.close();
    await browser.close();
    server.kill('SIGTERM');
  }

  const fatalServerLog = stripBenignConnectionResetTracebacks(serverErrors.join(''));
  if (/Traceback|(?:^|\n)\w*Error:|" [45]\d\d /im.test(fatalServerLog)) {
    throw new Error(`static server errors: ${fatalServerLog}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
