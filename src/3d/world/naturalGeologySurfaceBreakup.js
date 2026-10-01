/**
 * Render-only geology surface breakup helpers.
 *
 * This module deliberately changes material response and local relief only; canonical terrain,
 * hydrology, collider height and placement coordinates remain authoritative elsewhere.
 */

import * as THREE from 'three';

export const NATURAL_GEOLOGY_SURFACE_BREAKUP_POLICY = Object.freeze({
  id: 'natural-geology-surface-breakup-2026-09-08-v1',
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  macroBands: 3,
  microFrequency: 11,
  minimumRoughness: 0.84,
  maximumDisplacementMeters: 0.035,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function geologyBreakupSignal(x, y, z) {
  const macro = Math.sin(x * 2.17 + z * 1.31) * 0.5
    + Math.sin(z * 3.41 - x * 1.19) * 0.3
    + Math.sin((x + z) * 0.71) * 0.2;
  const micro = Math.sin(x * 17.0 + z * 11.0) * Math.sin(z * 13.0 - x * 7.0);
  const elevation = clamp01(0.5 + y * 0.85);
  return clamp01(0.5 + macro * 0.34 + micro * 0.08 + (elevation - 0.5) * 0.18);
}

export function applyGeologyVertexBreakup(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position) return geometry;
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const signal = geologyBreakupSignal(x, y, z);
    const offset = index * 3;
    colors[offset] = 0.74 + signal * 0.23;
    colors[offset + 1] = 0.72 + signal * 0.22;
    colors[offset + 2] = 0.68 + signal * 0.18;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.attributes.color.needsUpdate = true;
  return geometry;
}

export function createGeologyBreakupMaterial(baseColor = 0x66615a) {
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: NATURAL_GEOLOGY_SURFACE_BREAKUP_POLICY.minimumRoughness,
    metalness: 0,
    flatShading: false,
    vertexColors: true,
  });
  material.userData = {
    ...(material.userData ?? {}),
    naturalGeology: true,
    macroBreakup: true,
    microBreakup: true,
    canonicalHeightUnchanged: true,
  };
  return material;
}
