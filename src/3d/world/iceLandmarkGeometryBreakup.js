import * as THREE from 'three';

/**
 * Render-only glacial surface and silhouette naturalisation for The Wall and its ice cave.
 * The owner landmark path, portal anchor, canonical terrain and map alignment are never changed.
 * This module only deforms/augments the already-created landmark meshes in deterministic world space.
 */

function hash2D(x, y, seed) {
  let value = Math.imul((x | 0) ^ seed, 0x27d4eb2d)
    ^ Math.imul((y | 0) + seed, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 0x100000000;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function smoothNoise2D(x, z, scale, seed) {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const ux = tx * tx * (3 - 2 * tx);
  const uz = tz * tz * (3 - 2 * tz);
  const a = hash2D(ix, iz, seed);
  const b = hash2D(ix + 1, iz, seed);
  const c = hash2D(ix, iz + 1, seed);
  const d = hash2D(ix + 1, iz + 1, seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uz);
}

function smoothSignedNoise2D(x, z, scale, seed) {
  return smoothNoise2D(x, z, scale, seed) * 2 - 1;
}

function refreshGeometry(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position) return false;
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return true;
}

function createFacetedSlabGeometry(contour, { frontDepth = 0.24, backDepth = -0.14, frontCrown = 0.34 } = {}) {
  const count = contour.length;
  const positions = [];
  const indices = [];
  for (const [x, y] of contour) positions.push(x, y, frontDepth);
  for (const [x, y] of contour) positions.push(x, y, backDepth);
  const frontCenter = positions.length / 3;
  positions.push(0, 0, frontCrown);
  const backCenter = positions.length / 3;
  positions.push(0, 0, backDepth * 0.92);
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(frontCenter, index, next);
    indices.push(backCenter, count + next, count + index);
    indices.push(index, count + index, count + next, index, count + next, next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createEmbeddedFracturePlateGeometry() {
  return createFacetedSlabGeometry([
    [-0.88, -0.60], [-0.38, -1.00], [0.32, -0.91], [0.91, -0.34],
    [0.76, 0.48], [0.18, 1.00], [-0.56, 0.78], [-1.00, 0.06],
  ], { frontDepth: 0.20, backDepth: -0.16, frontCrown: 0.30 });
}

function createEmbeddedFlowRibGeometry() {
  return createFacetedSlabGeometry([
    [-0.42, -1.00], [0.36, -0.94], [0.55, -0.30], [0.38, 0.34],
    [0.12, 1.00], [-0.30, 0.66], [-0.52, 0.02],
  ], { frontDepth: 0.13, backDepth: -0.10, frontCrown: 0.19 });
}

function createGlacialRubbleGeometry(seed = 0) {
  const rings = [
    { y: -0.52, radius: 0.74, count: 7 },
    { y: -0.08, radius: 1.00, count: 8 },
    { y: 0.42, radius: 0.64, count: 7 },
  ];
  const positions = [];
  const indices = [];
  const starts = [];
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];
    starts.push(positions.length / 3);
    for (let step = 0; step < ring.count; step += 1) {
      const angle = (step / ring.count) * Math.PI * 2 + smoothSignedNoise2D(step, ringIndex, 2.4, seed + 3101) * 0.20;
      const radius = ring.radius * (0.76 + hash2D(step, ringIndex, seed + 3203) * 0.42);
      positions.push(
        Math.cos(angle) * radius,
        ring.y + (hash2D(step, ringIndex + 17, seed + 3301) - 0.5) * 0.18,
        Math.sin(angle) * radius * (0.72 + hash2D(step, ringIndex + 29, seed + 3407) * 0.38),
      );
    }
  }
  const bottomCenter = positions.length / 3;
  positions.push(0.05, -0.72, -0.02);
  const topCenter = positions.length / 3;
  positions.push(-0.08, 0.66, 0.04);
  const bottomStart = starts[0];
  for (let step = 0; step < rings[0].count; step += 1) indices.push(bottomCenter, bottomStart + (step + 1) % rings[0].count, bottomStart + step);
  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const a = rings[ringIndex];
    const b = rings[ringIndex + 1];
    const aStart = starts[ringIndex];
    const bStart = starts[ringIndex + 1];
    const steps = Math.max(a.count, b.count);
    for (let step = 0; step < steps; step += 1) {
      const a0 = aStart + Math.floor((step / steps) * a.count) % a.count;
      const a1 = aStart + Math.floor(((step + 1) / steps) * a.count) % a.count;
      const b0 = bStart + Math.floor((step / steps) * b.count) % b.count;
      const b1 = bStart + Math.floor(((step + 1) / steps) * b.count) % b.count;
      indices.push(a0, b0, b1, a0, b1, a1);
    }
  }
  const topStart = starts[2];
  for (let step = 0; step < rings[2].count; step += 1) indices.push(topCenter, topStart + step, topStart + (step + 1) % rings[2].count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.glacialRubble = 'irregular-stratified-rubble-v1';
  return geometry;
}

function installIceRoughnessFabric(material, seed, { roughnessMin = 0.18, roughnessMax = 0.94, albedoVariation = 0, normalGain = 0 } = {}) {
  const salt = (Math.abs(seed) % 4093) + 17;
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prior) prior.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceWorldPosition;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvIceWorldPosition=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vIceWorldPosition;\nfloat iceHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+${salt.toFixed(1)})*43758.5453123);}\nfloat iceNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(iceHash(i),iceHash(i+vec2(1.0,0.0)),f.x),mix(iceHash(i+vec2(0.0,1.0)),iceHash(i+vec2(1.0,1.0)),f.x),f.y);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat iceAlbBroad=iceNoise(vIceWorldPosition.xz/91.0);\nfloat iceAlbMeso=iceNoise((vIceWorldPosition.xz+vIceWorldPosition.yy*0.23)/22.0);\nfloat iceAlbFine=iceNoise(vec2(vIceWorldPosition.x*0.19+vIceWorldPosition.y*0.07,vIceWorldPosition.z*0.21-vIceWorldPosition.y*0.04));\ndiffuseColor.rgb*=1.0+(iceAlbBroad-0.5)*${albedoVariation.toFixed(3)}+(iceAlbMeso-0.5)*${(albedoVariation * 0.55).toFixed(3)}+(iceAlbFine-0.5)*${(albedoVariation * 0.22).toFixed(3)};`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nfloat iceNormalX=iceNoise(vIceWorldPosition.xz*0.31+vec2(0.17,0.0))-iceNoise(vIceWorldPosition.xz*0.31-vec2(0.17,0.0));\nfloat iceNormalZ=iceNoise(vIceWorldPosition.xz*0.31+vec2(0.0,0.17))-iceNoise(vIceWorldPosition.xz*0.31-vec2(0.0,0.17));\nnormal=normalize(normal+mat3(viewMatrix)*vec3(iceNormalX,0.0,iceNormalZ)*${normalGain.toFixed(3)});`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nfloat iceRoughBroad=iceNoise(vIceWorldPosition.xz/118.0);\nfloat iceRoughMacro=iceNoise((vIceWorldPosition.xz+vIceWorldPosition.yy*0.19)/41.0);\nfloat iceRoughMeso=iceNoise((vIceWorldPosition.xz+vIceWorldPosition.yy*0.43)/10.5);\nfloat iceRoughBand=iceNoise(vec2(vIceWorldPosition.x*0.052+vIceWorldPosition.y*0.018,vIceWorldPosition.z*0.071-vIceWorldPosition.y*0.011));\nroughnessFactor=clamp(roughnessFactor*(0.69+iceRoughBroad*0.18+iceRoughMacro*0.25+iceRoughMeso*0.14+iceRoughBand*0.09),${roughnessMin.toFixed(3)},${roughnessMax.toFixed(3)});`);
  };
  const priorKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${priorKey ? priorKey() : ''}|ice-rough-v4-${salt}-${albedoVariation.toFixed(3)}-${normalGain.toFixed(3)}`;
  material.needsUpdate = true;
}

