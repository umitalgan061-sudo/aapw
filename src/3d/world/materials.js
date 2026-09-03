import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

/**
 * Deterministic procedural PBR materials for settlement/castle geometry.
 *
 * Geography authority is deliberately outside this module. It changes only render material response
 * and imported-geometry texture coordinates; terrain, hydrology, coastlines, roads and colliders are
 * never sampled or mutated here. The goal is to keep masonry and roofs from reading as flat paint or
 * obvious tiled wallpaper at gameplay and full-world camera distances.
 */

const TEXTURE_SIZE = 256;
const TAU = Math.PI * 2;

export const SETTLEMENT_SURFACE_REALISM_POLICY = Object.freeze({
  id: 'settlement-surface-realism-2026-09-03-v2-multiscale-weathering',
  deterministic: true,
  renderOnly: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  multiScaleAlbedo: true,
  multiScaleNormal: true,
  multiScaleRoughness: true,
  worldSpaceBreakup: true,
  stoneCourseStagger: true,
  edgeChipping: true,
  mineralVariation: true,
  mortarWeathering: true,
  roofShingleVariation: true,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function fract(value) {
  return value - Math.floor(value);
}

function hash2(x, y, seed = 0) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b)
    ^ Math.imul((y | 0) ^ 0xc2b2ae35, 0x27d4eb2d)
    ^ (seed | 0);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise2D(x, y, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth01(fract(x));
  const fy = smooth01(fract(y));
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fx),
    THREE.MathUtils.lerp(c, d, fx),
    fy,
  );
}

function fbm2D(x, y, seed = 0, octaves = 4) {
  let amplitude = 0.55;
  let frequency = 1;
  let value = 0;
  let normalization = 0;
  let px = x;
  let py = y;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2D(px * frequency, py * frequency, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    const rotatedX = px * 0.82 - py * 0.57 + 7.31;
    const rotatedY = px * 0.57 + py * 0.82 - 4.89;
    px = rotatedX;
    py = rotatedY;
    frequency *= 1.97;
    amplitude *= 0.49;
  }
  return value / Math.max(1e-6, normalization);
}

function canvas2D() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE_SIZE;
  return { canvas, ctx: canvas.getContext('2d') };
}

function finalizeTexture(texture, repeatX, repeatY, isColorMap) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  if (isColorMap) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function stoneLayout(seed, blockCols = 9, blockRows = 12) {
  const random = mulberry32(seed ^ 0x53544f4e);
  const blockWidth = TEXTURE_SIZE / blockCols;
  const blockHeight = TEXTURE_SIZE / blockRows;
  const rows = [];
  for (let row = 0; row < blockRows; row++) {
    const stagger = row % 2 === 0 ? 0 : blockWidth * (0.38 + random() * 0.20);
    const courseHeight = blockHeight * (0.88 + random() * 0.24);
    const joints = [];
    for (let col = -1; col <= blockCols + 1; col++) {
      joints.push({
        x: col * blockWidth + stagger + (random() - 0.5) * blockWidth * 0.16,
        width: 1.05 + random() * 1.65,
      });
    }
    rows.push(Object.freeze({
      stagger,
      courseHeight,
      y: row * blockHeight,
      horizontalJoint: 1.15 + random() * 1.55,
      joints: Object.freeze(joints),
      tint: (random() - 0.5) * 0.16,
      mineral: random(),
    }));
  }
  return Object.freeze({ blockWidth, blockHeight, blockCols, blockRows, rows: Object.freeze(rows) });
}

