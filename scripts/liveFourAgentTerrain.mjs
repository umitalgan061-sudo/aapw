/**
 * Live browser adoption of the latest merged/authored terrain surfaces from the four corner agents.
 *
 * This is an integration layer, not a second authoring system. Every authored height is sampled from
 * the existing owner-map-space functions (or the qualified G07 Terrain3D runtime bake). GeoCell
 * bounds only decide which current source is available; a two-owner-map-pixel feather prevents a
 * hard square edge where an authored cell meets terrain that has not reached that layer yet.
 */
import * as THREE from 'three';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { ChunkManager } from '../src/3d/world/chunkManager.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import { classifyReferenceBaseSurface } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { sampleG07Terrain3dBakeNormalized } from '../src/3d/world/g07Terrain3dBake.js';
import { sampleG00ReliefHeight } from '../godot/terrain-authoring/geocells/nw/g00_relief.mjs';
import { sampleG52RockSnow } from '../godot/terrain-authoring/geocells/ne/g52_rock_snow.mjs';
import { sampleG70Hydrology } from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';
import { sampleG17SeabedHeight } from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';
import { sampleG65ReliefHeight } from '../godot/terrain-authoring/geocells/se/g65_relief.mjs';
import { sampleG75ReliefHeight } from '../godot/terrain-authoring/geocells/se/g75_relief.mjs';

const MAP_WIDTH = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
const MAP_HEIGHT = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
const SOURCE_PIXEL_WIDTH = 1536;
const SOURCE_PIXEL_HEIGHT = 1024;
const EDGE_FEATHER_SOURCE_PIXELS = 2;
const SEA_LEVEL = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep01 = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };

export const LIVE_FOUR_AGENT_TERRAIN_POLICY = Object.freeze({
  id: 'live-four-agent-owner-map-terrain-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  edgeFeatherSourcePixels: EDGE_FEATHER_SOURCE_PIXELS,
  agents: Object.freeze({
    'Buzul Muhafızı': Object.freeze(['G00']),
    'Şafak Kartalı': Object.freeze(['G52', 'G70']),
    'Günbatımı Ustası': Object.freeze(['G07', 'G17']),
    'Kızıl Ufuk': Object.freeze(['G65', 'G75']),
  }),
});

const CELLS = Object.freeze([
  Object.freeze({ id: 'G00', agent: 'Buzul Muhafızı', x0: 0, x1: 1 / 8, y0: 0, y1: 1 / 8, sample: (x, y) => sampleG00ReliefHeight(x, y) }),
  Object.freeze({ id: 'G52', agent: 'Şafak Kartalı', x0: 5 / 8, x1: 6 / 8, y0: 2 / 8, y1: 3 / 8, sample: (x, y) => sampleG52RockSnow(x, y).heightMeters }),
  Object.freeze({ id: 'G70', agent: 'Şafak Kartalı', x0: 7 / 8, x1: 1, y0: 0, y1: 1 / 8, sample: (x, y) => sampleG70Hydrology(x, y).heightMeters }),
  Object.freeze({ id: 'G07', agent: 'Günbatımı Ustası', x0: 0, x1: 1 / 8, y0: 7 / 8, y1: 1, sample: (x, y) => sampleG07Terrain3dBakeNormalized(x, y)?.height ?? null }),
  Object.freeze({ id: 'G17', agent: 'Günbatımı Ustası', x0: 1 / 8, x1: 2 / 8, y0: 7 / 8, y1: 1, sample: (x, y) => sampleG17SeabedHeight(x, y).height }),
  Object.freeze({ id: 'G65', agent: 'Kızıl Ufuk', x0: 6 / 8, x1: 7 / 8, y0: 5 / 8, y1: 6 / 8, sample: (x, y) => sampleG65ReliefHeight(x, y) }),
  Object.freeze({ id: 'G75', agent: 'Kızıl Ufuk', x0: 7 / 8, x1: 1, y0: 5 / 8, y1: 6 / 8, sample: (x, y) => sampleG75ReliefHeight(x, y) }),
]);

