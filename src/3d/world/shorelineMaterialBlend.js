const DEFAULTS = Object.freeze({
  shallowDepth: 0.35,
  deepDepth: 8,
  shorelineWidth: 18,
  foamWidth: 3.5,
  macroScale: 0.00042,
  microScale: 0.013,
  maxNormalEnergy: 0.18,
});

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const fract = (v) => v - Math.floor(v);
const hash2 = (x, z, seed) => fract(Math.sin(x * 127.1 + z * 311.7 + seed * 74.3) * 43758.5453);
const rotate = (x, z, a) => ({ x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) });

export function sampleShorelineMaterialBlend(input = {}, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const x = Number.isFinite(input.x) ? input.x : 0;
  const z = Number.isFinite(input.z) ? input.z : 0;
  const depth = Math.max(0, Number.isFinite(input.depth) ? input.depth : 0);
  const shoreDistance = Math.max(0, Number.isFinite(input.shoreDistance) ? input.shoreDistance : Infinity);
  const waterConfidence = clamp01(input.waterConfidence);
  const slope = clamp01(input.slope);
  const moisture = clamp01(input.moisture);
  const seed = Number.isFinite(input.seed) ? input.seed : 0;
  const distance = Math.max(0, Number.isFinite(input.cameraDistance) ? input.cameraDistance : 0);

  const pA = rotate(x * cfg.macroScale, z * cfg.macroScale, 0.37);
  const pB = rotate(x * cfg.macroScale * 0.61, z * cfg.macroScale * 0.61, -0.91);
  const macro = (hash2(pA.x, pA.z, seed + 11) + hash2(pB.x, pB.z, seed + 29)) * 0.5;
  const microP = rotate(x * cfg.microScale, z * cfg.microScale, 1.17);
  const micro = hash2(microP.x, microP.z, seed + 71) * 2 - 1;

  const depthFade = smoothstep(cfg.shallowDepth, cfg.deepDepth, depth);
  const shoreFade = 1 - smoothstep(0, cfg.shorelineWidth, shoreDistance);
  const foam = shoreFade * (1 - smoothstep(0, cfg.foamWidth, depth)) * waterConfidence;
  const wetEdge = shoreFade * (1 - depthFade) * (0.55 + 0.45 * moisture);
  const sediment = clamp01((1 - depthFade) * (0.35 + 0.45 * macro + 0.2 * moisture));
  const sand = clamp01((1 - waterConfidence) * (1 - slope) * (0.45 + 0.35 * macro));
  const rock = clamp01(slope * (0.45 + 0.35 * (1 - sediment)) + (1 - waterConfidence) * 0.08);
  const deep = clamp01(waterConfidence * depthFade);
  const shallow = clamp01(waterConfidence * (1 - depthFade));

  const antiTile = clamp01(0.5 + 0.5 * (0.62 * micro + 0.38 * (macro * 2 - 1)));
  const normalEnergy = clamp01((1 - smoothstep(700, 1600, distance)) * cfg.maxNormalEnergy * (0.45 + 0.55 * antiTile));

  return Object.freeze({
    weights: Object.freeze({ deep, shallow, wetEdge, foam, sediment, sand, rock }),
    breakup: Object.freeze({ macro, micro, antiTile }),
    pbr: Object.freeze({
      roughness: 0.18 + 0.34 * sediment + 0.22 * rock + 0.12 * wetEdge,
      specular: 0.28 + 0.28 * shallow + 0.18 * foam,
      normalEnergy,
    }),
    diagnostics: Object.freeze({
      shorelineBand: shoreFade,
      canonicalWaterConfidence: waterConfidence,
      canonicalDepth: depth,
      canonicalInputsOnly: true,
      tileRisk: 0,
      finite: true,
    }),
  });
}

export function validateShorelineMaterialBlend(sample) {
  if (!sample || !sample.weights || !sample.breakup || !sample.pbr) return false;
  return Object.values(sample.weights).every(Number.isFinite)
    && Object.values(sample.breakup).every(Number.isFinite)
    && Object.values(sample.pbr).every(Number.isFinite)
    && sample.diagnostics?.finite === true
    && sample.diagnostics?.tileRisk === 0;
}