function stoneHeightAndMasks(layout, seed) {
  const height = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  const mortar = new Float32Array(height.length);
  const chips = new Float32Array(height.length);
  const mineral = new Float32Array(height.length);
  const macro = new Float32Array(height.length);
  const blockTint = new Float32Array(height.length);

  for (let py = 0; py < TEXTURE_SIZE; py++) {
    const rowIndex = Math.min(layout.blockRows - 1, Math.floor(py / layout.blockHeight));
    const row = layout.rows[rowIndex];
    const localY = py - row.y;
    const horizontalDistance = Math.min(localY, Math.abs(row.courseHeight - localY), layout.blockHeight - localY);
    for (let px = 0; px < TEXTURE_SIZE; px++) {
      const i = py * TEXTURE_SIZE + px;
      let verticalDistance = layout.blockWidth;
      for (const joint of row.joints) verticalDistance = Math.min(verticalDistance, Math.abs(px - joint.x) - joint.width * 0.5);
      const jointDistance = Math.min(horizontalDistance - row.horizontalJoint, verticalDistance);
      const mortarMask = 1 - smooth01(jointDistance / 3.0);
      const edgeBevel = smooth01(jointDistance / 4.8);

      const coarse = fbm2D(px / 71, py / 71, seed + 3001, 4);
      const meso = fbm2D(px / 19, py / 19, seed + 4001, 4);
      const fine = valueNoise2D(px / 4.2, py / 4.2, seed + 5001);
      const chipField = fbm2D(px / 8.5, py / 8.5, seed + 6001, 3);
      const chipMask = clamp01((0.53 - edgeBevel) * smooth01((chipField - 0.58) / 0.22) * 2.5);
      const vein = Math.abs(Math.sin((px * 0.029 + py * 0.021) + fbm2D(px / 42, py / 42, seed + 7001, 3) * 4.2));
      const mineralMask = smooth01((0.26 - vein) / 0.26) * (0.35 + row.mineral * 0.65);

      macro[i] = coarse;
      mortar[i] = mortarMask;
      chips[i] = chipMask;
      mineral[i] = mineralMask;
      blockTint[i] = row.tint;
      height[i] = clamp01(
        0.52
          + edgeBevel * 0.34
          - mortarMask * 0.39
          - chipMask * 0.20
          + (coarse - 0.5) * 0.10
          + (meso - 0.5) * 0.12
          + (fine - 0.5) * 0.045,
      );
    }
  }
  return Object.freeze({ height, mortar, chips, mineral, macro, blockTint });
}