function currentMapCenter() {
  return Object.freeze({
    x: (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5,
    y: (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5,
  });
}

export function liveWorldToOwnerMap(worldX, worldZ) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new TypeError('world coordinates must be finite');
  const center = currentMapCenter();
  const mapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + center.x;
  const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + center.y;
  if (mapX < 0 || mapX > MAP_WIDTH || mapY < 0 || mapY > MAP_HEIGHT) return null;
  return Object.freeze({ mapX, mapY, normalizedX: mapX / MAP_WIDTH, normalizedY: mapY / MAP_HEIGHT });
}

function cellEdgeWeight(cell, normalizedX, normalizedY) {
  const dx = Math.min(normalizedX - cell.x0, cell.x1 - normalizedX) * SOURCE_PIXEL_WIDTH;
  const dy = Math.min(normalizedY - cell.y0, cell.y1 - normalizedY) * SOURCE_PIXEL_HEIGHT;
  return smoothstep01(Math.min(dx, dy) / EDGE_FEATHER_SOURCE_PIXELS);
}

export function sampleFourAgentAuthoredHeightNormalized(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  for (const cell of CELLS) {
    if (normalizedX < cell.x0 || normalizedX > cell.x1 || normalizedY < cell.y0 || normalizedY > cell.y1) continue;
    const relativeHeightMeters = cell.sample(normalizedX, normalizedY);
    if (!Number.isFinite(relativeHeightMeters)) return null;
    return Object.freeze({
      cell: cell.id,
      agent: cell.agent,
      relativeHeightMeters,
      liveHeightMeters: SEA_LEVEL + relativeHeightMeters,
      weight: cellEdgeWeight(cell, normalizedX, normalizedY),
    });
  }
  return null;
}

export function sampleLiveFourAgentHeight(worldX, worldZ, fallbackHeightMeters) {
  if (!Number.isFinite(fallbackHeightMeters)) throw new TypeError('fallback height must be finite');
  const map = liveWorldToOwnerMap(worldX, worldZ);
  if (!map) return Object.freeze({ heightMeters: fallbackHeightMeters, authored: null });
  const authored = sampleFourAgentAuthoredHeightNormalized(map.normalizedX, map.normalizedY);
  if (!authored) return Object.freeze({ heightMeters: fallbackHeightMeters, authored: null });
  const heightMeters = fallbackHeightMeters + (authored.liveHeightMeters - fallbackHeightMeters) * authored.weight;
  return Object.freeze({ heightMeters, authored });
}

export function applyLiveFourAgentHeightToMesh(mesh) {
  if (!mesh?.geometry?.getAttribute || !mesh?.position) throw new TypeError('terrain mesh is required');
  if (mesh.userData?.liveFourAgentTerrain === LIVE_FOUR_AGENT_TERRAIN_POLICY.id) return mesh.userData.liveFourAgentTerrainSummary;
  const position = mesh.geometry.getAttribute('position');
  if (!position) throw new TypeError('terrain mesh position attribute missing');
  const touchedCells = new Set();
  let touchedVertices = 0;
  let maxHeightDeltaMeters = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    const before = position.getY(index);
    const sampled = sampleLiveFourAgentHeight(worldX, worldZ, before);
    if (!sampled.authored || sampled.authored.weight <= 0) continue;
    position.setY(index, sampled.heightMeters);
    touchedVertices += 1;
    touchedCells.add(sampled.authored.cell);
    maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, Math.abs(sampled.heightMeters - before));
  }
  if (touchedVertices > 0) {
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  const summary = Object.freeze({
    policyId: LIVE_FOUR_AGENT_TERRAIN_POLICY.id,
    touchedVertices,
    touchedCells: Object.freeze([...touchedCells].sort()),
    maxHeightDeltaMeters,
  });
  mesh.userData.liveFourAgentTerrain = LIVE_FOUR_AGENT_TERRAIN_POLICY.id;
  mesh.userData.liveFourAgentTerrainSummary = summary;
  return summary;
}