function iceVertexFabric(mesh, seed, { low = 0xaebfc1, mid = 0xd2dddc, high = 0xf0f4f1, roughness = 0.58 } = {}) {
  const position = mesh?.geometry?.getAttribute?.('position');
  if (!position || !mesh?.material) return 0;
  mesh.updateWorldMatrix?.(true, false);
  const lowColor = new THREE.Color(low);
  const midColor = new THREE.Color(mid);
  const highColor = new THREE.Color(high);
  const color = new THREE.Color();
  const world = new THREE.Vector3();
  const colors = new Float32Array(position.count * 3);
  const matrixWorld = mesh.matrixWorld;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    world.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(matrixWorld);
    minY = Math.min(minY, world.y);
    maxY = Math.max(maxY, world.y);
  }
  const span = Math.max(1, maxY - minY);
  for (let index = 0; index < position.count; index += 1) {
    world.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(matrixWorld);
    const macro = smoothNoise2D(world.x, world.z, 74, seed + 13001);
    const meso = smoothNoise2D(world.x + world.y * 0.24, world.z - world.y * 0.11, 21, seed + 13109);
    const micro = smoothNoise2D(world.x + world.y * 0.13, world.z, 6.5, seed + 13217);
    const height = (world.y - minY) / span;
    const weather = THREE.MathUtils.clamp(0.25 + macro * 0.33 + meso * 0.24 + micro * 0.06 + height * 0.12, 0, 1);
    color.copy(lowColor).lerp(midColor, Math.min(1, weather * 1.12));
    if (weather > 0.61) color.lerp(highColor, ((weather - 0.61) / 0.39) * 0.58);
    color.multiplyScalar(1 - Math.max(0, 0.40 - meso) * 0.13);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = mesh.material.clone();
  material.vertexColors = true;
  material.color.set(0xffffff);
  material.roughness = roughness;
  if (material.emissive) {
    material.emissive.set(0x183942);
    material.emissiveIntensity = Math.max(0.064, material.emissiveIntensity || 0);
  }
  installIceRoughnessFabric(material, seed + 13513, { albedoVariation: 0.08, normalGain: 0.055 });
  mesh.material = material;
  mesh.userData.worldSpaceGlacialAlbedoFabric = 'deterministic-smoothed-multiscale-v7-true-world-space';
  mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v4-aerial';
  return position.count;
}

function fractureWall(group, sections, seed) {
  const wall = group.getObjectByName('the-wall-natural-ice-cliff');
  const position = wall?.geometry?.getAttribute?.('position');
  if (!position) return 0;
  let moved = 0;
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const base = section.baseVertex;
    const macro = smoothSignedNoise2D(index, 7, 3.7, seed + 6101);
    const shear = smoothSignedNoise2D(index, 11, 2.2, seed + 6203);
    const crest = smoothSignedNoise2D(index, 17, 4.8, seed + 6301);
    const faceBias = smoothSignedNoise2D(index, 19, 7.4, seed + 6401);
    for (const [vertex, sign, amount] of [[base + 1, 1, macro * 9.8 + faceBias * 2.2], [base + 3, -1, macro * 7.2 - faceBias * 1.8], [base, 1, shear * 3.2], [base + 2, -1, shear * 2.2]]) {
      position.setX(vertex, position.getX(vertex) + section.nx * amount * sign + section.tx * shear * 1.8);
      position.setZ(vertex, position.getZ(vertex) + section.nz * amount * sign + section.tz * shear * 1.8);
      moved += 1;
    }
    position.setY(base + 1, position.getY(base + 1) + crest * 6.9 + faceBias * 2.0);
    position.setY(base + 3, position.getY(base + 3) + crest * 5.4 - faceBias * 1.4);
  }
  refreshGeometry(wall.geometry);
  iceVertexFabric(wall, seed + 13331, { low: 0xc8d5d5, mid: 0xe1e9e7, high: 0xf5f8f5, roughness: 0.53 });
  if (wall.material?.emissive) {
    wall.material.emissive.set(0x214650);
    wall.material.emissiveIntensity = Math.max(0.095, wall.material.emissiveIntensity || 0);
    wall.material.needsUpdate = true;
  }
  wall.userData.primaryGlacialBreakup = true;
  wall.userData.crestBreakup = 'smoothed-multiscale-asymmetric-v2';
  return moved;
}

