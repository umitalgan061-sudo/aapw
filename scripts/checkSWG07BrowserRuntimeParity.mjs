#!/usr/bin/env node
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const GRID = 33;
const HEIGHT_EPSILON = 1e-9;

function fail(message) {
  console.error(`[checkSWG07BrowserRuntimeParity] FAIL: ${message}`);
  process.exit(1);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

const playwright = loadPlaywright();
requireCondition(Boolean(playwright), 'Playwright is required');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/game3d.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });

  const result = await page.evaluate(async ({ grid, heightEpsilon }) => {
    const {
      G07_TERRAIN3D_RUNTIME_BAKE,
      sampleG07Terrain3dBakeNormalized,
    } = await import('/src/3d/world/g07Terrain3dBake.js');
    const {
      sampleCanonicalHydrologyTerrainTarget,
    } = await import('/src/3d/world/worldReferenceTerrainAdapter.js');
    const {
      normalizedReferenceToMapCanvas,
    } = await import('/src/3d/world/worldReferenceAlignment.js');
    const {
      mapCanvasToPlannedWorldXZ,
    } = await import('/src/3d/world/worldReferenceMigrationPlan.js');

    const bounds = G07_TERRAIN3D_RUNTIME_BAKE.normalizedBounds;
    let finiteSamples = 0;
    let terrain3dRules = 0;
    let waterSamples = 0;
    let maxHeightError = 0;
    let maxSurfaceHeightError = 0;
    let minHeight = Infinity;
    let maxHeight = -Infinity;
    let minRock = Infinity;
    let maxRock = -Infinity;
    let checksum = 2166136261;

    for (let y = 0; y < grid; y += 1) {
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (grid - 1));
      for (let x = 0; x < grid; x += 1) {
        const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (grid - 1));
        const packed = sampleG07Terrain3dBakeNormalized(nx, ny);
        if (!packed) return { error: `packed payload returned null at ${x},${y}` };
        const map = normalizedReferenceToMapCanvas(nx, ny);
        const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
        const target = sampleCanonicalHydrologyTerrainTarget({
          worldX: world.x,
          worldZ: world.z,
          baseHeightSampler: () => 50,
          seaLevelMeters: 0,
          protectedSites: [],
          protectionRadii: { x: 0.001, y: 0.001 },
        });
        const values = [
          packed.height,
          packed.rockBlend,
          packed.color[0],
          packed.color[1],
          packed.color[2],
          packed.roughness,
          target.targetHeightMeters,
        ];
        if (!values.every(Number.isFinite)) return { error: `non-finite sample at ${x},${y}` };
        if (packed.snowBlend !== 0 || packed.roadBlend !== 0 || packed.pathBlend !== 0) {
          return { error: `forbidden packed surface at ${x},${y}` };
        }
        if (!target.terrain3dSurface) return { error: `adapter omitted Terrain3D surface at ${x},${y}` };
        if (target.rule === 'terrain3d-bake-g07') terrain3dRules += 1;
        if (target.hydrology.water) waterSamples += 1;
        const heightError = Math.abs(target.targetHeightMeters - packed.height);
        const surfaceHeightError = Math.abs(target.terrain3dSurface.height - packed.height);
        maxHeightError = Math.max(maxHeightError, heightError);
        maxSurfaceHeightError = Math.max(maxSurfaceHeightError, surfaceHeightError);
        minHeight = Math.min(minHeight, packed.height);
        maxHeight = Math.max(maxHeight, packed.height);
        minRock = Math.min(minRock, packed.rockBlend);
        maxRock = Math.max(maxRock, packed.rockBlend);
        for (const value of values) {
          const q = Math.round(value * 1000000);
          for (let shift = 0; shift < 32; shift += 8) {
            checksum ^= (q >>> shift) & 0xff;
            checksum = Math.imul(checksum, 16777619) >>> 0;
          }
        }
        finiteSamples += 1;
      }
    }

    const outside = sampleG07Terrain3dBakeNormalized(bounds.xMax + 0.0001, (bounds.yMin + bounds.yMax) * 0.5);
    return {
      finiteSamples,
      terrain3dRules,
      waterSamples,
      maxHeightError,
      maxSurfaceHeightError,
      minHeight,
      maxHeight,
      minRock,
      maxRock,
      outsideIsNull: outside === null,
      heightEpsilon,
      checksum,
      canonicalBakeSha256: G07_TERRAIN3D_RUNTIME_BAKE.canonicalBakeSha256,
      importedTopdownSha256: G07_TERRAIN3D_RUNTIME_BAKE.importedTopdownSha256,
      terrain3dRegionCount: G07_TERRAIN3D_RUNTIME_BAKE.terrain3dRegionCount,
      terrain3dBakedVertices: G07_TERRAIN3D_RUNTIME_BAKE.terrain3dBakedVertices,
    };
  }, { grid: GRID, heightEpsilon: HEIGHT_EPSILON });

  requireCondition(!result.error, result.error ?? 'unknown browser adapter error');
  requireCondition(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  const expected = GRID * GRID;
  requireCondition(result.finiteSamples === expected, `expected ${expected} finite samples, got ${result.finiteSamples}`);
  requireCondition(result.terrain3dRules === expected, `adapter selected Terrain3D rule ${result.terrain3dRules}/${expected}`);
  requireCondition(result.waterSamples === expected, `canonical water classification ${result.waterSamples}/${expected}`);
  requireCondition(result.maxHeightError <= HEIGHT_EPSILON, `adapter height error ${result.maxHeightError}`);
  requireCondition(result.maxSurfaceHeightError <= HEIGHT_EPSILON, `adapter surface height error ${result.maxSurfaceHeightError}`);
  requireCondition(result.maxHeight < 0, `G07 packed seabed crossed water plane: ${result.maxHeight}`);
  requireCondition(result.maxHeight > result.minHeight, 'G07 packed seabed lost relief variation');
  requireCondition(result.maxRock > result.minRock, 'G07 packed rock field lost variation');
  requireCondition(result.outsideIsNull, 'G07 packed payload escaped its owner-map bounds');
  requireCondition(result.terrain3dRegionCount >= 4, `Terrain3D region provenance ${result.terrain3dRegionCount}`);
  requireCondition(result.terrain3dBakedVertices > 0, 'Terrain3D baked-vertex provenance is empty');

  console.log(`SW_G07_BROWSER_RUNTIME_PARITY_METRICS=${JSON.stringify(result)}`);
  console.log('SW_G07_BROWSER_RUNTIME_PARITY_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
