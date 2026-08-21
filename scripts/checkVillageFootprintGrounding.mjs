#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';

// `world/materials.js` intentionally paints deterministic CanvasTexture maps in the browser. This
// contract only inspects village transforms, not texture pixels, so provide the smallest Canvas 2D
// surface its material factories require instead of making production materials depend on Node.
function createCanvasContext() {
  return {
    fillStyle: '#000000',
    createImageData(width, height) {
      return { width, height, data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {},
    fillRect() {},
  };
}

globalThis.document ??= {
  createElement(tagName) {
    assert.equal(tagName, 'canvas', `unexpected DOM element request in village contract: ${tagName}`);
    const context = createCanvasContext();
    return { width: 1, height: 1, getContext: (kind) => kind === '2d' ? context : null };
  },
};

// Import after the DOM shim is installed: ES module static imports execute before top-level setup.
const [{ createVillages, disposeVillages }, { mulberry32 }] = await Promise.all([
  import('../src/3d/world/villages.js'),
  import('../src/3d/world/terrain.js'),
]);

const terrainHeight = (x, z) => 120 + x * 0.12 - z * 0.08;
const seats = [{ id: 'test-seat', x: 0, z: 0 }];

const result = createVillages({
  sampleHeightMeters: terrainHeight,
  seaLevelMeters: 0,
  seed: 424242,
  seats,
  roadEdges: [],
  radiusMeters: 1000,
  mulberry32,
  housesPerVillage: 6,
});

assert(result.houseCount > 0, 'fixture must place at least one village house');
const bodies = result.group.getObjectByName('village-houses');
assert(bodies?.isInstancedMesh, 'village-houses InstancedMesh must exist');

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const samplePoint = new THREE.Vector3();
let variedFootprints = 0;

for (let i = 0; i < result.houseCount; i += 1) {
  bodies.getMatrixAt(i, matrix);
  matrix.decompose(position, quaternion, scale);

  const hx = scale.x * 0.5;
  const hz = scale.z * 0.5;
  const offsets = [
    [0, 0], [-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz],
    [-hx, 0], [hx, 0], [0, -hz], [0, hz],
  ];

  const heights = offsets.map(([localX, localZ]) => {
    samplePoint.set(localX, 0, localZ).applyQuaternion(quaternion).add(position);
    return terrainHeight(samplePoint.x, samplePoint.z);
  });

  const minGround = Math.min(...heights);
  const maxGround = Math.max(...heights);
  if (maxGround - minGround > 0.1) variedFootprints += 1;

  const foundationBottom = position.y;
  const wallTop = position.y + scale.y;
  for (const ground of heights) {
    assert(
      foundationBottom <= ground + 1e-8,
      `house ${i} floats: foundation bottom ${foundationBottom} above terrain ${ground}`,
    );
  }
  assert(
    wallTop > maxGround,
    `house ${i} wall top ${wallTop} must remain above the highest terrain sample ${maxGround}`,
  );
}

assert(variedFootprints > 0, 'fixture must exercise at least one genuinely sloped footprint');

disposeVillages(result.group);
console.log(`[checkVillageFootprintGrounding] PASS: ${result.houseCount} houses checked across sloped terrain; every foundation reaches the low side and every wall clears the high side.`);