function fracturePortalMesh(group, portal, seed) {
  const mesh = group.getObjectByName('ice-wall-cave-portal');
  const position = mesh?.geometry?.getAttribute?.('position');
  if (!position) return 0;
  mesh.updateMatrixWorld?.(true);
  const world = new THREE.Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    world.set(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(mesh.matrixWorld);
    minY = Math.min(minY, world.y);
    maxY = Math.max(maxY, world.y);
  }
  const span = Math.max(1, maxY - minY);
  let moved = 0;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    world.set(x, y, z).applyMatrix4(mesh.matrixWorld);
    const h = clamp01((world.y - minY) / span);
    const lateralWorld = (world.x - portal.centerX) * portal.tx + (world.z - portal.centerZ) * portal.tz;
    const side = lateralWorld < 0 ? -1 : 1;
    const broad = smoothSignedNoise2D(world.y + side * 17.3, lateralWorld, 6.2, seed + 6413);
    const fine = smoothSignedNoise2D(world.y * 0.7, lateralWorld * 1.2, 2.4, seed + 6451);
    const crownWeight = smooth01((h - 0.34) / 0.66);
    const sideWeight = 1 - smooth01(Math.abs(lateralWorld) / 9.5);
    const asymmetry = side * (0.20 + h * 0.34) + broad * (0.46 + crownWeight * 0.44) + fine * 0.16;
    position.setX(index, x + portal.tx * asymmetry + portal.nx * broad * 0.12);
    position.setZ(index, z + portal.tz * asymmetry + portal.nz * broad * 0.12);
    position.setY(index, y + broad * (0.16 + crownWeight * 0.42) - sideWeight * fine * 0.08);
    moved += 1;
  }
  refreshGeometry(mesh.geometry);
  mesh.userData.portalSilhouetteBreakup = 'deterministic-asymmetric-glacial-collapse-v2';
  return moved;
}

function fractureCave(group, portal, rings, seed) {
  const cave = group.getObjectByName('ice-cave-shell');
  const position = cave?.geometry?.getAttribute?.('position');
  if (!position || !rings.length) return 0;
  const stride = Math.max(1, Math.round(position.count / rings.length));
  let moved = 0;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const tunnelProgress = ringIndex / Math.max(1, rings.length - 1);
    const centerDrift = smoothSignedNoise2D(ringIndex, 41, 3.7, seed + 6511) * (0.28 + tunnelProgress * 0.55);
    const crownSag = smoothSignedNoise2D(ringIndex, 53, 4.8, seed + 6521) * (0.18 + tunnelProgress * 0.34);
    for (let step = 0; step < stride; step += 1) {
      const vertex = ringIndex * stride + step;
      if (vertex >= position.count) continue;
      const arc01 = step / Math.max(1, stride - 1);
      const edge = Math.abs(arc01 - 0.5) * 2;
      const side = arc01 < 0.5 ? -1 : 1;
      const coherent = smoothSignedNoise2D(ringIndex * 1.7, step * 0.8, 3.0, seed + 6503);
      const fine = smoothSignedNoise2D(ringIndex * 4.1, step * 2.2, 1.8, seed + 6607);
      const frontBoost = 1 - smooth01(tunnelProgress / 0.28);
      const lateralWarp = centerDrift + coherent * (0.44 + edge * 0.62) + fine * 0.13 + side * frontBoost * (0.20 + edge * 0.24);
      const lift = crownSag + coherent * (0.22 + (1 - edge) * 0.46) + fine * 0.12 - frontBoost * (1 - edge) * 0.14;
      position.setX(vertex, position.getX(vertex) + portal.tx * lateralWarp + portal.nx * coherent * 0.08);
      position.setZ(vertex, position.getZ(vertex) + portal.tz * lateralWarp + portal.nz * coherent * 0.08);
      position.setY(vertex, position.getY(vertex) + lift);
      moved += 1;
    }
  }
  refreshGeometry(cave.geometry);
  iceVertexFabric(cave, seed + 13441, { low: 0xa4bec4, mid: 0xc8dcdd, high: 0xeaf2ef, roughness: 0.40 });
  cave.userData.primaryGlacialBreakup = true;
  cave.userData.caveSilhouetteBreakup = 'coherent-meander-collapse-v2';
  return moved;
}

