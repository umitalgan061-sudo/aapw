import fs from 'node:fs/promises';
import path from 'node:path';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkIceLandmarksVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const artifactDir = path.resolve('artifacts/ice-landmarks-visual-qa');
const VIEWPORT = Object.freeze({ width: 1200, height: 720 });
const MAP_VIEWPORT = Object.freeze({ width: 1200, height: 800 });
await fs.mkdir(artifactDir, { recursive: true });
const server = await startStaticServer();
let browser;
try {
  browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${server.baseUrl}/ice-landmarks-visual-qa.html`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => window.__iceQa?.ready === true, null, { timeout: 60000 });
  } catch (error) {
    throw new Error(`ice WebGL harness did not become ready within 60s${errors.length ? `; browser errors: ${errors.join(' | ')}` : ''}`, { cause: error });
  }

  const evidence = await page.evaluate(async () => {
    const [{ ICE_LANDMARK_POLICY }, { REFERENCE_BIOME_ZONES, WORLD_REFERENCE_MAP }] = await Promise.all([
      import('./src/3d/world/iceLandmarks.js'),
      import('./src/3d/world/worldReferenceMap.js'),
    ]);
    const stats = window.__iceQa.stats;
    const wallPath = ICE_LANDMARK_POLICY.wall.pathNormalized.map(([x, y]) => [x, y]);
    const caveAnchor = [...ICE_LANDMARK_POLICY.cave.anchorNormalized];
    const winter = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'lands-always-winter');
    const north = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'north');
    return {
      stats,
      policyId: ICE_LANDMARK_POLICY.id,
      wallPath,
      caveAnchor,
      wallDesign: {
        baseHeightMeters: ICE_LANDMARK_POLICY.wall.baseHeightMeters,
        heightVariationMeters: ICE_LANDMARK_POLICY.wall.heightVariationMeters,
        baseThicknessMeters: ICE_LANDMARK_POLICY.wall.baseThicknessMeters,
        thicknessVariationMeters: ICE_LANDMARK_POLICY.wall.thicknessVariationMeters,
      },
      caveDesign: {
        openingHalfWidthMeters: ICE_LANDMARK_POLICY.cave.openingHalfWidthMeters,
        tunnelDepthMeters: ICE_LANDMARK_POLICY.cave.tunnelDepthMeters,
      },
      referenceMap: WORLD_REFERENCE_MAP,
      biomeAnchors: {
        winterCenterY: winter?.center?.[1] ?? null,
        northCenterY: north?.center?.[1] ?? null,
      },
    };
  });
  const stats = evidence.stats;
  if (!(stats.width > 2200 && stats.width < 3600)) throw new Error(`wall width outside visual contract: ${stats.width}`);
  if (!(stats.height > 170 && stats.height < 330)) throw new Error(`ice-landmark group height outside visual envelope: ${stats.height}`);
  if (!(evidence.wallDesign.baseHeightMeters >= 145 && evidence.wallDesign.baseHeightMeters <= 175)) {
    throw new Error(`The Wall base height drifted outside the audited natural-cliff range: ${JSON.stringify(evidence.wallDesign)}`);
  }
  if (!(evidence.wallDesign.heightVariationMeters >= 20 && evidence.wallDesign.heightVariationMeters <= 40)) {
    throw new Error(`The Wall height variation is no longer natural but bounded: ${JSON.stringify(evidence.wallDesign)}`);
  }
  if (!(evidence.wallDesign.baseThicknessMeters >= 24 && evidence.wallDesign.baseThicknessMeters <= 42)) {
    throw new Error(`The Wall thickness drifted outside the audited glacial range: ${JSON.stringify(evidence.wallDesign)}`);
  }
  if (!(evidence.caveDesign.openingHalfWidthMeters >= 6 && evidence.caveDesign.openingHalfWidthMeters <= 10 && evidence.caveDesign.tunnelDepthMeters >= 70)) {
    throw new Error(`ice cave is no longer a traversable Wall tunnel: ${JSON.stringify(evidence.caveDesign)}`);
  }
  if (!(stats.blockers > 40)) throw new Error(`insufficient collision blockers: ${stats.blockers}`);
  if (stats.terrainAuthority !== 'canonical-createHeightSampler+terrainBiomeShading+terrainMicroSurface') {
    throw new Error(`ice QA lost canonical terrain authority: ${stats.terrainAuthority}`);
  }
  if (!(stats.terrain?.vertexCount > 10000)) throw new Error(`canonical terrain patch unexpectedly coarse: ${stats.terrain?.vertexCount}`);
  if (!(stats.terrain?.reliefSpan > 1)) throw new Error(`canonical terrain relief collapsed: ${stats.terrain?.reliefSpan}`);
  if (![stats.terrain?.minHeight, stats.terrain?.maxHeight, stats.terrain?.meanSnowWeight, stats.terrain?.meanRockWeight].every(Number.isFinite)) {
    throw new Error(`canonical terrain telemetry contains non-finite values: ${JSON.stringify(stats.terrain)}`);
  }
  for (const role of [
    'natural-ice-wall', 'arched-wall-portal', 'walkable-ice-cave-shell', 'cave-ceiling-icicles',
    'wall-serac-buttresses', 'wall-basal-talus', 'wall-snow-cornices', 'cave-fracture-ribs',
  ]) {
    if (!stats.roles.includes(role)) throw new Error(`missing visual role: ${role}`);
  }
  if (stats.realism?.version !== 4 || stats.realism?.wallTexture?.resolution !== '256x512' || stats.realism?.caveTexture?.resolution !== '256x512') {
    throw new Error(`natural glacial surface telemetry missing: ${JSON.stringify(stats.realism)}`);
  }
  if (!(stats.realism.seracCount >= 20 && stats.realism.seracCount <= 45)) {
    throw new Error(`wall serac breakup lost the sparse-but-present v4 envelope: ${stats.realism.seracCount}`);
  }
  if (!(stats.realism.talusCount >= 8 && stats.realism.corniceCount >= 6)) {
    throw new Error(`wall erosion/deposition breakup regressed: talus=${stats.realism.talusCount} cornices=${stats.realism.corniceCount}`);
  }
  if (!(stats.realism.wallTexture.crackCoverage > 0.01 && stats.realism.wallTexture.frostCoverage > 0.12 && stats.realism.wallTexture.debrisCoverage > 0.01)) {
    throw new Error(`wall lost fracture/frost/debris breakup: ${JSON.stringify(stats.realism.wallTexture)}`);
  }
  if (!(stats.realism.wallTexture.blueCoreCoverage > 0.005 && stats.realism.caveTexture.blueCoreCoverage > stats.realism.wallTexture.blueCoreCoverage)) {
    throw new Error(`dense blue ice exposure regressed: ${JSON.stringify(stats.realism)}`);
  }
  if (!(stats.realism.caveTexture.wetCoverage > stats.realism.wallTexture.wetCoverage)) {
    throw new Error(`cave wetness no longer exceeds exterior Wall: ${JSON.stringify(stats.realism)}`);
  }

  const wallYs = evidence.wallPath.map(([, y]) => y);
  const meanWallY = wallYs.reduce((sum, value) => sum + value, 0) / wallYs.length;
  if (!(evidence.biomeAnchors.winterCenterY < meanWallY && meanWallY < evidence.biomeAnchors.northCenterY)) {
    throw new Error(`The Wall must remain between Always Winter and the North: ${JSON.stringify(evidence.biomeAnchors)} wallY=${meanWallY}`);
  }
  if (!evidence.wallPath.every(([x, y], index, source) => x >= 0 && x <= 1 && y >= 0 && y <= 1 && (index === 0 || x > source[index - 1][0]))) {
    throw new Error(`The Wall map path must be in-bounds and west-to-east monotonic: ${JSON.stringify(evidence.wallPath)}`);
  }
  const caveDistance = Math.min(...evidence.wallPath.map(([x, y]) => Math.hypot(x - evidence.caveAnchor[0], y - evidence.caveAnchor[1])));
  if (caveDistance > 0.012) throw new Error(`ice cave anchor drifted away from The Wall: normalized distance ${caveDistance}`);

  for (const view of ['wall', 'detail', 'cave', 'interior']) {
    await page.evaluate((name) => window.__iceQa.render(name), view);
    await page.waitForTimeout(220);
    await page.screenshot({ path: path.join(artifactDir, `${view}.png`) });
  }

  const mapPage = await browser.newPage({ viewport: MAP_VIEWPORT, deviceScaleFactor: 1 });
  const mapPoints = evidence.wallPath
    .map(([x, y]) => `${(x * MAP_VIEWPORT.width).toFixed(2)},${(y * MAP_VIEWPORT.height).toFixed(2)}`)
    .join(' ');
  const caveX = evidence.caveAnchor[0] * MAP_VIEWPORT.width;
  const caveY = evidence.caveAnchor[1] * MAP_VIEWPORT.height;
  await mapPage.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#10161d}
    .map{position:relative;width:${MAP_VIEWPORT.width}px;height:${MAP_VIEWPORT.height}px}
    img,svg{position:absolute;inset:0;width:100%;height:100%;display:block}
    .tag{position:absolute;left:18px;top:18px;padding:8px 12px;background:rgba(0,0,0,.72);color:white;font:16px sans-serif;border-radius:5px}
  </style></head><body><div class="map">
    <img id="owner-map" src="${server.baseUrl}/map.png/map.png" alt="owner map">
    <svg viewBox="0 0 ${MAP_VIEWPORT.width} ${MAP_VIEWPORT.height}" aria-label="The Wall source-map alignment">
      <polyline points="${mapPoints}" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${mapPoints}" fill="none" stroke="#071017" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${caveX.toFixed(2)}" cy="${caveY.toFixed(2)}" r="10" fill="#ffcf33" stroke="#111" stroke-width="3"/>
    </svg>
    <div class="tag">cyan = runtime The Wall · yellow = ice cave</div>
  </div></body></html>`, { waitUntil: 'load' });
  await mapPage.waitForFunction(() => document.getElementById('owner-map')?.complete === true, null, { timeout: 15000 });
  const mapImage = await mapPage.evaluate(() => {
    const image = document.getElementById('owner-map');
    return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
  });
  if (!(mapImage.naturalWidth > 0 && mapImage.naturalHeight > 0)) throw new Error('owner map failed to decode in map-alignment proof');
  await mapPage.screenshot({ path: path.join(artifactDir, 'map-alignment.png') });
  await mapPage.close();

  const lifecycle = await page.evaluate(() => window.__iceQa.dispose());
  await page.waitForTimeout(50);
  if (lifecycle?.disposed !== true || lifecycle?.landmarkDisposed !== true || lifecycle?.landmarkChildren !== 0) {
    throw new Error(`ice landmark lifecycle disposal failed: ${JSON.stringify(lifecycle)}`);
  }
  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);

  const report = {
    ...stats,
    wallDesign: evidence.wallDesign,
    caveDesign: evidence.caveDesign,
    lifecycle,
    mapAlignment: {
      policyId: evidence.policyId,
      wallPathNormalized: evidence.wallPath,
      caveAnchorNormalized: evidence.caveAnchor,
      meanWallY,
      caveNearestPathPointDistance: caveDistance,
      winterCenterY: evidence.biomeAnchors.winterCenterY,
      northCenterY: evidence.biomeAnchors.northCenterY,
      sourceMapNaturalSize: mapImage,
      sourceMapDeclaredSize: {
        width: evidence.referenceMap.pixelWidth,
        height: evidence.referenceMap.pixelHeight,
      },
    },
  };
  await fs.writeFile(path.join(artifactDir, 'stats.json'), JSON.stringify(report, null, 2));
  console.log(
    `Ice landmarks visual QA passed: ${stats.width.toFixed(1)}m wall span, ${evidence.wallDesign.baseHeightMeters}m designed wall height, ` +
    `${stats.height.toFixed(1)}m full landmark envelope, ${stats.blockers} blockers, ${stats.realism.seracCount} seracs, ` +
    `canonical terrain relief ${stats.terrain.reliefSpan.toFixed(1)}m, wall map Y ${meanWallY.toFixed(4)}.`,
  );
} finally {
  await browser?.close();
  await server.stop();
}
