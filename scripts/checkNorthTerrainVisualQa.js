#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkNorthTerrainVisualQa] Playwright unavailable; install playwright@1.55.0 first.');
  process.exit(2);
}

const ARTIFACT_DIR = 'artifacts/north-terrain-visual-qa';
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
  await page.goto(`${server.baseUrl}/north-terrain-visual-qa.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => Boolean(window.__northTerrainQaModules || window.__northTerrainQaBootstrapError),
    null,
    { timeout: 10000 },
  );
  const bootstrapError = await page.evaluate(() => window.__northTerrainQaBootstrapError ?? null);
  if (bootstrapError) throw new Error(`north terrain browser module bootstrap failed: ${bootstrapError}`);

  const report = await page.evaluate(({ viewport }) => {
    const {
      THREE,
      terrain,
      snowTone,
      WORLD_SCALE,
      WORLD_REFERENCE_ALIGNMENT,
    } = window.__northTerrainQaModules ?? {};
    if (!THREE || !terrain || !snowTone || !WORLD_SCALE || !WORLD_REFERENCE_ALIGNMENT) {
      throw new Error('north terrain QA modules did not initialize');
    }

    const {
      TERRAIN_BIOME_PALETTE,
      TERRAIN_BIOME_SHADING_POLICY,
      northClimateWeightsAtWorldXZ,
      resolveTerrainBiomeColor,
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

    function sampleColor({ normalizedX, normalizedY, height, slope = 3, rockWeight = 0, snowWeight = 0 }) {
      const world = worldAt(normalizedX, normalizedY);
      return resolveTerrainBiomeColor(new THREE.Color(), {
        heightAboveSeaMeters: height,
        slopeDegrees: slope,
        rockWeight,
        snowWeight,
        worldX: world.x,
        worldZ: world.z,
      });
    }

    function colorDistance(a, b) {
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    }

    function surfaceToneReport({
      snowAmount,
      permanentIce,
      tundra,
      windwardScour = 0,
      leeDeposit = 0,
      ridgeExposure = 0,
      concavityHold = 0,
      gentleSlope = 0,
    }) {
      const tone = resolveTerrainSnowSurfaceTone({
        snowAmount,
        permanentIce,
        tundra,
        windwardScour,
        leeDeposit,
        ridgeExposure,
        concavityHold,
        gentleSlope,
      });
      const color = new THREE.Color().copy(TERRAIN_BIOME_PALETTE.SNOW);
      if (tone.packedWeight > 0) color.lerp(TERRAIN_BIOME_PALETTE.PACKED_SNOW, tone.packedWeight);
      if (tone.accumulatedWeight > 0) color.lerp(TERRAIN_BIOME_PALETTE.ACCUMULATED_SNOW, tone.accumulatedWeight);
      return {
        colorHex: `#${color.getHexString()}`,
        packedWeight: tone.packedWeight,
        accumulatedWeight: tone.accumulatedWeight,
        accumulatedGlacialPaletteRetention: tone.accumulatedGlacialPaletteRetention,
        glacialFamilySupport: tone.glacialFamilySupport,
        toGlacialIce: colorDistance(color, TERRAIN_BIOME_PALETTE.GLACIAL_ICE),
        toCoastalIce: colorDistance(color, TERRAIN_BIOME_PALETTE.COASTAL_ICE),
      };
    }

    const root = document.getElementById('qa-root');
    const panel = document.getElementById('qa-panel');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    renderer.shadowMap.enabled = true;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    root.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9c4cc);
    scene.fog = new THREE.Fog(0xb9c4cc, 170, 390);
    const camera = new THREE.PerspectiveCamera(28, viewport.width / viewport.height, 0.1, 800);
    camera.position.set(0, 102, 182);
    camera.lookAt(0, 2, -20);

    const hemi = new THREE.HemisphereLight(0xdce8f1, 0x4f554f, 1.65);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff3d9, 2.1);
    key.position.set(120, 180, 90);
    key.castShadow = true;
    scene.add(key);

    const climates = Object.freeze([
      { label: 'FAR NORTH', normalizedX: 0.145, normalizedY: 0.115 },
      { label: 'ICE EDGE', normalizedX: 0.155, normalizedY: 0.20 },
      { label: 'TUNDRA', normalizedX: 0.175, normalizedY: 0.30 },
      { label: 'TEMPERATE', normalizedX: 0.22, normalizedY: 0.55 },
    ]);

    const rowReports = [];
    const cols = 64;
    const rows = 42;
    const width = 58;
    const depth = 74;
    const rowSpacing = 67;

    for (let rowIndex = 0; rowIndex < climates.length; rowIndex += 1) {
      const climateSpec = climates[rowIndex];
      const anchorWorld = worldAt(climateSpec.normalizedX, climateSpec.normalizedY);
      const geometry = new THREE.PlaneGeometry(width, depth, cols, rows);
      geometry.rotateX(-Math.PI / 2);
      const position = geometry.attributes.position;
      const colors = new Float32Array(position.count * 3);
      const color = new THREE.Color();
      let minHeight = Infinity;
      let maxHeight = -Infinity;

      for (let i = 0; i < position.count; i += 1) {
        const localX = position.getX(i);
        const localZ = position.getZ(i);
        const t = (localZ + depth * 0.5) / depth;
        let height = -2.3 + t * 10.5;
        height += Math.sin(localX * 0.20) * 0.34 + Math.sin(localX * 0.053 + localZ * 0.08) * 0.28;
        if (t > 0.68) height += ((t - 0.68) / 0.32) ** 2 * 20;
        const slope = t > 0.77 ? 34 + (t - 0.77) * 65 : 2 + Math.abs(Math.cos(localX * 0.14)) * 5;
        const rockWeight = t > 0.84 ? Math.min(1, (t - 0.84) / 0.12) : 0;
        position.setY(i, height);
        resolveTerrainBiomeColor(color, {
          heightAboveSeaMeters: height,
          slopeDegrees: slope,
          rockWeight,
          snowWeight: 0,
          worldX: anchorWorld.x + localX * 2,
          worldZ: anchorWorld.z + localZ * 2,
        });
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
      }
      position.needsUpdate = true;
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = (rowIndex - 1.5) * rowSpacing;
      mesh.position.z = -18;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);

      const climate = northClimateWeightsAtWorldXZ(anchorWorld.x, anchorWorld.z);
      const shore = sampleColor({ ...climateSpec, height: 0.5 });
      const lowland = sampleColor({ ...climateSpec, height: 18 });
      const seabed = sampleColor({ ...climateSpec, height: -1.5 });
      rowReports.push({
        ...climateSpec,
        permanentIce: climate.permanentIce,
        tundra: climate.tundra,
        minHeight,
        maxHeight,
        shoreHex: `#${shore.getHexString()}`,
        lowlandHex: `#${lowland.getHexString()}`,
        seabedHex: `#${seabed.getHexString()}`,
        shoreToLowland: colorDistance(shore, lowland),
        shoreToSand: colorDistance(shore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
        shoreToFrozen: colorDistance(shore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
        shoreToGlacial: colorDistance(shore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE),
      });
    }

    const farNorthClimate = rowReports[0];
    const iceEdgeClimate = rowReports[1];
    const tundraClimate = rowReports[2];
    const snowHarmony = {
      policy: TERRAIN_SNOW_SURFACE_TONE_POLICY.id,
      farNorthWindward: surfaceToneReport({
        snowAmount: 0.84,
        permanentIce: farNorthClimate.permanentIce,
        tundra: farNorthClimate.tundra,
        windwardScour: 0.92,
        ridgeExposure: 0.88,
        gentleSlope: 0.2,
      }),
      farNorthSheltered: surfaceToneReport({
        snowAmount: 0.94,
        permanentIce: farNorthClimate.permanentIce,
        tundra: farNorthClimate.tundra,
        leeDeposit: 0.88,
        concavityHold: 0.82,
        gentleSlope: 0.9,
      }),
      iceEdgeSheltered: surfaceToneReport({
        snowAmount: 0.94,
        permanentIce: iceEdgeClimate.permanentIce,
        tundra: iceEdgeClimate.tundra,
        leeDeposit: 0.88,
        concavityHold: 0.82,
        gentleSlope: 0.9,
      }),
      tundraSheltered: surfaceToneReport({
        snowAmount: 0.94,
        permanentIce: tundraClimate.permanentIce,
        tundra: tundraClimate.tundra,
        leeDeposit: 0.88,
        concavityHold: 0.82,
        gentleSlope: 0.9,
      }),
    };

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(310, 34),
      new THREE.MeshPhysicalMaterial({
        color: 0x7897a8,
        transparent: true,
        opacity: 0.68,
        roughness: 0.24,
        metalness: 0,
        depthWrite: false,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.08, 18);
    scene.add(water);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 250),
      new THREE.MeshStandardMaterial({ color: 0x5d665e, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.7;
    floor.receiveShadow = true;
    scene.add(floor);

    panel.textContent = [
      `NORTH TERRAIN VISUAL QA · ${TERRAIN_BIOME_SHADING_POLICY.id}`,
      'Each strip uses live resolveTerrainBiomeColor()',
      'foreground = shallow sea/shore · rear = lowland/ridge',
      ...rowReports.map((row) => `${row.label}: ice=${row.permanentIce.toFixed(2)} tundra=${row.tundra.toFixed(2)} shore=${row.shoreHex} lowland=${row.lowlandHex}`),
      `SNOW: windward=${snowHarmony.farNorthWindward.colorHex} sheltered=${snowHarmony.farNorthSheltered.colorHex}`,
    ].join('\n');

    renderer.render(scene, camera);
    return {
      policy: TERRAIN_BIOME_SHADING_POLICY.id,
      rows: rowReports,
      snowHarmony,
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
    };
  }, { viewport: VIEWPORT });

  await page.screenshot({ path: `${ARTIFACT_DIR}/north-terrain-climate-strips.png`, fullPage: true });
  const normalized = {
    ...report,
    rows: report.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]))),
    snowHarmony: Object.fromEntries(Object.entries(report.snowHarmony).map(([key, value]) => [
      key,
      typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([metric, metricValue]) => [metric, typeof metricValue === 'number' ? round(metricValue) : metricValue]))
        : value,
    ])),
    browserErrors,
  };
  await writeFile(`${ARTIFACT_DIR}/north-terrain-visual-report.json`, `${JSON.stringify(normalized, null, 2)}\n`);

  assert.match(report.policy, /shoreline|climate|snowline/, 'visual QA must exercise the current geographic terrain policy');
  assert.equal(report.rows.length, 4, 'visual proof must include four climate strips');
  assert(report.renderCalls >= 5 && report.triangles > 10000, 'visual proof must render real subdivided WebGL terrain geometry');
  assert.deepEqual(browserErrors, [], `north terrain browser QA emitted errors: ${browserErrors.join(' | ')}`);

  const [farNorth, iceEdge, tundra, temperate] = report.rows;
  assert(farNorth.permanentIce > 0.95, 'far-north visual strip must be permanent ice');
  assert(iceEdge.permanentIce > 0 && iceEdge.permanentIce < 1, 'ice-edge visual strip must sample transition climate');
  assert(tundra.permanentIce === 0 && tundra.tundra > 0, 'tundra visual strip must be outside permanent ice');
  assert(temperate.permanentIce === 0 && temperate.tundra === 0, 'temperate visual strip must be outside north climate');
  assert(farNorth.shoreToGlacial < farNorth.shoreToSand, 'far-north rendered shore must be closer to glacial than sand');
  assert(tundra.shoreToFrozen < tundra.shoreToSand, 'tundra rendered shore must be closer to frozen than sand');
  assert(temperate.shoreToSand < temperate.shoreToFrozen, 'temperate rendered shore must remain closer to sand');
  assert(iceEdge.shoreToLowland < 0.17,
    `ICE EDGE lowland must stay visually connected to its glacial shore; distance=${iceEdge.shoreToLowland}`);
  assert(iceEdge.shoreToLowland > 0.025,
    'ICE EDGE shore and lowland must keep enough contrast to remain readable');

  const { farNorthWindward, farNorthSheltered, iceEdgeSheltered, tundraSheltered } = report.snowHarmony;
  assert(farNorthWindward.packedWeight > farNorthSheltered.packedWeight,
    'windward far-north ridge snow must remain harder/packed than sheltered accumulation');
  assert(farNorthWindward.toGlacialIce < 0.04,
    'windward packed snow must remain tightly inside the glacial-ice colour family');
  assert(farNorthSheltered.accumulatedWeight > 0.12,
    'far-north sheltered snow must retain a visible accumulated/soft component');
  assert(farNorthSheltered.accumulatedWeight < tundraSheltered.accumulatedWeight,
    'far-north sheltered snow must be less warm-tinted than equivalent tundra accumulation');
  assert(farNorthSheltered.accumulatedGlacialPaletteRetention < iceEdgeSheltered.accumulatedGlacialPaletteRetention,
    'glacial accumulated palette retention should strengthen from ICE EDGE into permanent ice');
  assert(iceEdgeSheltered.accumulatedGlacialPaletteRetention < tundraSheltered.accumulatedGlacialPaletteRetention,
    'ICE EDGE accumulated snow should sit between tundra and full permanent ice palette retention');
  assert.equal(tundraSheltered.accumulatedGlacialPaletteRetention, 1,
    'pure tundra accumulated snow must keep its original soft palette');
  assert(farNorthSheltered.toGlacialIce < iceEdgeSheltered.toGlacialIce,
    'far-north sheltered snow should stay closer to glacial ice than ICE EDGE sheltered snow');
  assert(iceEdgeSheltered.toGlacialIce < tundraSheltered.toGlacialIce,
    'ICE EDGE sheltered snow should stay closer to glacial ice than pure tundra accumulation');

  console.log('[checkNorthTerrainVisualQa] PASS', JSON.stringify({
    policy: report.policy,
    snowPolicy: report.snowHarmony.policy,
    renderCalls: report.renderCalls,
    triangles: report.triangles,
    rows: report.rows.map(({ label, shoreHex, lowlandHex, shoreToLowland }) => [label, shoreHex, lowlandHex, round(shoreToLowland)]),
    snow: {
      windward: farNorthWindward.colorHex,
      sheltered: farNorthSheltered.colorHex,
      iceEdgeSheltered: iceEdgeSheltered.colorHex,
      tundraSheltered: tundraSheltered.colorHex,
    },
  }));
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