function field(name, role, geometry, material, transforms, seed, tints = null) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.iceLandmarkRole = role;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  const low = tints ? new THREE.Color(tints[0]) : null;
  const high = tints ? new THREE.Color(tints[1]) : null;
  for (let index = 0; index < transforms.length; index += 1) {
    const transform = transforms[index];
    quaternion.setFromEuler(new THREE.Euler(transform.rx || 0, transform.ry || 0, transform.rz || 0));
    matrix.compose(transform.position, quaternion, transform.scale);
    mesh.setMatrixAt(index, matrix);
    const shade = 0.82 + hash2D(index, role.length, seed + 7013) * 0.18;
    if (low && high) color.copy(low).lerp(high, hash2D(index, 71, seed + 7069));
    else color.setRGB(shade * 0.96, shade * 0.995, Math.min(1, shade * 1.04));
    mesh.setColorAt(index, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function wallPlates(group, sections, portal, seed) {
  const wall = group.getObjectByName('the-wall-natural-ice-cliff');
  if (!wall?.material) return 0;
  const material = wall.material.clone();
  material.vertexColors = false;
  material.color.set(0xc4d0cf);
  material.roughness = Math.max(0.64, material.roughness || 0.64);
  material.transmission = Math.min(0.012, material.transmission || 0);
  material.clearcoat = Math.min(0.045, material.clearcoat || 0);
  installIceRoughnessFabric(material, seed + 7867, { albedoVariation: 0.065, normalGain: 0.045 });
  const transforms = [];
  for (let index = 3; index < sections.length - 3; index += 4) {
    const section = sections[index];
    if (Math.hypot(section.x - portal.centerX, section.z - portal.centerZ) < 62) continue;
    const side = hash2D(index, 5, seed + 7103) > 0.5 ? 1 : -1;
    if (hash2D(index, 6, seed + 7117) < 0.18) continue;
    const width = 6 + hash2D(index, 7, seed + 7207) * 13;
    const height = 18 + hash2D(index, 11, seed + 7307) * 34;
    const depth = 0.48 + hash2D(index, 13, seed + 7403) * 1.06;
    const elevation = 0.14 + hash2D(index, 17, seed + 7507) * 0.64;
    const offset = section.thicknessMeters * 0.5 + depth * 0.035;
    const along = smoothSignedNoise2D(index, 73, 4.2, seed + 7523) * 5.2;
    transforms.push({ position: new THREE.Vector3(section.x + section.tx * along + section.nx * offset * side, section.centerGround + section.heightMeters * elevation, section.z + section.tz * along + section.nz * offset * side), scale: new THREE.Vector3(width * 0.5, height * 0.5, depth), rx: (hash2D(index, 19, seed + 7603) - 0.5) * 0.12, ry: -Math.atan2(section.tz, section.tx) + (hash2D(index, 23, seed + 7703) - 0.5) * 0.16, rz: (hash2D(index, 29, seed + 7801) - 0.5) * 0.32 });
  }
  if (!transforms.length) return 0;
  const mesh = field('ice-wall-macro-fracture-plates', 'wall-macro-fracture-plates', createEmbeddedFracturePlateGeometry(), material, transforms, seed + 7901, [0x9fb5b8, 0xcbd6d5]);
  mesh.userData.breakupGeometry = 'embedded-irregular-glacial-slab-v14';
  mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v4-aerial';
  group.add(mesh);
  return mesh.count;
}

function wallRibs(group, sections, portal, seed) {
  const wall = group.getObjectByName('the-wall-natural-ice-cliff');
  if (!wall?.material) return 0;
  const material = wall.material.clone();
  material.vertexColors = false;
  material.color.set(0xb5c9cb);
  material.roughness = 0.49;
  material.transmission = Math.max(0.016, material.transmission || 0);
  material.clearcoat = Math.max(0.065, material.clearcoat || 0);
  material.clearcoatRoughness = 0.36;
  installIceRoughnessFabric(material, seed + 9281, { albedoVariation: 0.05, normalGain: 0.035 });
  const transforms = [];
  for (let index = 2; index < sections.length - 2; index += 3) {
    const section = sections[index];
    if (Math.hypot(section.x - portal.centerX, section.z - portal.centerZ) < 46) continue;
    for (const side of [-1, 1]) {
      if (hash2D(index, side + 83, seed + 8707) < 0.38) continue;
      const height = section.heightMeters * (0.08 + hash2D(index, side + 89, seed + 8803) * 0.14);
      const width = 2.0 + hash2D(index, side + 97, seed + 8909) * 2.8;
      const depth = 0.38 + hash2D(index, side + 101, seed + 9001) * 0.62;
      const offset = section.thicknessMeters * 0.5 + depth * 0.075;
      const along = smoothSignedNoise2D(index, side * 31, 2.8, seed + 9103) * 7.2;
      transforms.push({ position: new THREE.Vector3(section.x + section.tx * along + section.nx * offset * side, section.centerGround + section.heightMeters * (0.16 + hash2D(index, side + 87, seed + 8779) * 0.14) + height * 0.5, section.z + section.tz * along + section.nz * offset * side), scale: new THREE.Vector3(width * 0.5, height * 0.5, depth), rx: (hash2D(index, side + 109, seed + 9257) - 0.5) * 0.045, ry: -Math.atan2(section.tz, section.tx), rz: (hash2D(index, side + 107, seed + 9209) - 0.5) * 0.075 });
    }
  }
  if (!transforms.length) return 0;
  const mesh = field('ice-wall-vertical-flow-ribs', 'wall-vertical-flow-ribs', createEmbeddedFlowRibGeometry(), material, transforms, seed + 9301, [0x9bb5ba, 0xc9d7d7]);
  mesh.userData.breakupGeometry = 'embedded-tapered-glacial-flow-rib-v14';
  mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v4-aerial';
  group.add(mesh);
  return mesh.count;
}

function portalShroud(group, portal, seed) {
  const wall = group.getObjectByName('the-wall-natural-ice-cliff');
  if (!wall?.material) return 0;
  const portalMesh = group.getObjectByName('ice-wall-cave-portal');
  if (portalMesh?.material) {
    const portalVertexCount = iceVertexFabric(portalMesh, seed + 13331, { low: 0xc8d5d5, mid: 0xe1e9e7, high: 0xf5f8f5, roughness: 0.53 });
    const material = portalMesh.material;
    material.transmission = Math.max(0.012, Math.min(0.020, material.transmission || 0));
    material.clearcoat = Math.max(0.035, Math.min(0.060, material.clearcoat || 0));
    material.clearcoatRoughness = 0.47;
    if (material.emissive) { material.emissive.set(0x214650); material.emissiveIntensity = 0.085; }
    material.needsUpdate = true;
    portalMesh.userData.portalMaterialBlend = 'wall-shared-world-fabric-v16-asymmetric-collapse';
    portalMesh.userData.portalVertexFabricCount = portalVertexCount;
  }
  const material = wall.material.clone();
  material.vertexColors = false;
  material.color.set(0xc4d2d2);
  material.roughness = 0.60;
  material.transmission = 0.010;
  material.clearcoat = 0.035;
  material.clearcoatRoughness = 0.50;
  if (material.emissive) { material.emissive.set(0x1d4048); material.emissiveIntensity = Math.max(0.072, material.emissiveIntensity || 0); }
  installIceRoughnessFabric(material, seed + 12437, { albedoVariation: 0.06, normalGain: 0.04 });
  const transforms = [];
  const half = 7.8;
  const yaw = -Math.atan2(portal.tz, portal.tx);
  for (const face of [-1, 1]) {
    const normal = (portal.depth * 0.5 - 0.72) * face;
    for (const side of [-1, 1]) {
      const sideBias = side < 0 ? 1.10 : 0.87;
      const levels = side < 0 ? 4 : 3;
      for (let level = 0; level < levels; level += 1) {
        const lateral = side * (half + 0.25 + level * 0.36 * sideBias) + smoothSignedNoise2D(level, side * 13, 1.9, seed + 11677) * 0.36;
        const width = 0.42 + hash2D(level, side + 19, seed + 11701) * 0.68;
        const height = 1.2 + hash2D(level, side + 239, seed + 11807) * 2.2;
        transforms.push({ position: new THREE.Vector3(portal.centerX + portal.tx * lateral + portal.nx * normal, portal.groundY + 1.45 + level * (1.74 + hash2D(level, 277, seed + 11819) * 0.42), portal.centerZ + portal.tz * lateral + portal.nz * normal), scale: new THREE.Vector3(width, height, 0.18 + hash2D(level, 283, seed + 11831) * 0.20), rx: (hash2D(level, side + 251, seed + 11891) - 0.5) * 0.12, ry: yaw + side * (0.018 + hash2D(level, 257, seed + 11911) * 0.04), rz: side * (0.035 + level * 0.014) + (hash2D(level, side + 263, seed + 11921) - 0.5) * 0.15 });
      }
    }
    const crownPieces = 7;
    for (let step = 1; step <= crownPieces; step += 1) {
      if (hash2D(step, face + 297, seed + 11977) < 0.14) continue;
      const t = step / (crownPieces + 1);
      const angle = Math.PI - t * Math.PI;
      const crownNoise = smoothSignedNoise2D(step, face * 11, 2.6, seed + 11903);
      const lateral = Math.cos(angle) * (half - 0.55) + crownNoise * 0.52;
      const height = 5.05 + Math.sin(angle) * (7.15 + crownNoise * 0.55);
      transforms.push({ position: new THREE.Vector3(portal.centerX + portal.tx * lateral + portal.nx * normal, portal.groundY + height, portal.centerZ + portal.tz * lateral + portal.nz * normal), scale: new THREE.Vector3(0.34 + hash2D(step, 271, seed + 12001) * 0.58, 0.75 + hash2D(step, face + 277, seed + 12037) * 1.45, 0.14 + hash2D(step, 279, seed + 12043) * 0.16), rx: (hash2D(step, face + 281, seed + 12071) - 0.5) * 0.10, ry: yaw + crownNoise * 0.04, rz: crownNoise * 0.22 + (hash2D(step, face + 29, seed + 12101) - 0.5) * 0.12 });
    }
  }
  const mesh = field('ice-cave-natural-portal-shroud', 'natural-fractured-portal-shroud', createEmbeddedFlowRibGeometry(), material, transforms, seed + 8209, [0xb8c9ca, 0xd8e2e0]);
  mesh.userData.portalShroudGeometry = 'asymmetric-collapsed-glacial-buttress-v16';
  mesh.userData.worldSpaceGlacialRoughnessFabric = 'deterministic-shader-multiscale-v4-aerial';
  group.add(mesh);
  return mesh.count;
}

function createCaveRibbonGeometry(rings, portal, { widthMultiplier = 0.84, yOffset = 0.06, seed, laneCount = 5, meander = 0.18, bankAsymmetry = 0.16, colorLow = [0.31, 0.35, 0.34], colorHigh = [0.47, 0.51, 0.48], brokenSegments = false } = {}) {
  const lanes = Math.max(2, Math.floor(laneCount));
  const positions = [], colors = [], indices = [], active = [];
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const ring = rings[ringIndex];
    const progress = ringIndex / Math.max(1, rings.length - 1);
    const broad = smoothSignedNoise2D(ringIndex, 17, 4.8, seed + 8303);
    const meso = smoothSignedNoise2D(ringIndex, 29, 2.1, seed + 8353);
    const centerOffset = ring.halfWidth * meander * (broad * 0.74 + meso * 0.26);
    const leftWidth = ring.halfWidth * widthMultiplier * (0.90 + broad * bankAsymmetry + meso * 0.06);
    const rightWidth = ring.halfWidth * widthMultiplier * (0.90 - broad * bankAsymmetry + meso * 0.04);
    const yBroad = smoothSignedNoise2D(ringIndex, 41, 3.2, seed + 8401) * 0.11;
    const segmentActive = !brokenSegments || ringIndex < 2 || ringIndex > rings.length - 3 || hash2D(Math.floor(ringIndex / 2), 97, seed + 8419) > 0.24;
    active.push(segmentActive);
    for (let lane = 0; lane < lanes; lane += 1) {
      const laneT = lane / (lanes - 1);
      const sideOffset = laneT < 0.5 ? -leftWidth * (1 - laneT * 2) : rightWidth * ((laneT - 0.5) * 2);
      const laneNoise = smoothSignedNoise2D(ringIndex * 1.7, lane * 11, 3.8, seed + 8441) * ring.halfWidth * 0.025;
      const lateral = centerOffset + sideOffset + laneNoise;
      const bank = Math.abs(laneT - 0.5) * 2;
      const y = ring.centerY + yOffset + yBroad + bank * (0.025 + meso * 0.012) + smoothSignedNoise2D(ringIndex * 3.1, lane * 4.7, 2.4, seed + 8467) * 0.025;
      positions.push(ring.centerX + portal.tx * lateral, y, ring.centerZ + portal.tz * lateral);
      const dirt = smooth01(hash2D(ringIndex * 13 + lane, 67, seed + 8501));
      const stain = clamp01(0.5 + broad * 0.24 + meso * 0.18 + (progress - 0.5) * 0.08);
      const m = clamp01(dirt * 0.58 + stain * 0.42);
      colors.push(THREE.MathUtils.lerp(colorLow[0], colorHigh[0], m), THREE.MathUtils.lerp(colorLow[1], colorHigh[1], m), THREE.MathUtils.lerp(colorLow[2], colorHigh[2], m));
    }
    if (ringIndex > 0 && active[ringIndex] && active[ringIndex - 1]) {
      const currentBase = ringIndex * lanes, previousBase = (ringIndex - 1) * lanes;
      for (let lane = 0; lane < lanes - 1; lane += 1) indices.push(previousBase + lane, currentBase + lane, currentBase + lane + 1, previousBase + lane, currentBase + lane + 1, previousBase + lane + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.caveRibbon = Object.freeze({ lanes, meander, bankAsymmetry, brokenSegments });
  return geometry;
}

function caveFloor(group, portal, rings, seed) {
  if (rings.length < 2) return 0;
  const floorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.84, metalness: 0, side: THREE.DoubleSide });
  installIceRoughnessFabric(floorMaterial, seed + 8543, { roughnessMin: 0.62, roughnessMax: 0.99, albedoVariation: 0.11, normalGain: 0.095 });
  const floor = new THREE.Mesh(createCaveRibbonGeometry(rings, portal, { widthMultiplier: 0.88, yOffset: 0.055, seed, laneCount: 7, meander: 0.10, bankAsymmetry: 0.18, colorLow: [0.26, 0.29, 0.28], colorHigh: [0.48, 0.50, 0.46] }), floorMaterial);
  floor.name = 'ice-cave-sediment-floor';
  floor.receiveShadow = true;
  floor.userData.iceLandmarkRole = 'cave-sediment-floor';
  floor.userData.floorGeometry = 'seven-lane-meandering-sediment-v2';
  group.add(floor);
  const wetMaterial = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0x6a9297, roughness: 0.28, metalness: 0, clearcoat: 0.28, clearcoatRoughness: 0.20, transmission: 0.030, thickness: 0.22, ior: 1.31, side: THREE.DoubleSide });
  installIceRoughnessFabric(wetMaterial, seed + 8609, { roughnessMin: 0.16, roughnessMax: 0.48, albedoVariation: 0.07, normalGain: 0.055 });
  const wet = new THREE.Mesh(createCaveRibbonGeometry(rings, portal, { widthMultiplier: 0.24, yOffset: 0.108, seed: seed + 8609, laneCount: 4, meander: 0.52, bankAsymmetry: 0.34, colorLow: [0.20, 0.38, 0.42], colorHigh: [0.36, 0.59, 0.61], brokenSegments: true }), wetMaterial);
  wet.name = 'ice-cave-wet-melt-ribbon';
  wet.receiveShadow = true;
  wet.userData.iceLandmarkRole = 'cave-wet-melt-ribbon';
  wet.userData.meltwaterGeometry = 'broken-braided-meandering-runnel-v2';
  group.add(wet);
  const seepMaterial = wetMaterial.clone();
  seepMaterial.roughness = 0.34;
  const seep = new THREE.Mesh(createCaveRibbonGeometry(rings, portal, { widthMultiplier: 0.09, yOffset: 0.112, seed: seed + 8681, laneCount: 3, meander: 0.82, bankAsymmetry: 0.41, colorLow: [0.18, 0.33, 0.37], colorHigh: [0.33, 0.54, 0.57], brokenSegments: true }), seepMaterial);
  seep.name = 'ice-cave-secondary-melt-seep';
  seep.receiveShadow = true;
  seep.userData.iceLandmarkRole = 'cave-secondary-melt-seep';
  group.add(seep);
  const cave = group.getObjectByName('ice-cave-shell');
  if (cave?.material) {
    cave.material.color.set(cave.userData.worldSpaceGlacialAlbedoFabric ? 0xffffff : 0xd5dddd);
    cave.material.roughness = Math.min(0.47, cave.material.roughness || 0.47);
    cave.material.transmission = Math.max(0.072, cave.material.transmission || 0);
    cave.material.attenuationColor.set(0x3f7f8d);
    cave.material.emissive.set(0x0b3139);
    cave.material.emissiveIntensity = 0.13;
    cave.material.needsUpdate = true;
  }
  return floor.geometry.index.count / 3 + wet.geometry.index.count / 3 + seep.geometry.index.count / 3;
}