function paintStoneColor(ctx, fields, baseColor, seed) {
  const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const srgb = baseColor.clone().convertLinearToSRGB();
  for (let py = 0; py < TEXTURE_SIZE; py++) {
    for (let px = 0; px < TEXTURE_SIZE; px++) {
      const i = py * TEXTURE_SIZE + px;
      const micro = valueNoise2D(px / 2.9, py / 2.9, seed + 8101) - 0.5;
      const damp = smooth01((0.52 - fields.macro[i]) / 0.36) * (0.35 + fields.mortar[i] * 0.65);
      const weather = fields.blockTint[i] + (fields.macro[i] - 0.5) * 0.13 + micro * 0.035;
      const faceShade = 0.86 + fields.height[i] * 0.20 + weather;
      const mortarShade = 0.58 + fields.macro[i] * 0.12;
      let r = srgb.r * faceShade;
      let g = srgb.g * faceShade;
      let b = srgb.b * faceShade;
      const mortarMix = fields.mortar[i] * 0.74;
      r = THREE.MathUtils.lerp(r, mortarShade * 0.72, mortarMix);
      g = THREE.MathUtils.lerp(g, mortarShade * 0.70, mortarMix);
      b = THREE.MathUtils.lerp(b, mortarShade * 0.66, mortarMix);
      const warmMineral = fields.mineral[i] * 0.075;
      r += warmMineral * 0.16;
      g += warmMineral * 0.075;
      b -= warmMineral * 0.055;
      const dampDarken = damp * 0.10;
      r *= 1 - dampDarken;
      g *= 1 - dampDarken * 0.88;
      b *= 1 - dampDarken * 0.72;
      const o = i * 4;
      image.data[o] = clamp01(r) * 255;
      image.data[o + 1] = clamp01(g) * 255;
      image.data[o + 2] = clamp01(b) * 255;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function paintStoneRoughness(ctx, fields, seed) {
  const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  for (let py = 0; py < TEXTURE_SIZE; py++) {
    for (let px = 0; px < TEXTURE_SIZE; px++) {
      const i = py * TEXTURE_SIZE + px;
      const meso = fbm2D(px / 16, py / 16, seed + 9101, 3) - 0.5;
      const fine = valueNoise2D(px / 3.1, py / 3.1, seed + 9203) - 0.5;
      const roughness = clamp(
        0.78
          + fields.mortar[i] * 0.16
          + fields.chips[i] * 0.07
          + meso * 0.13
          + fine * 0.06
          - fields.mineral[i] * 0.09,
        0.54,
        0.98,
      );
      const value = roughness * 255;
      const o = i * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = value;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function paintHeightNormal(ctx, height, strength, seed) {
  const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const at = (x, y) => height[((y + TEXTURE_SIZE) % TEXTURE_SIZE) * TEXTURE_SIZE + ((x + TEXTURE_SIZE) % TEXTURE_SIZE)];
  for (let py = 0; py < TEXTURE_SIZE; py++) {
    for (let px = 0; px < TEXTURE_SIZE; px++) {
      const microX = valueNoise2D((px + 1) / 2.6, py / 2.6, seed + 10101) - valueNoise2D((px - 1) / 2.6, py / 2.6, seed + 10101);
      const microY = valueNoise2D(px / 2.6, (py + 1) / 2.6, seed + 10101) - valueNoise2D(px / 2.6, (py - 1) / 2.6, seed + 10101);
      const dx = (at(px + 1, py) - at(px - 1, py)) * strength + microX * 0.12;
      const dy = (at(px, py + 1) - at(px, py - 1)) * strength + microY * 0.12;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const length = Math.max(1e-6, Math.hypot(nx, ny, nz));
      const i = (py * TEXTURE_SIZE + px) * 4;
      image.data[i] = (nx / length * 0.5 + 0.5) * 255;
      image.data[i + 1] = (ny / length * 0.5 + 0.5) * 255;
      image.data[i + 2] = (nz / length * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function installWorldSpaceMaterialBreakup(material, { seed, kind }) {
  const sourceCompile = material.onBeforeCompile?.bind(material);
  const sourceKey = material.customProgramCacheKey?.bind(material);
  const salt = ((seed >>> 0) % 7919) / 7919;
  material.userData ||= {};
  material.userData.settlementSurfaceRealism = Object.freeze({
    policyId: SETTLEMENT_SURFACE_REALISM_POLICY.id,
    kind,
    seed: seed >>> 0,
    worldSpace: true,
    deterministic: true,
  });
  material.onBeforeCompile = (shader, renderer) => {
    sourceCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSettlementWorldPosition;\nvarying vec3 vSettlementWorldNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvSettlementWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 settlementWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
settlementWorldPosition = instanceMatrix * settlementWorldPosition;
#endif
vSettlementWorldPosition = (modelMatrix * settlementWorldPosition).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSettlementWorldPosition;
varying vec3 vSettlementWorldNormal;
float settlementHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.11369));
  p += dot(p, p.yx + 31.32 + ${salt.toFixed(6)});
  return fract((p.x + p.y) * p.x);
}
float settlementNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = settlementHash(i); float b = settlementHash(i + vec2(1.0, 0.0));
  float c = settlementHash(i + vec2(0.0, 1.0)); float d = settlementHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 settlementXZ = vSettlementWorldPosition.xz;
float settlementMacro = settlementNoise(settlementXZ / ${kind === 'roof' ? '43.0' : '68.0'} + vec2(${(salt * 9.7).toFixed(5)}, ${(-salt * 7.3).toFixed(5)}));
float settlementMeso = settlementNoise(settlementXZ / ${kind === 'roof' ? '11.0' : '17.0'} + vec2(-8.1, 13.4));
float settlementFine = settlementNoise(settlementXZ / ${kind === 'roof' ? '2.7' : '3.6'} + vec2(19.2, -5.6));
float settlementUp = smoothstep(0.34, 0.88, normalize(vSettlementWorldNormal).y);
float settlementWeather = (settlementMacro - 0.5) * ${kind === 'roof' ? '0.13' : '0.10'} + (settlementMeso - 0.5) * ${kind === 'roof' ? '0.07' : '0.055'} + (settlementFine - 0.5) * 0.025;
diffuseColor.rgb *= 1.0 + settlementWeather;
${kind === 'roof'
  ? 'float settlementRunoff = smoothstep(0.62, 0.87, settlementMeso) * (1.0 - settlementUp * 0.42); diffuseColor.rgb *= 1.0 - settlementRunoff * 0.075;'
  : 'float settlementDamp = smoothstep(0.58, 0.86, 1.0 - settlementMacro) * (1.0 - settlementUp * 0.30); diffuseColor.rgb *= 1.0 - settlementDamp * 0.065;'}
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (settlementMacro - 0.5) * 0.10 + (settlementFine - 0.5) * 0.055 ${kind === 'roof' ? '- settlementUp * 0.025' : '+ (1.0 - settlementUp) * 0.025'}, 0.42, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float settlementNx = settlementNoise(settlementXZ / 1.35 + vec2(0.17, 0.0)) - settlementNoise(settlementXZ / 1.35 - vec2(0.17, 0.0));
float settlementNz = settlementNoise(settlementXZ / 1.35 + vec2(0.0, 0.17)) - settlementNoise(settlementXZ / 1.35 - vec2(0.0, 0.17));
normal = normalize(normal + mat3(viewMatrix) * vec3(settlementNx, 0.0, settlementNz) * ${kind === 'roof' ? '0.045' : '0.065'});`);
  };
  material.customProgramCacheKey = () => `${sourceKey?.() ?? ''}|settlement-realism-v2:${kind}:${seed >>> 0}`;
  material.needsUpdate = true;
  return material;
}

export function createStoneMaterial({ seed, baseColor, repeat = 12 }) {
  const layout = stoneLayout(seed);
  const fields = stoneHeightAndMasks(layout, seed);
  const color = canvas2D();
  const roughness = canvas2D();
  const normal = canvas2D();
  paintStoneColor(color.ctx, fields, baseColor, seed);
  paintStoneRoughness(roughness.ctx, fields, seed);
  paintHeightNormal(normal.ctx, fields.height, 5.4, seed);

  const map = finalizeTexture(new THREE.CanvasTexture(color.canvas), repeat, repeat, true);
  const roughnessMap = finalizeTexture(new THREE.CanvasTexture(roughness.canvas), repeat, repeat, false);
  const normalMap = finalizeTexture(new THREE.CanvasTexture(normal.canvas), repeat, repeat, false);
  const material = new THREE.MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    normalScale: new THREE.Vector2(0.72, 0.72),
    roughness: 0.82,
    metalness: 0.015,
  });
  return installWorldSpaceMaterialBreakup(material, { seed, kind: 'stone' });
}

function roofFields(seed, rowCount = 14) {
  const random = mulberry32(seed ^ 0x524f4f46);
  const height = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  const shade = new Float32Array(height.length);
  const roughness = new Float32Array(height.length);
  const rowHeight = TEXTURE_SIZE / rowCount;

  for (let py = 0; py < TEXTURE_SIZE; py++) {
    const row = Math.min(rowCount - 1, Math.floor(py / rowHeight));
    const localY = py - row * rowHeight;
    const stagger = row % 2 === 0 ? 0 : 8.5;
    const shingleWidth = 18 + ((row * 7 + seed) % 9);
    const rowVariation = (hash2(row, seed, seed + 12001) - 0.5) * 0.12;
    for (let px = 0; px < TEXTURE_SIZE; px++) {
      const i = py * TEXTURE_SIZE + px;
      const localX = fract((px + stagger) / shingleWidth) * shingleWidth;
      const verticalJoint = Math.min(localX, shingleWidth - localX);
      const bottomJoint = rowHeight - localY;
      const joint = Math.min(verticalJoint / 1.6, bottomJoint / 2.2);
      const bevel = smooth01(joint);
      const warped = fbm2D(px / 23, py / 29, seed + 13001, 4);
      const fine = valueNoise2D(px / 3.8, py / 4.7, seed + 14009);
      height[i] = clamp01(0.48 + bevel * 0.34 + (warped - 0.5) * 0.16 + (fine - 0.5) * 0.05);
      shade[i] = clamp01(0.82 + rowVariation + (warped - 0.5) * 0.16 - (1 - bevel) * 0.22);
      roughness[i] = clamp(0.64 + (fine - 0.5) * 0.12 + (warped - 0.5) * 0.10 + (1 - bevel) * 0.10, 0.48, 0.90);
    }
  }
  return Object.freeze({ height, shade, roughness });
}

export function createRoofMaterial({ seed, repeat = 6 }) {
  const fields = roofFields(seed);
  const color = canvas2D();
  const roughness = canvas2D();
  const normal = canvas2D();
  const colorImage = color.ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  const roughImage = roughness.ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);
  for (let i = 0; i < fields.height.length; i++) {
    const mineral = fields.shade[i];
    const warmth = (fields.height[i] - 0.5) * 0.06;
    const r = clamp01(mineral * 0.88 + warmth);
    const g = clamp01(mineral * 0.91 + warmth * 0.55);
    const b = clamp01(mineral * 0.96 - warmth * 0.25);
    const o = i * 4;
    colorImage.data[o] = r * 255;
    colorImage.data[o + 1] = g * 255;
    colorImage.data[o + 2] = b * 255;
    colorImage.data[o + 3] = 255;
    const rv = fields.roughness[i] * 255;
    roughImage.data[o] = roughImage.data[o + 1] = roughImage.data[o + 2] = rv;
    roughImage.data[o + 3] = 255;
  }
  color.ctx.putImageData(colorImage, 0, 0);
  roughness.ctx.putImageData(roughImage, 0, 0);
  paintHeightNormal(normal.ctx, fields.height, 4.1, seed + 15013);

  const map = finalizeTexture(new THREE.CanvasTexture(color.canvas), repeat, repeat, true);
  const roughnessMap = finalizeTexture(new THREE.CanvasTexture(roughness.canvas), repeat, repeat, false);
  const normalMap = finalizeTexture(new THREE.CanvasTexture(normal.canvas), repeat, repeat, false);
  const material = new THREE.MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughness: 0.67,
    metalness: 0.035,
  });
  return installWorldSpaceMaterialBreakup(material, { seed, kind: 'roof' });
}

export function disposeCastleMaterial(material) {
  if (!material) return;
  material.map?.dispose?.();
  material.roughnessMap?.dispose?.();
  material.normalMap?.dispose?.();
  material.aoMap?.dispose?.();
  material.dispose?.();
}

/**
 * Makes imported meshes renderable with generated maps by filling missing normals and deterministic
 * dominant-axis UVs. Existing authored UVs/normals are preserved exactly. Texture scale is expressed
 * in real-world metres so model scale does not stretch masonry courses into giant wallpaper blocks.
 */
export function prepareImportedGeometryForTexturing(model, { modelScale, metersPerTile = 4 }) {
  let meshes = 0;
  let uvsGenerated = 0;
  let normalsComputed = 0;
  const safeScale = Math.max(1e-6, Math.abs(Number(modelScale) || 1));
  const tile = Math.max(0.1, Number(metersPerTile) || 4) / safeScale;

  model.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;
    meshes++;
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
      normalsComputed++;
    }
    if (geometry.attributes.uv) return;

    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const nx = Math.abs(normal.getX(i));
      const ny = Math.abs(normal.getY(i));
      const nz = Math.abs(normal.getZ(i));
      let u;
      let v;
      if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else if (nx >= nz) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      uv[i * 2] = u / tile;
      uv[i * 2 + 1] = v / tile;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    uvsGenerated++;
  });

  return { meshes, uvsGenerated, normalsComputed };
}
