#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  installNaturalSurfaceMaterial,
  NATURAL_SURFACE_MATERIAL_POLICY,
} from '../src/3d/world/naturalSurfaceMaterial.js';
import {
  VALYRIA_GEOLOGY_POLICY,
  valyriaInfluence01,
  valyriaMorphologySignals,
  valyriaSurfaceWeights,
} from '../src/3d/world/valyriaGeology.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => {
  const t = clamp01((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const fixed = (value) => Number(value).toFixed(8);

assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.renderOnly, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.canonicalHeightUnchanged, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.canonicalHydrologyUnchanged, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.canonicalColliderUnchanged, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.valyriaAuthorityPolicyId, VALYRIA_GEOLOGY_POLICY.id);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.valyriaMorphologyAligned, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.faultStrikeAlignedSurface, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.drainageAlignedSurface, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.calderaShoulderAlignedSurface, true);
assert.equal(NATURAL_SURFACE_MATERIAL_POLICY.erosionGullyAlignedSurface, true);

function compileShader() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, metalness: 0 });
  installNaturalSurfaceMaterial(material);
  const shader = {
    vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n}',
  };
  material.onBeforeCompile(shader, {});
  material.dispose();
  return shader;
}

const shaderA = compileShader();
const shaderB = compileShader();
assert.equal(shaderA.fragmentShader, shaderB.fragmentShader, 'morphology-aligned shader generation is not deterministic');
assert.equal(shaderA.vertexShader, shaderB.vertexShader, 'morphology-aligned vertex generation is not deterministic');

for (const token of [
  'naturalSurfaceValyriaHash',
  'naturalSurfaceValyriaSignedFbm2',
  'naturalSurfaceValyriaSignedFbm3',
  'naturalSurfaceValyriaFrame',
  'naturalSurfaceValyriaMorphology',
  'naturalSurfaceValyriaStructuralRelief',
  'naturalSurfaceFault',
  'naturalSurfaceDrainage',
  'naturalSurfaceGully',
  'naturalSurfaceCalderaShoulder',
  'naturalSurfaceRoughMorph',
  'naturalSurfaceStructuralCenter',
]) assert(shaderA.fragmentShader.includes(token), `surface shader lost canonical morphology marker ${token}`);

for (const numeric of [
  fixed(VALYRIA_GEOLOGY_POLICY.faultStrikeRadians),
  fixed(VALYRIA_GEOLOGY_POLICY.faultScarpAlongFrequency),
  fixed(VALYRIA_GEOLOGY_POLICY.faultScarpAcrossFrequency),
  fixed(VALYRIA_GEOLOGY_POLICY.calderaFrequency),
  fixed(VALYRIA_GEOLOGY_POLICY.lavaDrainageFrequency),
  fixed(VALYRIA_GEOLOGY_POLICY.erosionGullyFrequency),
]) assert(shaderA.fragmentShader.includes(numeric), `surface shader no longer embeds canonical Valyria policy value ${numeric}`);

assert(!shaderA.vertexShader.includes('transformed +='), 'surface alignment must not displace canonical terrain');
assert(!shaderA.fragmentShader.includes('gl_FragDepth'), 'surface alignment must not rewrite canonical depth');
assert(!shaderA.fragmentShader.includes('float naturalSurfaceFlow = naturalSurfaceFbm(vec2('),
  'province-scale Valyria flow reverted to an unrelated render-only FBM field');

const strongDrainage = [];
const quietDrainage = [];
const strongFault = [];
const quietFault = [];
const shoulder = [];
const gullies = [];
const repeats = [];

for (let iy = 0; iy <= 80; iy += 1) {
  const ny = 0.61 + (iy / 80) * 0.22;
  for (let ix = 0; ix <= 80; ix += 1) {
    const nx = 0.35 + (ix / 80) * 0.19;
    const influence = valyriaInfluence01(nx, ny);
    if (influence < 0.12) continue;
    const a = valyriaMorphologySignals(nx, ny);
    const b = valyriaMorphologySignals(nx, ny);
    assert.deepEqual(a, b, `canonical Valyria morphology is not deterministic at ${nx},${ny}`);

    // Mirror only the structural part of the shader material response. Micro/deposition noise is
    // intentionally excluded: this check proves province-scale material placement follows terrain.
    const slope = 0.34;
    const ashProxy = smoothstep(0.40, 0.72, 0.50 * 0.58 + (1 - a.lavaDrainage) * 0.20 + a.erosionGully * 0.22)
      * (1 - slope * 0.52);
    const obsidianProxy = smoothstep(0.22, 0.78, a.lavaDrainage * 0.86 + a.faultActivity * 0.26)
      * (1 - ashProxy * 0.72) * (0.40 + slope * 0.60);
    const oxidationProxy = smoothstep(0.42, 0.78, a.faultActivity * 0.72 + 0.50 * 0.32)
      * smoothstep(0.10, 0.52, slope);

    if (a.lavaDrainage >= 0.62) strongDrainage.push(obsidianProxy);
    if (a.lavaDrainage <= 0.035 && a.faultActivity < 0.30) quietDrainage.push(obsidianProxy);
    if (a.faultActivity >= 0.62) strongFault.push(oxidationProxy);
    if (a.faultActivity <= 0.04) quietFault.push(oxidationProxy);
    if (a.brokenCalderaShoulder >= 0.35) shoulder.push(a.brokenCalderaShoulder);
    if (a.erosionGully >= 0.55) gullies.push(a.erosionGully);
    repeats.push(a.lavaDrainage + a.faultActivity * 0.37 + a.brokenCalderaShoulder * 0.19);
  }
}