function caveLights(group, portal, rings, seed) {
  if (rings.length < 8) return 0;
  const ringIds = [4, 8, 12, Math.min(rings.length - 3, 15)];
  let count = 0;
  for (let index = 0; index < ringIds.length; index += 1) {
    const ringIndex = Math.min(rings.length - 2, ringIds[index]);
    const ring = rings[ringIndex];
    if (!ring) continue;
    const lateral = smoothSignedNoise2D(ringIndex, 251, 3.2, seed + 12101) * ring.halfWidth * 0.24;
    const lift = ring.height * (0.28 + hash2D(ringIndex, 257, seed + 12203) * 0.16);
    const light = new THREE.PointLight(index % 2 === 0 ? 0x46b9cf : 0x6bd0db, 1.05 + hash2D(ringIndex, 263, seed + 12301) * 0.55, 23 + hash2D(ringIndex, 269, seed + 12409) * 10, 2);
    light.name = `ice-cave-subsurface-light-${index + 1}`;
    light.position.set(ring.centerX + portal.tx * lateral, ring.centerY + lift, ring.centerZ + portal.tz * lateral);
    light.userData.iceLandmarkRole = 'cave-cyan-subsurface-depth-light';
    light.userData.glacialDepthLayer = ringIndex;
    group.add(light);
    count += 1;
  }
  return count;
}

