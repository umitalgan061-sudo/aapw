import devServerHelper from '../devServerHelper.js';

export async function loadG77NearDetailLiveContext() {
  const playwright = devServerHelper.loadPlaywright();
  if (!playwright) throw new Error('Playwright is required for G77 Near Detail live context');
  const server = await devServerHelper.startStaticServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page:${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const runtimeNetwork = await page.evaluate(async () => {
      const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
      const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
      const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const pads = computeSettlementFlattenPads({ sampleHeightMeters: raw, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS, mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
      const height = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads);
      const seats = KINGDOM_SEATS.map((seat) => { const p = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT); return { id: seat.id, x: p.x, z: p.z, groundY: height(p.x, p.z) }; });
      const network = buildRoadNetwork({ seats, sampleHeightMeters: height });
      const pack = (edge) => ({ fromId: edge.fromId, toId: edge.toId, points: edge.points.map((p) => ({ x: p.x, z: p.z })), lengthMeters: edge.lengthMeters, maxGradeDegrees: edge.maxGradeDegrees });
      return { mapBounds: { ...WORLD_SCALE.MAP_BOUNDS }, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT, waterLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        settlementPads: pads.map((p) => ({ x: p.x, z: p.z, innerRadiusMeters: p.innerRadiusMeters, outerRadiusMeters: p.outerRadiusMeters, anchorHeightMeters: p.anchorHeightMeters })),
        mainEdges: network.edges.map(pack), footpathEdges: network.footpathEdges.map(pack), seats };
    });
    if (errors.length) throw new Error(`live page errors: ${errors.join(' | ')}`);
    if (runtimeNetwork.mainEdges.length < 13 || runtimeNetwork.footpathEdges.length < 1) throw new Error(`incomplete live road network: ${runtimeNetwork.mainEdges.length}/${runtimeNetwork.footpathEdges.length}`);
    return Object.freeze({ runtimeNetwork, browserErrors: Object.freeze([...errors]) });
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
