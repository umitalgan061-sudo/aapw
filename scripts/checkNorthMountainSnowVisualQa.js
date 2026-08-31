#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkNorthMountainSnowVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/north-mountain-snow-visual-qa';
const VIEWPORT = Object.freeze({ width: 1280, height: 760 });

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});

try {
  await page.goto(`${server.baseUrl}/north-mountain-snow-visual-qa.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => Boolean(window.__northMountainSnowQaModules || window.__northMountainSnowQaBootstrapError),
    null,
    { timeout: 10000 },
  );
  const bootstrapError = await page.evaluate(() => window.__northMountainSnowQaBootstrapError ?? null);
  if (bootstrapError) throw new Error(`north mountain snow browser bootstrap failed: ${bootstrapError}`);

  const report = await page.evaluate(({ viewport }) => {
    const {
      THREE,
      terrain,
      snowTone,
      WORLD_SCALE,
      WORLD_REFERENCE_ALIGNMENT,
    } = window.__northMountainSnowQaModules ?? {};
    if (!THREE || !terrain || !snowTone || !WORLD_SCALE || !WORLD_REFERENCE_ALIGNMENT) {
      throw new Error('north mountain snow QA modules did not initialize');
    }

    const {
      TERRAIN_BIOME_PALETTE,
      TERRAIN_BIOME_SHADING_POLICY,
      northClimateWeightsAtWorldXZ,
      resolveTerrainBiomeColor,
      resolveTerrainSnowCoverage,
    } = terrain;
    const {
      TERRAIN_SNOW_SURFACE_TONE_POLICY,
      resolveTerrainSnowSurfaceTone,
    } = snowTone;

    function worldAt(normalizedX, normalizedY) {
      const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
      const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
      const mapX = normalizedX * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
      const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
      return {
        x: (mapX - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
        z: (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
      };
    }

    function colorDistance(a, b) {
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    }

    function fixture(spec) {
      const world = worldAt(spec.normalizedX, spec.normalizedY);
      const climate = northClimateWeightsAtWorldXZ(world.x, world.z);
      const snow = resolveTerrainSnowCoverage({
        heightAboveSeaMeters: spec.height,
        slopeDegrees: spec.slope,
        snowWeight: spec.snowWeight,
        worldX: world.x,
        worldZ: world.z,
        terrainConcavityMeters: spec.terrainConcavityMeters,
        terrainWindward: spec.terrainWindward,
        terrainLee: spec.terrainLee,
      });
      const tone = resolveTerrainSnowSurfaceTone({
        snowAmount: snow.snowAmount,
        permanentIce: snow.permanentIce,
        tundra: snow.tundra,
        windwardScour: snow.windwardScour,
        leeDeposit: snow.leeDeposit,
        ridgeExposure: snow.ridgeExposure,
        concavityHold: snow.concavityHold,
        gentleSlope: snow.gentleSlope,
      });
      const color = resolveTerrainBiomeColor(new THREE.Color(), {
        heightAboveSeaMeters: spec.height,
        slopeDegrees: spec.slope,
        rockWeight: 0,
        snowWeight: spec.snowWeight,
        worldX: world.x,
        worldZ: world.z,
        terrainConcavityMeters: spec.terrainConcavityMeters,
        terrainWindward: spec.terrainWindward,
        terrainLee: spec.terrainLee,
      });
      return {
        ...spec,
        permanentIce: climate.permanentIce,
        tundra: climate.tundra,
        snowAmount: snow.snowAmount,
        snowSupply: snow.snowSupply,
        windwardScour: snow.windwardScour,
        leeDeposit: snow.leeDeposit,
        packedWeight: tone.packedWeight,
        accumulatedWeight: tone.accumulatedWeight,
        accumulatedGlacialPaletteRetention: tone.accumulatedGlacialPaletteRetention,
        glacialFamilySupport: tone.glacialFamilySupport,
        colorHex: `#${color.getHexString()}`,
        toGlacialIce: colorDistance(color, TERRAIN_BIOME_PALETTE.GLACIAL_ICE),
        toCoastalIce: colorDistance(color, TERRAIN_BIOME_PALETTE.COASTAL_ICE),
        toPackedSnow: colorDistance(color, TERRAIN_BIOME_PALETTE.PACKED_SNOW),
        toAccumulatedSnow: colorDistance(color, TERRAIN_BIOME_PALETTE.ACCUMULATED_SNOW),
        color,
      };
    }

    const specs = [
      {
        label: 'FAR NORTH WINDWARD', normalizedX: 0.145, normalizedY: 0.115,
        height: 180, slope: 16, snowWeight: 0.78,
        terrainConcavityMeters: -3.2, terrainWindward: 0.94, terrainLee: 0,
      },
      {
        label: 'FAR NORTH LEE', normalizedX: 0.145, normalizedY: 0.115,
        height: 180, slope: 16, snowWeight: 0.78,
        terrainConcavityMeters: 3.8, terrainWindward: 0, terrainLee: 0.94,
      },
      {
        label: 'ICE EDGE LEE', normalizedX: 0.155, normalizedY: 0.20,
        height: 180, slope: 16, snowWeight: 0.78,
        terrainConcavityMeters: 3.8, terrainWindward: 0, terrainLee: 0.94,
      },
      {
        label: 'TUNDRA LEE', normalizedX: 0.175, normalizedY: 0.30,
        height: 260, slope: 16, snowWeight: 0.78,
        terrainConcavityMeters: 3.8, terrainWindward: 0, terrainLee: 0.94,
      },
    ];
    const samples = specs.map(fixture);

    const root = document.getElementById('qa-root');
    const panel = document.getElementById('qa-panel');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    root.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaeb8c2);
    scene.fog = new THREE.Fog(0xaeb8c2, 170, 360);
    const camera = new THREE.PerspectiveCamera(30, viewport.width / viewport.height, 0.1, 700);
    camera.position.set(0, 105, 175);
    camera.lookAt(0, 2, -12);

    scene.add(new THREE.HemisphereLight(0xdde8ef, 0x4f5551, 1.7));
    const key = new THREE.DirectionalLight(0xfff3dc, 2.15);
    key.position.set(100, 160, 80);
    scene.add(key);

    const spacing = 58;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const geometry = new THREE.BoxGeometry(46, 2.5, 64, 10, 1, 12);
      const material = new THREE.MeshStandardMaterial({ color: sample.color, roughness: 0.92, metalness: 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((index - 1.5) * spacing, 0, -10);
      mesh.rotation.x = index === 0 ? -0.08 : 0.05;
      mesh.rotation.z = index === 0 ? -0.05 : index === 1 ? 0.05 : 0;
      scene.add(mesh);
    }

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 190),
      new THREE.MeshStandardMaterial({ color: 0x5d6660, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    scene.add(floor);

    panel.textContent = [
      `NORTH MOUNTAIN SNOW QA · ${TERRAIN_SNOW_SURFACE_TONE_POLICY.id}`,
      `terrain=${TERRAIN_BIOME_SHADING_POLICY.id}`,
      ...samples.map((sample) => `${sample.label}: ${sample.colorHex} snow=${sample.snowAmount.toFixed(2)} packed=${sample.packedWeight.toFixed(2)} accumulated=${sample.accumulatedWeight.toFixed(2)} retention=${sample.accumulatedGlacialPaletteRetention.toFixed(2)}`),
    ].join('\n');

    renderer.render(scene, camera);
    return {
      terrainPolicy: TERRAIN_BIOME_SHADING_POLICY.id,
      snowPolicy: TERRAIN_SNOW_SURFACE_TONE_POLICY.id,
      samples: samples.map(({ color, ...sample }) => sample),
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
    };
  }, { viewport: VIEWPORT });

  await page.screenshot({ path: `${ARTIFACT_DIR}/north-mountain-snow-harmony.png`, fullPage: true });
  const normalized = {
    ...report,
    samples: report.samples.map((sample) => Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]))),
    browserErrors,
  };
  await writeFile(`${ARTIFACT_DIR}/north-mountain-snow-report.json`, `${JSON.stringify(normalized, null, 2)}\n`);

  assert.deepEqual(browserErrors, [], `north mountain snow browser QA emitted errors: ${browserErrors.join(' | ')}`);
  assert.equal(report.samples.length, 4, 'mountain snow visual proof must render four canonical snow fixtures');
  assert(report.renderCalls >= 5 && report.triangles > 500,
    'mountain snow visual proof must render real lit WebGL geometry');

  const [windward, lee, iceEdgeLee, tundraLee] = report.samples;
  assert(windward.permanentIce > 0.99 && lee.permanentIce > 0.99,
    'far-north windward and lee fixtures must stay inside full permanent ice');
  assert(iceEdgeLee.permanentIce > 0.45 && iceEdgeLee.permanentIce < 0.7,
    'ICE EDGE visual fixture must remain inside the mixed cryosphere belt');
  assert.equal(tundraLee.permanentIce, 0,
    'tundra visual fixture must remain outside permanent ice');
  assert(windward.snowAmount > 0.5 && lee.snowAmount > 0.5 && iceEdgeLee.snowAmount > 0.5 && tundraLee.snowAmount > 0.5,
    'all mountain snow fixtures must render meaningful retained snow rather than bare ground');

  assert(windward.packedWeight > lee.packedWeight,
    'windward permanent-ice ridge must remain more packed than the sheltered lee fixture');
  assert(lee.accumulatedWeight > windward.accumulatedWeight,
    'sheltered permanent-ice lee fixture must retain more accumulated snow tone than windward ridge');
  assert(lee.accumulatedGlacialPaletteRetention < iceEdgeLee.accumulatedGlacialPaletteRetention,
    'warm accumulated palette retention must strengthen toward the permanent-ice core');
  assert(iceEdgeLee.accumulatedGlacialPaletteRetention < tundraLee.accumulatedGlacialPaletteRetention,
    'ICE EDGE retained snow must remain between far-north and tundra palette behavior');
  assert.equal(tundraLee.accumulatedGlacialPaletteRetention, 1,
    'pure tundra lee snow must keep the original accumulated palette retention');

  assert(windward.toPackedSnow < lee.toPackedSnow,
    'windward runtime terrain color should land closer to packed snow than sheltered lee terrain');
  assert(iceEdgeLee.toGlacialIce < tundraLee.toGlacialIce,
    'ICE EDGE sheltered runtime snow must remain more glacial than pure tundra snow');
  assert(lee.toAccumulatedSnow < tundraLee.toAccumulatedSnow,
    'deep far-north lee snow should stay visibly soft while the retention model suppresses only the warmest tint');
  assert(windward.toCoastalIce < lee.toCoastalIce,
    'wind-packed far-north snow should remain the strongest visual bridge toward coastal ice');

  console.log('[checkNorthMountainSnowVisualQa] PASS', JSON.stringify({
    terrainPolicy: report.terrainPolicy,
    snowPolicy: report.snowPolicy,
    samples: report.samples.map(({ label, colorHex, snowAmount, packedWeight, accumulatedWeight, accumulatedGlacialPaletteRetention }) => ({
      label,
      colorHex,
      snowAmount: round(snowAmount),
      packedWeight: round(packedWeight),
      accumulatedWeight: round(accumulatedWeight),
      retention: round(accumulatedGlacialPaletteRetention),
    })),
  }));
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