function caveBits(group, portal, rings, seed) {
  if (rings.length < 4) return Object.freeze({ icicleCount: 0, debrisCount: 0, frostShardCount: 0 });
  const iceMaterial = new THREE.MeshPhysicalMaterial({ color: 0x9cc9d4, roughness: 0.24, metalness: 0, transmission: 0.13, thickness: 1.6, ior: 1.31, attenuationColor: 0x2e7386, attenuationDistance: 8, clearcoat: 0.18, clearcoatRoughness: 0.2 });
  installIceRoughnessFabric(iceMaterial, seed + 9367, { roughnessMin: 0.18, roughnessMax: 0.52, albedoVariation: 0.06, normalGain: 0.035 });
  const icicles = [];
  for (let ringIndex = 1; ringIndex < rings.length - 1; ringIndex += 2) {
    const ring = rings[ringIndex];
    const count = 1 + Math.floor(hash2D(ringIndex, 113, seed + 9403) * 3);
    for (let index = 0; index < count; index += 1) {
      const lateral = smoothSignedNoise2D(ringIndex * 13 + index, 127, 2.6, seed + 9503) * ring.halfWidth * 0.68;
      const length = 0.8 + hash2D(ringIndex * 17 + index, 131, seed + 9601) * 3.8;
      icicles.push({ position: new THREE.Vector3(ring.centerX + portal.tx * lateral, ring.centerY + ring.height * (0.80 + hash2D(index, ringIndex, seed + 9623) * 0.08) - length * 0.5, ring.centerZ + portal.tz * lateral), scale: new THREE.Vector3(0.18 + length * 0.058, length, 0.18 + length * 0.050), rx: Math.PI, ry: -Math.atan2(portal.tz, portal.tx) + smoothSignedNoise2D(index, ringIndex, 1.7, seed + 9661) * 0.09, rz: (hash2D(ringIndex, index + 137, seed + 9701) - 0.5) * 0.16 });
    }
  }
  const icicleMesh = field('ice-cave-ceiling-icicles', 'cave-ceiling-icicles', new THREE.ConeGeometry(1, 1, 7, 1), iceMaterial, icicles, seed + 9803, [0x6fabbc, 0xcbe3e7]);
  group.add(icicleMesh);
  const debris = [], frostShards = [];
  for (let ringIndex = 1; ringIndex < rings.length - 1; ringIndex += 1) {
    const ring = rings[ringIndex];
    for (const side of [-1, 1]) {
      if (hash2D(ringIndex, side + 149, seed + 9901) > 0.30) {
        const lateral = side * ring.halfWidth * (0.52 + hash2D(ringIndex, side + 151, seed + 10007) * 0.34);
        const size = 0.22 + hash2D(ringIndex, side + 157, seed + 10103) * 0.92;
        debris.push({ position: new THREE.Vector3(ring.centerX + portal.tx * lateral, ring.centerY + 0.11 + size * 0.08, ring.centerZ + portal.tz * lateral), scale: new THREE.Vector3(size * (0.85 + hash2D(ringIndex, side + 159, seed + 10139) * 0.75), size * 0.48, size), rx: hash2D(ringIndex, side + 163, seed + 10211) * 0.62, ry: hash2D(ringIndex, side + 167, seed + 10301) * Math.PI, rz: hash2D(ringIndex, side + 173, seed + 10427) * 0.52 });
      }
      if (ringIndex % 2 === 0 && hash2D(ringIndex, side + 179, seed + 10451) > 0.42) {
        const lateral = side * ring.halfWidth * (0.71 + hash2D(ringIndex, 181, seed + 10459) * 0.18);
        const height = 0.6 + hash2D(ringIndex, side + 191, seed + 10463) * 1.9;
        frostShards.push({ position: new THREE.Vector3(ring.centerX + portal.tx * lateral, ring.centerY + height * 0.36, ring.centerZ + portal.tz * lateral), scale: new THREE.Vector3(0.24 + height * 0.10, height, 0.18 + height * 0.08), rx: (hash2D(ringIndex, 193, seed + 10477) - 0.5) * 0.28, ry: -Math.atan2(portal.tz, portal.tx) + side * 0.20, rz: side * (0.24 + hash2D(ringIndex, 197, seed + 10487) * 0.24) });
      }
    }
  }
  const rubbleMaterial = new THREE.MeshStandardMaterial({ color: 0x4f5552, roughness: 0.94, metalness: 0 });
  installIceRoughnessFabric(rubbleMaterial, seed + 10499, { roughnessMin: 0.76, roughnessMax: 1.0, albedoVariation: 0.13, normalGain: 0.08 });
  const debrisMesh = field('ice-cave-sediment-debris', 'cave-sediment-debris', createGlacialRubbleGeometry(seed + 10501), rubbleMaterial, debris, seed + 10501, [0x343a38, 0x69675d]);
  debrisMesh.userData.debrisGeometry = 'irregular-stratified-glacial-rubble-v1';
  group.add(debrisMesh);
  const shardMesh = field('ice-cave-frost-shards', 'cave-frost-shards', createEmbeddedFlowRibGeometry(), iceMaterial.clone(), frostShards, seed + 10541, [0x7fb7c4, 0xd7e7e7]);
  group.add(shardMesh);
  return Object.freeze({ icicleCount: icicleMesh.count, debrisCount: debrisMesh.count, frostShardCount: shardMesh.count });
}