const GAME_INSTALL = Symbol.for('westeros.live-four-agent-terrain.game.v1');
export function installLiveFourAgentGameTerrain() {
  const prototype = ChunkManager.prototype;
  if (prototype[GAME_INSTALL]) return prototype[GAME_INSTALL];
  const priorLoadChunk = prototype.loadChunk;
  prototype.loadChunk = function loadChunkWithFourAgentTerrain(chunkX, chunkZ) {
    const mesh = priorLoadChunk.call(this, chunkX, chunkZ);
    applyLiveFourAgentHeightToMesh(mesh);
    return mesh;
  };
  for (const manager of []) void manager;
  const installation = Object.freeze({ installed: true, policyId: LIVE_FOUR_AGENT_TERRAIN_POLICY.id });
  Object.defineProperty(prototype, GAME_INSTALL, { value: installation, configurable: false });
  if (document?.body) document.body.dataset.liveFourAgentTerrain = LIVE_FOUR_AGENT_TERRAIN_POLICY.id;
  return installation;
}

const EDITOR_COLORS = Object.freeze({ sea: 0x294d5d, lake: 0x4f7f86, soil: 0x718153, rock: 0x746d64, snow: 0xd9e2df });
export function installLiveFourAgentEditorTerrain(api = window.__WESTEROS_WORLD_EDITOR__) {
  if (!api?.scene || !api?.camera || !api?.orbitControls) throw new Error('World Editor API is not ready');
  if (api.scene.userData.liveFourAgentTerrain === LIVE_FOUR_AGENT_TERRAIN_POLICY.id) return api.scene.userData.liveFourAgentTerrainSummary;
  const ground = api.scene.getObjectByName('Editor Ground');
  if (!ground?.isMesh) throw new Error('Editor Ground mesh was not found');
  const width = MAP_WIDTH * WORLD_SCALE.METERS_PER_MAP_UNIT;
  const depth = MAP_HEIGHT * WORLD_SCALE.METERS_PER_MAP_UNIT;
  const center = currentMapCenter();
  const mapCenterWorldX = (MAP_WIDTH * 0.5 - center.x) * WORLD_SCALE.METERS_PER_MAP_UNIT;
  const mapCenterWorldZ = (MAP_HEIGHT * 0.5 - center.y) * WORLD_SCALE.METERS_PER_MAP_UNIT;
  const geometry = new THREE.PlaneGeometry(width, depth, 192, 128);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const natural = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
  const color = new THREE.Color();
  const touchedCells = new Set();
  let touchedVertices = 0;
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mapCenterWorldX + position.getX(index);
    const worldZ = mapCenterWorldZ + position.getZ(index);
    const sampled = sampleLiveFourAgentHeight(worldX, worldZ, natural(worldX, worldZ));
    position.setY(index, sampled.heightMeters);
    if (sampled.authored?.weight > 0) { touchedVertices += 1; touchedCells.add(sampled.authored.cell); }
    const map = liveWorldToOwnerMap(worldX, worldZ);
    const surface = map ? classifyReferenceBaseSurface(map.normalizedX, map.normalizedY) : 'soil';
    color.setHex(EDITOR_COLORS[surface] ?? EDITOR_COLORS.soil);
    colors[index * 3] = color.r; colors[index * 3 + 1] = color.g; colors[index * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  ground.geometry.dispose();
  ground.geometry = geometry;
  ground.position.set(mapCenterWorldX, 0, mapCenterWorldZ);
  ground.material.vertexColors = true;
  ground.material.color.setHex(0xffffff);
  ground.material.roughness = 0.96;
  ground.material.needsUpdate = true;
  api.camera.far = Math.max(api.camera.far, 25000);
  api.camera.updateProjectionMatrix();
  api.orbitControls.maxDistance = Math.max(api.orbitControls.maxDistance, 18000);
  const summary = Object.freeze({ policyId: LIVE_FOUR_AGENT_TERRAIN_POLICY.id, touchedVertices, touchedCells: Object.freeze([...touchedCells].sort()), width, depth });
  api.scene.userData.liveFourAgentTerrain = LIVE_FOUR_AGENT_TERRAIN_POLICY.id;
  api.scene.userData.liveFourAgentTerrainSummary = summary;
  if (document?.body) document.body.dataset.liveFourAgentTerrain = LIVE_FOUR_AGENT_TERRAIN_POLICY.id;
  window.__WESTEROS_LIVE_FOUR_AGENT_TERRAIN__ = Object.freeze({ policy: LIVE_FOUR_AGENT_TERRAIN_POLICY, editor: summary });
  return summary;
}
