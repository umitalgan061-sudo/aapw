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
      WORLD_SCALE,
      WORLD_REFERENCE_ALIGNMENT,
    } = window.__northTerrainQaModules ?? {};
    if (!THREE || !terrain || !WORLD_SCALE || !WORLD_REFERENCE_ALIGNMENT) {
      throw new Error('north terrain QA modules did not initialize');
    }

    const {
      TERRAIN_BIOME_PALETTE,
      TERRAIN_BIOME_SHADING_POLICY,
      northClimateWeightsAtWorldZ,
      resolveTerrainBiomeColor,
    } = terrain;

    function worldZForNormalizedMapY(normalizedY) {
      const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
      const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
      return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
    }

    function sampleColor({ normalizedY, height, slope = 3, worldX = 0, rockWeight = 0, snowWeight = 0 }) {
      return resolveTerrainBiomeColor(new THREE.Color(), {
        heightAboveSeaMeters: height,
        slopeDegrees: slope,
        rockWeight,
        snowWeight,
        worldX,
        worldZ: worldZForNormalizedMapY(normalizedY),
      });
    }

    function colorDistance(a, b) {
      return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
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
      { label: 'FAR NORTH', normalizedY: 0.06 },
      { label: 'ICE EDGE', normalizedY: 0.22 },
      { label: 'TUNDRA', normalizedY: 0.33 },
      { label: 'TEMPERATE', normalizedY: 0.55 },
    ]);

    const rowReports = [];
    const cols = 64;
    const rows = 42;
    const width = 58;
    const depth = 74;
    const rowSpacing = 67;

    for (let rowIndex = 0; rowIndex < climates.length; rowIndex += 1) {
      const climateSpec = climates[rowIndex];
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
          worldX: localX * 35 + rowIndex * 770,
          worldZ: worldZForNormalizedMapY(climateSpec.normalizedY),
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

      const climate = northClimateWeightsAtWorldZ(worldZForNormalizedMapY(climateSpec.normalizedY));
      const shore = sampleColor({ normalizedY: climateSpec.normalizedY, height: 0.5, worldX: 120 });
      const lowland = sampleColor({ normalizedY: climateSpec.normalizedY, height: 18, worldX: 120 });
      const seabed = sampleColor({ normalizedY: climateSpec.normalizedY, height: -1.5, worldX: 120 });
      rowReports.push({
        ...climateSpec,
        permanentIce: climate.permanentIce,
        tundra: climate.tundra,
        minHeight,
        maxHeight,
        shoreHex: `#${shore.getHexString()}`,
        lowlandHex: `#${lowland.getHexString()}`,
        seabedHex: `#${seabed.getHexString()}`,
        shoreToSand: colorDistance(shore, TERRAIN_BIOME_PALETTE.SHORE_SAND),
        shoreToFrozen: colorDistance(shore, TERRAIN_BIOME_PALETTE.FROZEN_SHORE),
        shoreToGlacial: colorDistance(shore, TERRAIN_BIOME_PALETTE.GLACIAL_SHORE),
      });
    }

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
      ...rowReports.map((row) => `${row.label}: ice=${row.permanentIce.toFixed(2)} tundra=${row.tundra.toFixed(2)} shore=${row.shoreHex}`),
    ].join('\n');

    renderer.render(scene, camera);
    return {
      policy: TERRAIN_BIOME_SHADING_POLICY.id,
      rows: rowReports,
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      canvas: { width: renderer.domElement.width, height: renderer.domElement.height },
    };
  }, { viewport: VIEWPORT });

  await page.screenshot({ path: `${ARTIFACT_DIR}/north-terrain-climate-strips.png`, fullPage: true });
  const normalized = {
    ...report,
    rows: report.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value]))),
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

  console.log('[checkNorthTerrainVisualQa] PASS', JSON.stringify({
    policy: report.policy,
    renderCalls: report.renderCalls,
    triangles: report.triangles,
    shores: report.rows.map(({ label, shoreHex }) => [label, shoreHex]),
  }));
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