function blueCore(group, portal, rings, seed) {
  if (rings.length < 6) return 0;
  const material = new THREE.MeshPhysicalMaterial({ color: 0x2f8197, roughness: 0.19, metalness: 0, transmission: 0.24, thickness: 2.4, ior: 1.31, attenuationColor: 0x14576b, attenuationDistance: 6.5, clearcoat: 0.28, clearcoatRoughness: 0.18, emissive: 0x062f3b, emissiveIntensity: 0.16 });
  installIceRoughnessFabric(material, seed + 10619, { roughnessMin: 0.13, roughnessMax: 0.44, albedoVariation: 0.08, normalGain: 0.04 });
  const transforms = [];
  for (let ringIndex = 3; ringIndex < rings.length - 2; ringIndex += 2) {
    const ring = rings[ringIndex];
    for (const side of [-1, 1]) {
      if (hash2D(ringIndex, side + 181, seed + 10601) < 0.26) continue;
      const lateral = side * ring.halfWidth * (0.70 + hash2D(ringIndex, side + 191, seed + 10709) * 0.18) + smoothSignedNoise2D(ringIndex, side * 37, 2.8, seed + 10739) * 0.36;
      const lift = ring.height * (0.18 + hash2D(ringIndex, side + 193, seed + 10831) * 0.42);
      transforms.push({ position: new THREE.Vector3(ring.centerX + portal.tx * lateral, ring.centerY + lift, ring.centerZ + portal.tz * lateral), scale: new THREE.Vector3(0.55 + hash2D(ringIndex, side + 197, seed + 10939) * 1.15, 2.2 + hash2D(ringIndex, side + 199, seed + 11003) * 4.6, 0.45 + hash2D(ringIndex, side + 211, seed + 11113) * 0.95), ry: -Math.atan2(portal.tz, portal.tx) + side * (0.18 + hash2D(ringIndex, 223, seed + 11239) * 0.18), rz: side * (0.08 + hash2D(ringIndex, 227, seed + 11329) * 0.18) });
    }
  }
  if (!transforms.length) return 0;
  const mesh = field('ice-cave-dense-blue-core-slabs', 'cave-dense-blue-core-slabs', createFacetedSlabGeometry([[-0.62, -1.0], [0.24, -0.91], [0.75, -0.28], [0.52, 0.48], [0.05, 1.0], [-0.46, 0.68], [-0.79, 0.04]], { frontDepth: 0.31, backDepth: -0.24, frontCrown: 0.46 }), material, transforms, seed + 11443, [0x1d6378, 0x65b2c1]);
  mesh.userData.blueCoreGeometry = 'irregular-dense-ice-slab-v2';
  group.add(mesh);
  return mesh.count;
}

