#!/usr/bin/env node
/** Run191 follow-up: prove the player ground-height contract can traverse every canonical stone-bridge deck. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const CORE_FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run191-stone-bridges.json');
const OUT_DIR = path.join(ROOT, 'artifacts', 'run191-bridge-traversal-readiness');
const OUT_FILE = path.join(OUT_DIR, 'proof.json');
const EXPECTED_CORE_CHECKSUM = '13fadc3dbc3d3554c583215883614a56b5e9ee406ae74d66e335fd56fe4cf7f4';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (_) { /* next */ }
  }
  return null;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const clean = decodeURIComponent(req.url.split('?')[0]);
      const relative = clean === '/' ? 'game3d.html' : clean.replace(/^\//, '');
      const file = path.join(ROOT, relative);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500); res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function collect(page) {
  return page.evaluate(async () => {
    const { WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
    const { PLAYER_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
    const { createHeightSampler } = await import('/src/3d/world/terrain.js');
    const { KINGDOM_SEATS, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
    const { mapCanvasToNormalizedReference } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } = await import('/src/3d/world/worldReferenceHydrology.js');
    const {
      FULL_REFERENCE_MAP_BOUNDS,
      FULL_REFERENCE_WORLD_MIGRATION_PLAN,
      plannedWorldXZToMapCanvas,
    } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const { createCanonicalHydrologyTerrainSampler } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
    const { STONE_BRIDGE_OWNER_POLICY, buildCanonicalStoneBridgePlan } = await import('/src/3d/world/worldReferenceStoneBridgeShadow.js');

    const plan = buildCanonicalStoneBridgePlan();
    const migration = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
    const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
    const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const pads = computeSettlementFlattenPads({
      sampleHeightMeters: natural,
      seaLevelMeters: sea,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: FULL_REFERENCE_MAP_BOUNDS,
      metersPerMapUnit: migration.metersPerMapUnit,
    });
    const base = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
    const protectionRadii = referenceProtectionRadiiFromMeters(pads[0].outerRadiusMeters, migration.metersPerMapUnit);
    const protectedSites = KINGDOM_SEATS.map((seat) => ({ id: seat.id, ...mapCanvasToNormalizedReference(seat.mapX, seat.mapY) }));
    const terrain = createCanonicalHydrologyTerrainSampler({ baseHeightSampler: base, seaLevelMeters: sea, protectedSites, protectionRadii });
    const hydrologyAtWorld = (x, z) => {
      const map = plannedWorldXZToMapCanvas(x, z);
      const normalized = mapCanvasToNormalizedReference(map.x, map.y);
      return sampleSeatSafeReferenceHydrology(normalized.x, normalized.y, protectedSites, protectionRadii);
    };

    const playerRadiusMeters = Number(PLAYER_CONFIG.COLLIDER_RADIUS_METERS || PLAYER_CONFIG.PLAYER_RADIUS_METERS || 0.4);
    const walkSpeedMps = Number(PLAYER_CONFIG.WALK_SPEED_MPS || 4);
    const safeHalfWidth = STONE_BRIDGE_OWNER_POLICY.bridgeWidthMeters * 0.5 - STONE_BRIDGE_OWNER_POLICY.parapetThicknessMeters - playerRadiusMeters;
    if (!(safeHalfWidth > 0)) throw new Error(`bridge safe corridor vanished: ${safeHalfWidth}`);

    const deckHeightAt = (x, z, insetMeters = 0) => {
      for (const bridge of plan.bridges) {
        const dx = x - bridge.centerX;
        const dz = z - bridge.centerZ;
        const c = Math.cos(bridge.yawRadians);
        const s = Math.sin(bridge.yawRadians);
        const localX = c * dx - s * dz;
        const localZ = s * dx + c * dz;
        const halfLength = bridge.structuralSpanMeters * 0.5 + 0.15;
        const halfWidth = bridge.bridgeWidthMeters * 0.5 - insetMeters + 0.02;
        if (Math.abs(localX) <= halfLength && Math.abs(localZ) <= halfWidth) {
          return bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
        }
      }
      return null;
    };
    const compositeGroundHeight = (x, z, insetMeters = 0) => {
      const deck = deckHeightAt(x, z, insetMeters);
      return deck === null ? terrain(x, z) : deck;
    };

    const lanes = [0, -safeHalfWidth, safeHalfWidth];
    const bridgeReports = [];
    let totalSteps = 0;
    let totalWaterSteps = 0;
    let minimumDeckClearanceMeters = Infinity;
    let maximumVerticalStepMeters = 0;

    for (const bridge of plan.bridges) {
      const vx = bridge.endX - bridge.startX;
      const vz = bridge.endZ - bridge.startZ;
      const length = Math.hypot(vx, vz);
      const ux = vx / length;
      const uz = vz / length;
      const px = -uz;
      const pz = ux;
      const deckTopY = bridge.deckY + STONE_BRIDGE_OWNER_POLICY.deckThicknessMeters * 0.5;
      const stepMeters = Math.max(0.5, walkSpeedMps * 0.25);
      const steps = Math.max(2, Math.ceil(length / stepMeters));
      let bridgeWaterSteps = 0;
      let bridgeMinimumClearance = Infinity;
      let bridgeMaxVerticalStep = 0;

      for (const lateral of lanes) {
        let previousY = null;
        for (let index = 0; index < steps; index += 1) {
          const t = (index + 0.5) / steps;
          const x = bridge.startX + vx * t + px * lateral;
          const z = bridge.startZ + vz * t + pz * lateral;
          const resolvedY = compositeGroundHeight(x, z, playerRadiusMeters);
          const deckY = deckHeightAt(x, z, playerRadiusMeters);
          if (deckY === null) throw new Error(`${bridge.id}: safe lane missed deck footprint at t=${t.toFixed(5)} lateral=${lateral.toFixed(3)}`);
          if (Math.abs(resolvedY - deckTopY) > 1e-6) throw new Error(`${bridge.id}: composite ground failed to snap to deck`);
          const terrainY = terrain(x, z);
          const clearance = resolvedY - terrainY;
          bridgeMinimumClearance = Math.min(bridgeMinimumClearance, clearance);
          minimumDeckClearanceMeters = Math.min(minimumDeckClearanceMeters, clearance);
          if (previousY !== null) {
            const verticalStep = Math.abs(resolvedY - previousY);
            bridgeMaxVerticalStep = Math.max(bridgeMaxVerticalStep, verticalStep);
            maximumVerticalStepMeters = Math.max(maximumVerticalStepMeters, verticalStep);
          }
          previousY = resolvedY;
          if (hydrologyAtWorld(x, z).water) {
            bridgeWaterSteps += 1;
            totalWaterSteps += 1;
            if (!(resolvedY > sea)) throw new Error(`${bridge.id}: water traversal resolved at/below sea level`);
          }
          totalSteps += 1;
        }
      }

      const midX = bridge.centerX;
      const midZ = bridge.centerZ;
      const outsideOffset = bridge.bridgeWidthMeters * 0.5 + playerRadiusMeters + 0.75;
      const outsideX = midX + px * outsideOffset;
      const outsideZ = midZ + pz * outsideOffset;
      const outsideDeck = deckHeightAt(outsideX, outsideZ, playerRadiusMeters);
      const outsideCompositeY = compositeGroundHeight(outsideX, outsideZ, playerRadiusMeters);
      const outsideTerrainY = terrain(outsideX, outsideZ);
      if (outsideDeck !== null) throw new Error(`${bridge.id}: bridge footprint leaks outside player-safe width`);
      if (Math.abs(outsideCompositeY - outsideTerrainY) > 1e-9) throw new Error(`${bridge.id}: composite resolver does not return terrain outside bridge`);
      if (bridgeWaterSteps <= 0) throw new Error(`${bridge.id}: traversal proof found no water samples under bridge`);
      if (!(bridgeMinimumClearance > 0.1)) throw new Error(`${bridge.id}: deck does not clear terrain; min=${bridgeMinimumClearance}`);

      bridgeReports.push({
        id: bridge.id,
        archCount: bridge.archCount,
        spanMeters: bridge.structuralSpanMeters,
        deckTopY: Math.round(deckTopY * 1000) / 1000,
        safeHalfWidthMeters: Math.round(safeHalfWidth * 1000) / 1000,
        laneCount: lanes.length,
        stepsPerLane: steps,
        waterSteps: bridgeWaterSteps,
        minimumDeckClearanceMeters: Math.round(bridgeMinimumClearance * 1000) / 1000,
        maxVerticalStepMeters: Math.round(bridgeMaxVerticalStep * 1000000) / 1000000,
      });
    }

    return {
      version: 'run191-bridge-traversal-readiness-v1',
      policy: plan.policy,
      affectedEdges: plan.affectedEdges.length,
      bridgeCount: plan.bridges.length,
      totalArches: plan.totalArchCount,
      playerContract: 'groundCollider.getGroundHeight(x,z)',
      playerRadiusMeters,
      walkSpeedMps,
      safeHalfWidthMeters: Math.round(safeHalfWidth * 1000) / 1000,
      laneCount: lanes.length,
      totalSteps,
      totalWaterSteps,
      minimumDeckClearanceMeters: Math.round(minimumDeckClearanceMeters * 1000) / 1000,
      maximumVerticalStepMeters: Math.round(maximumVerticalStepMeters * 1000000) / 1000000,
      bridgeReports,
    };
  });
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright unavailable');
  const core = JSON.parse(fs.readFileSync(CORE_FIXTURE, 'utf8'));
  assert(core.checksum === EXPECTED_CORE_CHECKSUM, `Run191 bridge checksum drifted: ${core.checksum}`);
  assert(core.policy === 'stone-arch-bridge', `owner policy drifted: ${core.policy}`);
  assert(core.bridges.length === 7 && core.totalArchCount === 177, 'Run191 bridge topology drifted');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const first = await collect(page);
    const second = await collect(page);
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    assert(JSON.stringify(first) === JSON.stringify(second), 'repeat traversal proof drifted');
    assert(first.policy === 'stone-arch-bridge', 'owner bridge policy mismatch');
    assert(first.affectedEdges === 6 && first.bridgeCount === 7 && first.totalArches === 177, 'bridge topology mismatch');
    assert(first.totalSteps > 10000, `traversal sample count too small: ${first.totalSteps}`);
    assert(first.totalWaterSteps > 1000, `water traversal sample count too small: ${first.totalWaterSteps}`);
    assert(first.minimumDeckClearanceMeters > 0.1, `minimum deck clearance too small: ${first.minimumDeckClearanceMeters}`);
    assert(first.maximumVerticalStepMeters === 0, `flat deck traversal has vertical discontinuity: ${first.maximumVerticalStepMeters}`);
    const checksum = hash(first);
    const proof = { coreChecksum: core.checksum, traversalChecksum: checksum, ...first };
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`[checkCanonicalStoneBridgeTraversalReadiness] PASS: ${first.bridgeCount} bridges / ${first.totalArches} arches; ${first.totalSteps} player-contract samples (${first.totalWaterSteps} over water); safeHalfWidth=${first.safeHalfWidthMeters}m; minClearance=${first.minimumDeckClearanceMeters}m; verticalStep=${first.maximumVerticalStepMeters}m; checksum=${checksum}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('[checkCanonicalStoneBridgeTraversalReadiness] FAIL:', error);
  process.exitCode = 1;
});
