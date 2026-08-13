import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const expectedCells = ['G00', 'G07', 'G17', 'G52', 'G65', 'G70', 'G75'];
const policyId = 'live-four-agent-owner-map-terrain-2026-08-13-v1';

const browser = await chromium.launch({ headless: true });
try {
  const editor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await editor.goto(`${baseUrl}/editor.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await editor.waitForFunction((id) => document.body.dataset.liveFourAgentTerrain === id, policyId, { timeout: 30000 });
  const editorProof = await editor.evaluate(async ({ id, cells }) => {
    const api = window.__WESTEROS_WORLD_EDITOR__;
    const ground = api?.scene?.getObjectByName('Editor Ground');
    const summary = api?.scene?.userData?.liveFourAgentTerrainSummary;
    if (!ground?.geometry || !summary) return null;
    const position = ground.geometry.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < position.count; index += 1) {
      minY = Math.min(minY, position.getY(index));
      maxY = Math.max(maxY, position.getY(index));
    }
    const live = await import('/scripts/liveFourAgentTerrain.mjs');
    const centers = [
      ['G00', 1 / 16, 1 / 16], ['G52', 11 / 16, 5 / 16], ['G70', 15 / 16, 1 / 16],
      ['G07', 1 / 16, 15 / 16], ['G17', 3 / 16, 15 / 16], ['G65', 13 / 16, 11 / 16], ['G75', 15 / 16, 11 / 16],
    ];
    const samples = centers.map(([cell, x, y]) => {
      const sample = live.sampleFourAgentAuthoredHeightNormalized(x, y);
      return { cell, sampledCell: sample?.cell, height: sample?.liveHeightMeters, weight: sample?.weight };
    });
    return {
      policyId: summary.policyId,
      touchedVertices: summary.touchedVertices,
      touchedCells: [...summary.touchedCells].sort(),
      vertexCount: position.count,
      minY,
      maxY,
      samples,
      expectedCells: cells,
      bodyPolicy: document.body.dataset.liveFourAgentTerrain,
      scenePolicy: api.scene.userData.liveFourAgentTerrain,
      groundWidth: summary.width,
      groundDepth: summary.depth,
      expectedPolicy: id,
    };
  }, { id: policyId, cells: expectedCells });
  assert.ok(editorProof, 'editor terrain proof missing');
  assert.equal(editorProof.policyId, policyId);
  assert.equal(editorProof.bodyPolicy, policyId);
  assert.equal(editorProof.scenePolicy, policyId);
  assert.deepEqual(editorProof.touchedCells, expectedCells);
  assert.ok(editorProof.touchedVertices > 1000, `too few authored editor vertices: ${editorProof.touchedVertices}`);
  assert.ok(editorProof.vertexCount > 20000, `editor full-map terrain resolution too low: ${editorProof.vertexCount}`);
  assert.ok(editorProof.maxY - editorProof.minY > 20, 'editor terrain remained effectively flat');
  assert.ok(editorProof.groundWidth > 15000 && editorProof.groundDepth > 12000, 'editor terrain does not cover the full owner-map extent');
  for (const sample of editorProof.samples) {
    assert.equal(sample.sampledCell, sample.cell, `${sample.cell} did not use its authored source`);
    assert.ok(Number.isFinite(sample.height), `${sample.cell} height is not finite`);
    assert.ok(sample.weight > 0.99, `${sample.cell} center was unexpectedly feathered`);
  }

  const game = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await game.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await game.waitForFunction((id) => document.body.dataset.liveFourAgentTerrain === id, policyId, { timeout: 30000 });
  const gameProof = await game.evaluate((id) => ({
    bodyPolicy: document.body.dataset.liveFourAgentTerrain,
    canvasPresent: Boolean(document.getElementById('game3d-canvas')),
    gatePresent: Boolean(document.getElementById('run266-entry-gate')),
    expectedPolicy: id,
  }), policyId);
  assert.equal(gameProof.bodyPolicy, policyId);
  assert.equal(gameProof.canvasPresent, true);
  assert.equal(gameProof.gatePresent, true);

  console.log('LIVE_FOUR_AGENT_TERRAIN_PROOF=' + JSON.stringify({ editor: editorProof, game: gameProof }));
  console.log('LIVE_FOUR_AGENT_TERRAIN_OK');
} finally {
  await browser.close();
}
