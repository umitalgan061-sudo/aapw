#!/usr/bin/env node
/**
 * Exact-head browser acceptance for canonical kingdom-seat ambient prop dressing.
 *
 * This test deliberately uses the same canonical map->world seats, settlement flatten pads, terrain
 * sampler and routed roads as the shipped scene. It verifies deterministic placement, geographic
 * rejection policy, real-GLB hydration, authored-map preservation, world-space material breakup and
 * a real WebGL render against actual terrain chunks. The screenshot is intended for human review;
 * passing assertions alone are not treated as visual acceptance.
 */

const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('[checkSettlementAmbientProps] SKIP: Playwright is unavailable.');
    process.exit(2);
  }

  const artifactDir = process.env.SETTLEMENT_AMBIENT_PROP_ARTIFACT_DIR
    || path.join(process.cwd(), 'artifacts', 'settlement-ambient-props');
  fs.mkdirSync(artifactDir, { recursive: true });

  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const browserErrors = [];
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
    });
    page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
    await page.goto(`http://127.0.0.1:${port}/scripts/settlementAmbientPropsHarness.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
      const { ChunkManager } = await import('/src/3d/world/chunkManager.js');
      const { createHeightSampler } = await import('/src/3d/world/terrain.js');
      const {
        KINGDOM_SEATS,
        mapToWorldXZ,
        computeSettlementFlattenPads,
      } = await import('/src/3d/world/settlements.js');
      const { buildRoadNetwork, disposeRoadNetwork } = await import('/src/3d/world/roads.js');
      const {
        SETTLEMENT_AMBIENT_PROP_POLICY,
        SETTLEMENT_AMBIENT_PROP_FAMILIES,
        generateSettlementAmbientPropPlacements,
        createSettlementAmbientProps,
        upgradeSettlementAmbientPropAssets,
        auditSettlementAmbientProps,
        checksumSettlementAmbientPlacements,
        disposeSettlementAmbientProps,
      } = await import('/src/3d/world/settlementAmbientProps.js');

      const fail = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const nearlyEqual = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

      fail(SETTLEMENT_AMBIENT_PROP_POLICY.renderOnly === true, 'ambient props lost render-only policy');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.gameplayInactive === true, 'ambient props became gameplay-active');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.canonicalSettlementAnchorsUnchanged === true, 'canonical seat authority drift');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.canonicalTerrainUnchanged === true, 'canonical terrain authority drift');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.canonicalHydrologyUnchanged === true, 'canonical hydrology authority drift');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.canonicalRoadsUnchanged === true, 'canonical road authority drift');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.canonicalCollidersUnchanged === true, 'canonical collider authority drift');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.routeShoulderProjection === true, 'real routed-road shoulder projection disabled');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.maximumLogisticsRoadDistanceMeters <= 24, 'logistics road shoulder band widened excessively');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters >= 50, 'ambient apron entered castle footprint');
      fail(SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters < 100, 'ambient apron escaped kingdom-seat vicinity');
      fail(Object.keys(SETTLEMENT_AMBIENT_PROP_FAMILIES).length === 3, 'expected exactly three ambient prop families');

      const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
      const flattenPads = computeSettlementFlattenPads({
        sampleHeightMeters: baseSampleHeightMeters,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
        mapBounds: WORLD_SCALE.MAP_BOUNDS,
        metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
      });
      const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
      const seats = KINGDOM_SEATS.map((seat) => {
        const position = mapToWorldXZ(
          seat.mapX,
          seat.mapY,
          WORLD_SCALE.MAP_BOUNDS,
          WORLD_SCALE.METERS_PER_MAP_UNIT,
        );
        return {
          ...seat,
          x: position.x,
          z: position.z,
          groundY: sampleHeightMeters(position.x, position.z),
        };
      });
      fail(seats.length === 14, `expected 14 canonical kingdom seats, got ${seats.length}`);
      fail(flattenPads.length === seats.length, `expected ${seats.length} canonical flatten pads, got ${flattenPads.length}`);

      const roads = buildRoadNetwork({ seats, sampleHeightMeters });
      fail(roads.group?.name === 'road-network', 'live routed road group missing');
      fail(roads.edges.length > 0, 'no live routed road edges available to ambient placement');

      const plannerOptions = {
        sampleHeightMeters,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        seed: WORLD_DEFAULTS.WORLD_SEED,
        seats,
        roadEdges: roads.edges,
        worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
        worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
        isMobileClass: false,
      };
      const planA = generateSettlementAmbientPropPlacements(plannerOptions);
      const planB = generateSettlementAmbientPropPlacements(plannerOptions);
      fail(planA.stats.placementChecksum === planB.stats.placementChecksum, 'planner checksum is nondeterministic');
      fail(checksumSettlementAmbientPlacements(planA.placements) === planA.stats.placementChecksum, 'planner checksum metadata drift');
      fail(planA.placements.length === planB.placements.length, 'planner count is nondeterministic');
      fail(planA.placements.length >= 40, `ambient geography underfilled: ${planA.placements.length} placements`);
      fail(planA.placements.length <= seats.length * SETTLEMENT_AMBIENT_PROP_POLICY.desktopPropsPerSeat, 'ambient geography exceeded deterministic target');

      const placementIds = new Set();
      const occupiedSeats = new Set();
      const representedFamilies = new Set();
      let snowPlacements = 0;
      let valyriaPlacements = 0;
      let logisticsPlacements = 0;
      let logisticsRoadDistanceTotal = 0;
      let maxLogisticsRoadDistance = 0;
      let minRoadDistance = Infinity;
      let maxSlope = 0;
      let minSeatDistance = Infinity;
      let maxSeatDistance = 0;
      for (const placement of planA.placements) {
        fail(!placementIds.has(placement.id), `duplicate placement id ${placement.id}`);
        placementIds.add(placement.id);
        occupiedSeats.add(placement.seatId);
        representedFamilies.add(placement.familyId);
        fail(SETTLEMENT_AMBIENT_PROP_FAMILIES[placement.familyId], `unknown family ${placement.familyId}`);
        fail([placement.x, placement.y, placement.z, placement.yawRadians, placement.scale].every(Number.isFinite), `non-finite transform ${placement.id}`);
        fail(placement.y > WORLD_DEFAULTS.WATER_LEVEL_METERS + SETTLEMENT_AMBIENT_PROP_POLICY.shorelineClearanceMeters - 1e-6, `wet/shore placement ${placement.id}`);
        fail(placement.slopeDegrees <= SETTLEMENT_AMBIENT_PROP_POLICY.maximumSlopeDegrees + 1e-6, `slope breach ${placement.id}`);
        fail(placement.roadDistanceMeters >= SETTLEMENT_AMBIENT_PROP_POLICY.minimumRoadDistanceMeters - 1e-6, `road clearance breach ${placement.id}`);
        if (placement.distributionRole === 'logistics') {
          logisticsPlacements += 1;
          logisticsRoadDistanceTotal += placement.roadDistanceMeters;
          maxLogisticsRoadDistance = Math.max(maxLogisticsRoadDistance, placement.roadDistanceMeters);
          fail(placement.routeFacing === true, `logistics prop lost route-facing proof ${placement.id}`);
          fail(Number.isInteger(placement.routeEdgeIndex) && Number.isInteger(placement.routeSegmentIndex), `logistics route segment proof missing ${placement.id}`);
          fail(placement.roadDistanceMeters <= SETTLEMENT_AMBIENT_PROP_POLICY.maximumLogisticsRoadDistanceMeters + 1e-6, `logistics prop escaped road shoulder ${placement.id}: ${placement.roadDistanceMeters}`);
        }
        fail(placement.seatDistanceMeters >= SETTLEMENT_AMBIENT_PROP_POLICY.innerRadiusMeters - 1e-6, `inner apron breach ${placement.id}`);
        fail(placement.seatDistanceMeters <= SETTLEMENT_AMBIENT_PROP_POLICY.outerRadiusMeters + 1e-6, `outer apron breach ${placement.id}`);
        fail(nearlyEqual(sampleHeightMeters(placement.x, placement.z), placement.y, 1e-6), `terrain grounding drift ${placement.id}`);
        minRoadDistance = Math.min(minRoadDistance, placement.roadDistanceMeters);
        maxSlope = Math.max(maxSlope, placement.slopeDegrees);
        minSeatDistance = Math.min(minSeatDistance, placement.seatDistanceMeters);
        maxSeatDistance = Math.max(maxSeatDistance, placement.seatDistanceMeters);
        if (placement.snow >= 0.25) snowPlacements += 1;
        if (placement.valyria >= 0.25) valyriaPlacements += 1;
      }
      fail(occupiedSeats.size >= 10, `ambient geography covers only ${occupiedSeats.size}/14 seats`);
      fail(representedFamilies.size === 3, `ambient prop family diversity ${representedFamilies.size}/3`);
      fail(planA.stats.routeApproachSeatCount >= 6, `only ${planA.stats.routeApproachSeatCount} seats resolved a live road approach`);
      fail(planA.stats.roleCounts.logistics > 0 && planA.stats.roleCounts.social > 0, `ambient distribution roles collapsed: ${JSON.stringify(planA.stats.roleCounts)}`);
      fail(logisticsPlacements === planA.stats.logisticsShoulderCount, `logistics shoulder stats drift ${logisticsPlacements}/${planA.stats.logisticsShoulderCount}`);
      fail(logisticsPlacements === planA.stats.roleCounts.logistics, `logistics role stats drift ${logisticsPlacements}/${planA.stats.roleCounts.logistics}`);
      fail(nearlyEqual(planA.stats.meanLogisticsRoadDistanceMeters, logisticsRoadDistanceTotal / logisticsPlacements, 1e-6), 'mean logistics road distance metadata drift');
      fail(nearlyEqual(planA.stats.maxLogisticsRoadDistanceMeters, maxLogisticsRoadDistance, 1e-6), 'max logistics road distance metadata drift');
      fail(planA.placements.some((placement) => placement.routeFacing === true), 'no route-facing logistics props survived geographic rejection');
      fail(snowPlacements > 0, 'north climate authority did not affect any ambient placement');
      fail(valyriaPlacements > 0, 'Valyria authority did not affect any ambient placement');

      const ambient = createSettlementAmbientProps(plannerOptions);
      const auditBefore = auditSettlementAmbientProps(ambient.group);
      fail(auditBefore.ok, `ambient fallback audit failed: ${auditBefore.errors.join(',')}`);
      fail(ambient.group.name === SETTLEMENT_AMBIENT_PROP_POLICY.groupName, 'ambient group name drift');
      fail(ambient.group.children.filter((child) => child?.isInstancedMesh).length >= 2, 'fallback family draw calls missing');

      const fallbackMaterials = [];
      ambient.group.traverse((node) => {
        if (!node?.isMesh) return;
        for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
          if (material?.userData?.settlementAmbientWeathering) fallbackMaterials.push(material);
        }
      });
      fail(fallbackMaterials.length >= 2, 'fallback weathering materials missing');
      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientWeathering.worldSpace === true), 'fallback lost world-space weathering');
      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientWeathering.multiScaleAlbedo === true), 'fallback lost multi-scale albedo breakup');
      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientWeathering.microNormal === true), 'fallback lost micro-normal breakup');
      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientWeathering.roughnessVariation === true), 'fallback lost roughness breakup');
      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientFallbackFabric === true), 'fallback family-specific surface fabric missing');
      fail(fallbackMaterials.every((material) => material.map?.userData?.settlementAmbientFallbackFabric === true && material.roughnessMap?.userData?.settlementAmbientFallbackFabric === true && material.normalMap?.userData?.settlementAmbientFallbackFabric === true), 'fallback albedo/roughness/normal texture fabric missing');
      fail(fallbackMaterials.every((material) => material.userData.settlementAmbientNormalFabric === true), 'fallback normal fabric metadata missing');

      const hydration = await upgradeSettlementAmbientPropAssets(ambient.group, {
        isMobileClass: false,
        sampleHeightMeters,
        seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
        seats,
        roadEdges: roads.edges,
      });
      fail(hydration.status === 'active', `real ambient GLB hydration inactive: ${JSON.stringify(hydration)}`);
      fail(hydration.activeFamilyCount >= 2, `only ${hydration.activeFamilyCount} real ambient family hydrated`);
      fail(hydration.hydratedPlacementCount >= Math.floor(planA.placements.length * 0.45), `real ambient hydration too sparse: ${hydration.hydratedPlacementCount}/${planA.placements.length}`);

      const hydratedWrappers = [];
      const hydratedMaterials = [];
      let authoredMapsSeen = 0;
      ambient.group.traverse((node) => {
        if (node?.userData?.settlementAmbientHydrated) hydratedWrappers.push(node);
        if (!node?.isMesh) return;
        for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
          if (!material?.userData?.settlementAmbientWeathering) continue;
          hydratedMaterials.push(material);
          if (material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.aoMap) authoredMapsSeen += 1;
        }
      });
      fail(hydratedWrappers.length === hydration.hydratedPlacementCount, `hydrated wrapper count ${hydratedWrappers.length} != ${hydration.hydratedPlacementCount}`);
      fail(hydratedMaterials.length > 0, 'hydrated real models have no weathered materials');
      fail(hydratedMaterials.every((material) => material.userData.settlementAmbientWeathering.worldSpace === true), 'hydrated material lost world-space weathering');
      fail(hydratedMaterials.every((material) => material.userData.settlementAmbientWeathering.authoredMapsPreserved === Boolean(material.map || material.normalMap || material.roughnessMap)), 'authored-map preservation metadata disagrees with live material');
      fail(authoredMapsSeen > 0, 'no authored material maps survived real GLB hydration');
      for (const wrapper of hydratedWrappers) {
        const surface = wrapper.userData.worldPlacementSurface;
        fail(surface && Number.isFinite(surface.height), `hydrated placement lost surface proof: ${wrapper.name}`);
        fail(surface.slopeDegrees == null || surface.slopeDegrees <= SETTLEMENT_AMBIENT_PROP_POLICY.maximumSlopeDegrees + 1e-6, `hydrated placement slope breach: ${wrapper.name}`);
        fail(surface.roadDistance == null || surface.roadDistance >= SETTLEMENT_AMBIENT_PROP_POLICY.minimumRoadDistanceMeters - 1e-6, `hydrated placement road breach: ${wrapper.name}`);
        fail(wrapper.userData.distributionRole !== 'logistics' || surface.roadDistance == null || surface.roadDistance <= SETTLEMENT_AMBIENT_PROP_POLICY.maximumLogisticsRoadDistanceMeters + 1e-6, `hydrated logistics prop escaped road shoulder: ${wrapper.name}`);
      }

      const placementsBySeat = new Map();
      for (const placement of planA.placements) {
        if (!placementsBySeat.has(placement.seatId)) placementsBySeat.set(placement.seatId, []);
        placementsBySeat.get(placement.seatId).push(placement);
      }
      const focusEntry = [...placementsBySeat.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
      fail(focusEntry && focusEntry[1].length >= 3, 'no seat has a useful ambient visual cluster');
      const focusSeat = seats.find((seat) => seat.id === focusEntry[0]);
      fail(focusSeat, `focus seat ${focusEntry[0]} missing`);

      const canvas = document.getElementById('qa-canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1440, 900, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x879caa);
      scene.fog = new THREE.FogExp2(0x879caa, 0.00115);
      const hemi = new THREE.HemisphereLight(0xd9e4ea, 0x5b4939, 1.45);
      const sun = new THREE.DirectionalLight(0xfff0d2, 2.2);
      sun.position.set(focusSeat.x - 160, focusSeat.groundY + 240, focusSeat.z + 120);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 10;
      sun.shadow.camera.far = 650;
      sun.shadow.camera.left = -180;
      sun.shadow.camera.right = 180;
      sun.shadow.camera.top = 180;
      sun.shadow.camera.bottom = -180;
      scene.add(hemi, sun);

      const chunkManager = new ChunkManager({
        scene,
        chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
        segments: Math.max(48, CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP),
        seed: WORLD_DEFAULTS.WORLD_SEED,
        flattenPads,
      });
      const chunkX = Math.round(focusSeat.x / CHUNK_CONFIG.CHUNK_SIZE_METERS);
      const chunkZ = Math.round(focusSeat.z / CHUNK_CONFIG.CHUNK_SIZE_METERS);
      chunkManager.loadSquare(chunkX, chunkZ, 1);
      scene.add(roads.group);
      scene.add(ambient.group);

      const camera = new THREE.PerspectiveCamera(48, 1440 / 900, 0.1, 1400);
      const focusY = sampleHeightMeters(focusSeat.x, focusSeat.z);
      const clusterCenter = focusEntry[1].reduce((acc, placement) => {
        acc.x += placement.x;
        acc.z += placement.z;
        return acc;
      }, { x: 0, z: 0 });
      clusterCenter.x /= focusEntry[1].length;
      clusterCenter.z /= focusEntry[1].length;
      const outwardX = clusterCenter.x - focusSeat.x;
      const outwardZ = clusterCenter.z - focusSeat.z;
      const outwardLength = Math.max(1, Math.hypot(outwardX, outwardZ));
      const nx = outwardX / outwardLength;
      const nz = outwardZ / outwardLength;
      camera.position.set(
        clusterCenter.x + nz * 31 + nx * 48,
        focusY + 23,
        clusterCenter.z - nx * 31 + nz * 48,
      );
      camera.lookAt(clusterCenter.x, focusY + 1.2, clusterCenter.z);

      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const glError = gl.getError();
      fail(glError === gl.NO_ERROR, `WebGL error after ambient prop render: ${glError}`);
      const renderCalls = renderer.info.render.calls;
      const triangles = renderer.info.render.triangles;
      fail(renderCalls > 0 && triangles > 0, `empty WebGL render calls=${renderCalls} triangles=${triangles}`);

      const auditAfter = auditSettlementAmbientProps(ambient.group);
      fail(auditAfter.ok, `post-hydration ambient audit failed: ${auditAfter.errors.join(',')}`);

      window.__settlementAmbientQa = {
        cleanup() {
          scene.remove(ambient.group);
          scene.remove(roads.group);
          chunkManager.disposeAll();
          disposeSettlementAmbientProps(ambient.group);
          disposeRoadNetwork(roads.group);
          renderer.dispose();
        },
      };

      return {
        policyId: SETTLEMENT_AMBIENT_PROP_POLICY.id,
        placementCount: planA.placements.length,
        placementChecksum: planA.stats.placementChecksum,
        occupiedSeatCount: occupiedSeats.size,
        familyCounts: planA.stats.familyCounts,
        climateCounts: planA.stats.climateCounts,
        roleCounts: planA.stats.roleCounts,
        routeApproachSeatCount: planA.stats.routeApproachSeatCount,
        logisticsShoulderCount: planA.stats.logisticsShoulderCount,
        meanLogisticsRoadDistanceMeters: planA.stats.meanLogisticsRoadDistanceMeters,
        maxLogisticsRoadDistanceMeters: planA.stats.maxLogisticsRoadDistanceMeters,
        minRoadDistance,
        maxSlope,
        minSeatDistance,
        maxSeatDistance,
        hydration: {
          status: hydration.status,
          activeFamilyCount: hydration.activeFamilyCount,
          hydratedPlacementCount: hydration.hydratedPlacementCount,
          families: hydration.families.map((entry) => ({
            familyId: entry.familyId,
            status: entry.status,
            placementCount: entry.placementCount ?? 0,
            hydratedPlacementCount: entry.hydratedPlacementCount ?? 0,
            hostedContentLength: entry.hostedContentLength ?? null,
          })),
        },
        hydratedWrapperCount: hydratedWrappers.length,
        hydratedWeatheredMaterialCount: hydratedMaterials.length,
        authoredMapsSeen,
        focusSeatId: focusSeat.id,
        focusSeatPlacementCount: focusEntry[1].length,
        terrainChunkCount: chunkManager.loadedCount,
        renderCalls,
        triangles,
      };
    });

    assert(result.placementCount >= 40, `unexpected browser placement count ${result.placementCount}`);
    assert(result.logisticsShoulderCount > 0, 'browser produced no routed-road shoulder props');
    assert(result.maxLogisticsRoadDistanceMeters <= 23 + 1e-6, `browser logistics shoulder escaped: ${result.maxLogisticsRoadDistanceMeters}`);
    assert(result.hydration.status === 'active', 'browser did not hydrate real prop assets');
    assert(result.renderCalls > 0 && result.triangles > 0, 'browser produced empty render');
    assert(browserErrors.length === 0, `browser emitted errors: ${browserErrors.join(' | ')}`);

    const screenshotPath = path.join(artifactDir, 'settlement-ambient-props.png');
    await page.screenshot({ path: screenshotPath, type: 'png' });
    const reportPath = path.join(artifactDir, 'settlement-ambient-props.json');
    fs.writeFileSync(reportPath, `${JSON.stringify({ ...result, browserErrors }, null, 2)}\n`);

    await page.evaluate(() => window.__settlementAmbientQa?.cleanup?.());
    console.log(
      `[checkSettlementAmbientProps] PASS: ${result.placementCount} deterministic canonical-seat apron props, `
      + `${result.logisticsShoulderCount} constrained to real routed-road shoulders (max ${result.maxLogisticsRoadDistanceMeters.toFixed(2)}m), `
      + `${result.hydration.hydratedPlacementCount} hydrated from ${result.hydration.activeFamilyCount} real GLB families, `
      + `${result.authoredMapsSeen} authored-map material(s), ${result.terrainChunkCount} real terrain chunks, `
      + `WebGL ${result.renderCalls} calls/${result.triangles} triangles; screenshot ${screenshotPath}`,
    );
  } catch (error) {
    console.error(`[checkSettlementAmbientProps] FAIL: ${error?.stack || error}`);
    if (page) {
      try {
        const failurePath = path.join(artifactDir, 'settlement-ambient-props-failure.png');
        await page.screenshot({ path: failurePath, type: 'png' });
      } catch {}
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkSettlementAmbientProps] FATAL: ${error?.stack || error}`);
  process.exit(1);
});