assert(strongDrainage.length >= 10, `too few canonical lava-drainage samples: ${strongDrainage.length}`);
assert(quietDrainage.length >= 50, `too few quiet interfluve samples: ${quietDrainage.length}`);
assert(strongFault.length >= 10, `too few active-fault samples: ${strongFault.length}`);
assert(quietFault.length >= 30, `too few quiet-fault samples: ${quietFault.length}`);
assert(shoulder.length >= 10, `broken caldera shoulders disappeared: ${shoulder.length}`);
assert(gullies.length >= 5, `erosion gullies disappeared: ${gullies.length}`);

const strongDrainageMean = mean(strongDrainage);
const quietDrainageMean = mean(quietDrainage);
const strongFaultMean = mean(strongFault);
const quietFaultMean = mean(quietFault);
assert(strongDrainageMean > quietDrainageMean + 0.16,
  `obsidian material no longer follows lava drainage: ${strongDrainageMean} vs ${quietDrainageMean}`);
assert(strongFaultMean > quietFaultMean + 0.12,
  `oxidized/faulted material no longer follows canonical faults: ${strongFaultMean} vs ${quietFaultMean}`);

// CPU colour authority is independently tied to the same drainage/fault values. Strong channels must
// receive materially more lava weight than quiet interfluves, ensuring terrain vertex colour and PBR
// surface are not telling contradictory geological stories.
const cpuStrongLava = [];
const cpuQuietLava = [];
for (let iy = 0; iy <= 54; iy += 1) {
  const ny = 0.63 + (iy / 54) * 0.18;
  for (let ix = 0; ix <= 54; ix += 1) {
    const nx = 0.37 + (ix / 54) * 0.16;
    if (valyriaInfluence01(nx, ny) < 0.18) continue;
    const morphology = valyriaMorphologySignals(nx, ny);
    const weights = valyriaSurfaceWeights({ nx, ny, heightAboveSeaMeters: 150, concavityMeters: 0.55, slopeDegrees: 12 });
    if (morphology.lavaDrainage >= 0.62) cpuStrongLava.push(weights.lava + weights.cooledLava * 0.45);
    if (morphology.lavaDrainage <= 0.035 && morphology.faultActivity < 0.30) cpuQuietLava.push(weights.lava + weights.cooledLava * 0.45);
  }
}
assert(cpuStrongLava.length >= 5 && cpuQuietLava.length >= 20, 'insufficient CPU Valyria surface samples');
assert(mean(cpuStrongLava) > mean(cpuQuietLava) + 0.18, 'canonical vertex colour lava response lost drainage alignment');

console.log('[checkValyriaSurfaceMorphologyAlignment] PASS');
console.log(JSON.stringify({
  materialPolicyId: NATURAL_SURFACE_MATERIAL_POLICY.id,
  geologyPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  sampledStructuralPoints: repeats.length,
  strongDrainageSamples: strongDrainage.length,
  quietDrainageSamples: quietDrainage.length,
  strongDrainageObsidianMean: Number(strongDrainageMean.toFixed(4)),
  quietDrainageObsidianMean: Number(quietDrainageMean.toFixed(4)),
  strongFaultSamples: strongFault.length,
  quietFaultSamples: quietFault.length,
  strongFaultOxidationMean: Number(strongFaultMean.toFixed(4)),
  quietFaultOxidationMean: Number(quietFaultMean.toFixed(4)),
  brokenShoulderSamples: shoulder.length,
  gullySamples: gullies.length,
  cpuStrongLavaMean: Number(mean(cpuStrongLava).toFixed(4)),
  cpuQuietLavaMean: Number(mean(cpuQuietLava).toFixed(4)),
}, null, 2));