export function applyIceLandmarkGeometryBreakup({ group, wallSections, portal, caveRings, seed }) {
  const wallVertexMoves = fractureWall(group, wallSections, seed);
  const portalVertexMoves = fracturePortalMesh(group, portal, seed);
  const caveVertexMoves = fractureCave(group, portal, caveRings, seed);
  const macroFracturePlateCount = wallPlates(group, wallSections, portal, seed);
  const wallFlowRibCount = wallRibs(group, wallSections, portal, seed);
  const portalShroudCount = portalShroud(group, portal, seed);
  const caveFloorTriangleCount = caveFloor(group, portal, caveRings, seed);
  const caveSubsurfaceLightCount = caveLights(group, portal, caveRings, seed);
  const bits = caveBits(group, portal, caveRings, seed);
  const caveBlueCoreCount = blueCore(group, portal, caveRings, seed);
  return Object.freeze({
    wallVertexMoves,
    portalVertexMoves,
    caveVertexMoves,
    macroFracturePlateCount,
    wallFlowRibCount,
    portalShroudCount,
    caveFloorTriangleCount,
    caveSubsurfaceLightCount,
    caveIcicleCount: bits.icicleCount,
    caveDebrisCount: bits.debrisCount,
    caveFrostShardCount: bits.frostShardCount,
    caveBlueCoreCount,
    primaryMeshesFractured: wallVertexMoves > 0 && caveVertexMoves > 0 && portalVertexMoves > 0,
    secondaryBreakupPresent: macroFracturePlateCount > 8 && wallFlowRibCount > 8 && portalShroudCount > 10 && caveFloorTriangleCount > 20 && caveSubsurfaceLightCount >= 3 && bits.icicleCount > 4 && caveBlueCoreCount > 4,
    caveFloorNaturalisation: 'meandering-sediment-braided-meltwater-v2',
    portalNaturalisation: 'asymmetric-collapse-buttress-v2',
    debrisNaturalisation: 'irregular-stratified-glacial-rubble-v1',
  });
}
