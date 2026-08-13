import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const expectedCells = ['G00', 'G07', 'G17', 'G52', 'G65', 'G70', 'G75'];
const policyId = 'live-four-agent-owner-map-terrain-2026-08-13-v3';
const centers = [
  ['G00', 1 / 16, 1 / 16], ['G52', 11 / 16, 5 / 16], ['G70', 15 / 16, 1 / 16],
  ['G07', 1 / 16, 15 / 16], ['G17', 3 / 16, 15 / 16], ['G65', 13 / 16, 11 / 16], ['G75', 15 / 16, 11 / 16],
];

const browser = await chromium.launch({ headless: true });
try {
  const editor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await editor.goto(`${baseUrl}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await editor.waitForFunction((id) => document.body.dataset.liveFourAgentTerrain === id, policyId, { timeout: 30000 });
  const editorProof = await editor.evaluate(async ({ id, expected, cellCenters }) => {
    const api = window.__WESTEROS_WORLD_EDITOR__;
    const ground = api?.scene?.getObjectByName('Editor Ground');
    const summary = api?.scene?.userData?.liveFourAgentTerrainSummary;
    if (!ground?.geometry || !summary) return null;
    const position = ground.geometry.getAttribute('position');
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < position.count; i += 1) { minY = Math.min(minY, position.getY(i)); maxY = Math.max(maxY, position.getY(i)); }
    const live = await import('/scripts/liveFourAgentTerrain.mjs');
    const g65Grid = await import('/scripts/runtime/g65Terrain3dRuntimeGrid.mjs');
    const samples = cellCenters.map(([cell, x, y]) => {
      const sample = live.sampleFourAgentAuthoredHeightNormalized(x, y);
      return { cell, sampledCell: sample?.cell, layer: sample?.layer, relativeHeight: sample?.relativeHeightMeters, height: sample?.liveHeightMeters, weight: sample?.weight };
    });
    const g65 = samples.find((sample) => sample.cell === 'G65');
    const directG65 = g65Grid.sampleG65Terrain3dRuntimeGridNormalized(13 / 16, 11 / 16);
    return {
      policyId: summary.policyId,
      touchedVertices: summary.touchedVertices,
      touchedCells: [...summary.touchedCells].sort(),
      vertexCount: position.count,
      minY, maxY, samples,
      g65ArtifactId: g65Grid.G65_TERRAIN3D_RUNTIME_GRID.artifactId,
      g65DirectHeight: directG65?.height,
      g65LiveRelativeHeight: g65?.relativeHeight,
      groundWidth: summary.width, groundDepth: summary.depth,
      bodyPolicy: document.body.dataset.liveFourAgentTerrain,
      scenePolicy: api.scene.userData.liveFourAgentTerrain,
      expectedPolicy: id, expectedCells: expected,
    };
  }, { id: policyId, expected: expectedCells, cellCenters: centers });
  assert.ok(editorProof, 'editor terrain proof missing');
  assert.equal(editorProof.policyId, policyId);
  assert.equal(editorProof.bodyPolicy, policyId);
  assert.equal(editorProof.scenePolicy, policyId);
  assert.deepEqual(editorProof.touchedCells, expectedCells);
  assert.ok(editorProof.touchedVertices > 1000, `too few authored editor vertices: ${editorProof.touchedVertices}`);
  assert.ok(editorProof.vertexCount > 20000, `editor full-map terrain resolution too low: ${editorProof.vertexCount}`);
  assert.ok(editorProof.maxY - editorProof.minY > 20, 'editor terrain remained effectively flat');
  assert.ok(editorProof.groundWidth > 15000 && editorProof.groundDepth > 12000, 'editor ground does not cover the owner map');
  for (const sample of editorProof.samples) {
    assert.equal(sample.sampledCell, sample.cell, `${sample.cell} did not use its authored source`);
    assert.ok(Number.isFinite(sample.height), `${sample.cell} height is not finite`);
    assert.ok(sample.weight > 0.99, `${sample.cell} center was unexpectedly feathered`);
  }
  assert.equal(editorProof.samples.find((sample) => sample.cell === 'G65')?.layer, 'Terrain3D runtime grid');
  assert.equal(editorProof.g65ArtifactId, 9180429652);
  assert.ok(Math.abs(editorProof.g65DirectHeight - editorProof.g65LiveRelativeHeight) <= 1e-9, 'G65 live height did not come from Terrain3D runtime grid');

  const game = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await game.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await game.waitForFunction((id) => document.body.dataset.liveFourAgentTerrain === id, policyId, { timeout: 30000 });
  const gameProof = await game.evaluate(async ({ id, cellCenters }) => {
    const THREE = await import('three');
    const { ChunkManager } = await import('/src/3d/world/chunkManager.js');
    const { CHUNK_CONFIG, WORLD_DEFAULTS } = await import('/src/3d/config.js');
    const live = await import('/scripts/liveFourAgentTerrain.mjs');
    const manager = new ChunkManager({ scene: new THREE.Scene(), chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS, seed: WORLD_DEFAULTS.WORLD_SEED });
    const meshes = cellCenters.map(([cell, nx, ny]) => {
      const world = live.ownerMapNormalizedToLiveWorld(nx, ny);
      const cx = Math.round(world.x / CHUNK_CONFIG.CHUNK_SIZE_METERS);
      const cz = Math.round(world.z / CHUNK_CONFIG.CHUNK_SIZE_METERS);
      const mesh = manager.loadChunk(cx, cz);
      const summary = mesh.userData.liveFourAgentTerrainSummary;
      return { cell, chunk: [cx, cz], touchedCells: summary?.touchedCells ?? [], touchedVertices: summary?.touchedVertices ?? 0, maxDelta: summary?.maxHeightDeltaMeters ?? 0 };
    });
    manager.disposeAll();
    return { bodyPolicy: document.body.dataset.liveFourAgentTerrain, canvasPresent: Boolean(document.getElementById('game3d-canvas')), gatePresent: Boolean(document.getElementById('run266-entry-gate')), meshes, expectedPolicy: id };
  }, { id: policyId, cellCenters: centers });
  assert.equal(gameProof.bodyPolicy, policyId);
  assert.equal(gameProof.canvasPresent, true);
  assert.equal(gameProof.gatePresent, true);
  for (const mesh of gameProof.meshes) {
    assert.ok(mesh.touchedCells.includes(mesh.cell), `${mesh.cell} was not adopted by the real ChunkManager mesh path`);
    assert.ok(mesh.touchedVertices > 100, `${mesh.cell} touched too few chunk vertices: ${mesh.touchedVertices}`);
    assert.ok(mesh.maxDelta > 0.01, `${mesh.cell} mesh did not measurably change`);
  }

  console.log('LIVE_FOUR_AGENT_TERRAIN_PROOF=' + JSON.stringify({ editor: editorProof, game: gameProof }));
  console.log('LIVE_FOUR_AGENT_TERRAIN_OK');
} finally {
  await browser.close();
}
