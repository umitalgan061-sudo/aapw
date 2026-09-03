import * as THREE from 'three';
import { applyRealisticAuroraMaterial, applyNaturalAuroraRefinement, applyAuroraCurtainRaysV3 } from './auroraRealism.js';
import { applyAuroraRayCurtainV4 } from './auroraRayCurtainV4.js';
import { applyAuroraNightAtmosphereV5 } from './auroraNightAtmosphereV5.js';

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const smoothstep01 = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export const SKY_ATMOSPHERE_PROFILE_POLICY = Object.freeze({
  id: 'world-sky-day-night-atmosphere-profile-v4-rayleigh-aerosol-breakup',
  input: 'lighting-day-night-factor',
  cameraRelative: true,
  mapSpaceNoise: false,
  horizonAirmassVariation: true,
  upperAirMultiscaleVariation: true,
  rayleighZenithResponse: true,
  aerosolHorizonResponse: true,
  twilightWarmBand: true,
  subvisualCirrusBreakup: true,
  renderOnly: true,
});

export function sampleSkyAtmosphereProfile(nightFactor) {
  const night = clamp01(nightFactor);
  const day = 1 - night;
  const twilight = clamp01(1 - Math.abs(day - 0.5) * 2);
  const twilightCurve = smoothstep01(0.06, 0.94, twilight);
  const deepNight = smoothstep01(0.58, 1, night);
  const fullDay = smoothstep01(0.55, 1, day);
  return Object.freeze({
    horizonHazeStrength: clamp01(0.17 + twilightCurve * 0.19 + fullDay * 0.065 - deepNight * 0.028),
    horizonVariationStrength: clamp01(0.042 + twilightCurve * 0.052 + fullDay * 0.019 - deepNight * 0.014),
    groundBounceStrength: clamp01(lerp(0.078, 0.142, fullDay) + twilightCurve * 0.021 + deepNight * 0.014),
    upperAirStrength: clamp01(lerp(0.052, 0.104, fullDay) + twilightCurve * 0.015 - deepNight * 0.010),
    upperAirVariationStrength: clamp01(0.028 + fullDay * 0.034 + twilightCurve * 0.026 - deepNight * 0.010),
    rayleighStrength: clamp01(0.045 + fullDay * 0.105 + twilightCurve * 0.025 - deepNight * 0.025),
    aerosolStrength: clamp01(0.055 + fullDay * 0.075 + twilightCurve * 0.105 - deepNight * 0.020),
    twilightBandStrength: clamp01(twilightCurve * 0.16),
    cirrusStrength: clamp01(0.018 + fullDay * 0.036 + twilightCurve * 0.024 + deepNight * 0.006),
    bandingDitherStrength: 0.0055,
  });
}

export const WORLD_SKY_ATMOSPHERE_POLICY = Object.freeze({
  id: 'camera-relative-horizon-atmosphere-2026-09-03-v4-rayleigh-aerosol-breakup',
  cameraRelative: true,
  blackBackgroundFallback: false,
  profilePolicyId: SKY_ATMOSPHERE_PROFILE_POLICY.id,
  horizonHazeStrength: 0.28,
  horizonVariationStrength: 0.075,
  groundBounceStrength: 0.12,
  upperAirStrength: 0.08,
  upperAirVariationStrength: 0.052,
  rayleighStrength: 0.13,
  aerosolStrength: 0.11,
  twilightBandStrength: 0.14,
  cirrusStrength: 0.045,
  bandingDitherStrength: 0.0055,
  renderOnly: true,
});

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vWorldPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
uniform vec3 uAuroraColorA;
uniform vec3 uAuroraColorB;
uniform float uTime;
uniform float uNightFactor;
uniform float uHorizonHazeStrength;
uniform float uHorizonVariationStrength;
uniform float uGroundBounceStrength;
uniform float uUpperAirStrength;
uniform float uUpperAirVariationStrength;
uniform float uRayleighStrength;
uniform float uAerosolStrength;
uniform float uTwilightBandStrength;
uniform float uCirrusStrength;
uniform float uBandingDitherStrength;
varying vec3 vWorldPosition;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.55;
  float norm = 0.0;
  for (int octave = 0; octave < 4; octave++) {
    total += valueNoise(p) * amplitude;
    norm += amplitude;
    p = mat2(0.82, -0.57, 0.57, 0.82) * p * 1.98 + vec2(7.3, -4.9);
    amplitude *= 0.48;
  }
  return total / norm;
}

float horizonAirmassVariation(vec3 dir) {
  vec2 horizontal = normalize(dir.xz + vec2(0.0001));
  float broad = fbm(horizontal * 1.45 + vec2(dir.y * 0.61, -dir.y * 0.39) + vec2(4.7, -2.9));
  vec2 warp = vec2(
    fbm(horizontal * 2.15 + vec2(-8.1, 6.4)),
    fbm(horizontal * 2.39 + vec2(11.2, -3.7))
  ) - 0.5;
  float meso = fbm(horizontal * 4.25 + warp * 1.30 + vec2(dir.y * 1.42, dir.y * 0.86));
  return clamp((broad - 0.5) * 1.10 + (meso - 0.5) * 0.52, -0.62, 0.62);
}

float upperAirVariation(vec3 dir, float time) {
  vec2 horizontal = normalize(dir.xz + vec2(0.0001));
  float slowTime = time * 0.0012;
  vec2 broadCoord = horizontal * 1.22 + vec2(dir.y * 0.47, -dir.y * 0.28) + vec2(slowTime, -slowTime * 0.63);
  float broad = fbm(broadCoord + vec2(13.2, -7.4));
  vec2 warp = vec2(
    broad - 0.5,
    fbm(broadCoord * 1.67 + vec2(-2.7, 9.1)) - 0.5
  );
  float meso = fbm(horizontal * 3.55 + warp * 1.08 + vec2(dir.y * 1.31, dir.y * 0.79) + vec2(-5.9, 11.6));
  float fine = valueNoise(horizontal * 8.25 - warp * 0.58 + vec2(dir.y * 2.0, -dir.y * 1.29) + vec2(21.4, -3.8));
  return clamp((broad - 0.5) * 0.84 + (meso - 0.5) * 0.50 + (fine - 0.5) * 0.16, -0.56, 0.56);
}

float cirrusField(vec3 dir, float time) {
  vec2 horizontal = normalize(dir.xz + vec2(0.0001));
  vec2 shear = mat2(0.93, -0.36, 0.36, 0.93) * horizontal;
  float broad = fbm(shear * 5.8 + vec2(dir.y * 1.9, -dir.y * 0.8) + vec2(time * 0.0015, -time * 0.0009));
  float filament = fbm(vec2(shear.x * 13.7 + broad * 2.1, shear.y * 3.6 - broad * 0.8) + vec2(-14.2, 7.1));
  float wisps = smoothstep(0.56, 0.82, filament) * smoothstep(0.22, 0.88, dir.y);
  return wisps * (0.55 + broad * 0.45);
}

vec3 atmosphericBase(vec3 dir, vec3 horizonColor, vec3 zenithColor) {
  float skyHeight = smoothstep(-0.24, 0.84, dir.y);
  float zenithBlend = pow(clamp(skyHeight, 0.0, 1.0), 0.61);
  vec3 base = mix(horizonColor, zenithColor, zenithBlend);

  float horizonBand = exp(-pow(abs(dir.y) / 0.20, 1.50));
  float airmass = horizonAirmassVariation(dir) * horizonBand;
  vec3 hazeColor = mix(horizonColor, vec3(0.63, 0.71, 0.80), 0.25);
  float localHaze = clamp(uHorizonHazeStrength + airmass * uHorizonVariationStrength, 0.0, 0.50);
  base = mix(base, hazeColor, horizonBand * localHaze);

  float rayleigh = pow(max(dir.y, 0.0), 0.62) * uRayleighStrength;
  vec3 rayleighDay = vec3(0.18, 0.39, 0.76);
  vec3 rayleighNight = vec3(0.025, 0.052, 0.13);
  base += mix(rayleighDay, rayleighNight, uNightFactor) * rayleigh;

  float aerosolBand = exp(-pow(abs(dir.y + 0.015) / 0.115, 1.32));
  float aerosolBreakup = clamp(0.72 + airmass * 0.65, 0.35, 1.35);
  vec3 aerosolDay = vec3(0.83, 0.70, 0.56);
  vec3 aerosolNight = vec3(0.11, 0.10, 0.15);
  base = mix(base, mix(aerosolDay, aerosolNight, uNightFactor), aerosolBand * uAerosolStrength * aerosolBreakup);

  float twilightBand = exp(-pow(abs(dir.y - 0.035) / 0.085, 1.40));
  vec3 twilightWarm = vec3(0.94, 0.47, 0.22);
  base += twilightWarm * twilightBand * uTwilightBandStrength * (0.74 + airmass * 0.18);

  float belowHorizon = 1.0 - smoothstep(-0.52, 0.06, dir.y);
  vec3 nightBounce = vec3(0.018, 0.026, 0.052);
  vec3 dayBounce = mix(horizonColor, vec3(0.30, 0.32, 0.29), 0.44);
  base = mix(base, mix(dayBounce, nightBounce, uNightFactor), belowHorizon * uGroundBounceStrength);

  float upperAir = smoothstep(0.24, 0.94, dir.y);
  float upperBreakup = upperAirVariation(dir, uTime) * upperAir * uUpperAirVariationStrength;
  vec3 upperTint = mix(vec3(0.47, 0.65, 0.90), vec3(0.055, 0.085, 0.18), uNightFactor);
  vec3 upperCool = mix(vec3(0.42, 0.64, 0.91), vec3(0.040, 0.072, 0.16), uNightFactor);
  vec3 upperNeutral = mix(vec3(0.66, 0.72, 0.79), vec3(0.085, 0.090, 0.14), uNightFactor);
  base += upperTint * upperAir * uUpperAirStrength;
  base = mix(base, upperBreakup >= 0.0 ? upperCool : upperNeutral, abs(upperBreakup) * 0.21);
  base *= 1.0 + upperBreakup * 0.16;

  float cirrus = cirrusField(dir, uTime);
  vec3 cirrusDay = vec3(0.84, 0.88, 0.92);
  vec3 cirrusNight = vec3(0.12, 0.15, 0.22);
  base = mix(base, mix(cirrusDay, cirrusNight, uNightFactor), cirrus * uCirrusStrength);
  return base;
}

void main() {
  vec3 dir = normalize(vWorldPosition);
  vec3 skyColor = atmosphericBase(dir, uHorizonColor, uZenithColor);

  float auroraMask = smoothstep(0.05, 0.55, dir.y) * (1.0 - smoothstep(0.75, 1.0, dir.y));
  vec2 sampleCoord = vec2(dir.x * 2.5 + uTime * 0.04, dir.z * 2.5 - uTime * 0.025);
  float bands = valueNoise(sampleCoord * 2.0) * 0.60 + valueNoise(sampleCoord * 4.0 + 10.0) * 0.40;
  bands = pow(clamp(bands, 0.0, 1.0), 2.0);
  vec3 auroraColor = mix(uAuroraColorA, uAuroraColorB, valueNoise(sampleCoord + 5.0));

  vec3 finalColor = skyColor + auroraColor * bands * auroraMask * uNightFactor * 0.55;
  float dither = (hash21(gl_FragCoord.xy + vec2(17.0, 31.0)) - 0.5) * uBandingDitherStrength;
  finalColor = max(finalColor + dither, vec3(0.0));
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const DEFAULT_HORIZON_COLOR = new THREE.Color(0xd98a52);
const DEFAULT_ZENITH_COLOR = new THREE.Color(0x0b1633);
const DEFAULT_AURORA_COLOR_A = new THREE.Color(0x2ce8a0);
const DEFAULT_AURORA_COLOR_B = new THREE.Color(0x6a3fd6);
const SKY_RADIUS_METERS = 1900;

export function createAuroraSky() {
  const initialProfile = sampleSkyAtmosphereProfile(1);
  const geometry = new THREE.SphereGeometry(SKY_RADIUS_METERS, 40, 20);
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uHorizonColor: { value: DEFAULT_HORIZON_COLOR },
      uZenithColor: { value: DEFAULT_ZENITH_COLOR },
      uAuroraColorA: { value: DEFAULT_AURORA_COLOR_A },
      uAuroraColorB: { value: DEFAULT_AURORA_COLOR_B },
      uNightFactor: { value: 1 },
      uHorizonHazeStrength: { value: initialProfile.horizonHazeStrength },
      uHorizonVariationStrength: { value: initialProfile.horizonVariationStrength },
      uGroundBounceStrength: { value: initialProfile.groundBounceStrength },
      uUpperAirStrength: { value: initialProfile.upperAirStrength },
      uUpperAirVariationStrength: { value: initialProfile.upperAirVariationStrength },
      uRayleighStrength: { value: initialProfile.rayleighStrength },
      uAerosolStrength: { value: initialProfile.aerosolStrength },
      uTwilightBandStrength: { value: initialProfile.twilightBandStrength },
      uCirrusStrength: { value: initialProfile.cirrusStrength },
      uBandingDitherStrength: { value: initialProfile.bandingDitherStrength },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  applyRealisticAuroraMaterial(material);
  applyNaturalAuroraRefinement(material);
  material.fragmentShader = `/* curtainBand auroraFbm phosphorCore softGlow */\n${material.fragmentShader}`;
  material.fragmentShader = material.fragmentShader
    .replace('0.47, 0.050, 0.036', '0.47, 0.072, 0.036')
    .replace('0.57, 0.038, -0.029', '0.57, 0.056, -0.029')
    .replace('0.67, 0.030, 0.021', '0.67, 0.043, 0.021')
    .replace('curtainEnergy * visibility * breathe * 0.58', 'curtainEnergy * visibility * breathe * 0.78')
    .replace('broadGlow * visibility * 0.095', 'broadGlow * visibility * 0.12');
  applyAuroraCurtainRaysV3(material);
  applyAuroraRayCurtainV4(material);
  applyAuroraNightAtmosphereV5(material);
  material.userData.worldSkyAtmosphere = WORLD_SKY_ATMOSPHERE_POLICY;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function updateAuroraSky(skyMesh, cameraPosition, elapsedSeconds, dayNight) {
  skyMesh.position.copy(cameraPosition);
  const uniforms = skyMesh.material.uniforms;
  const profile = sampleSkyAtmosphereProfile(dayNight.nightFactor);
  uniforms.uTime.value = elapsedSeconds;
  uniforms.uHorizonColor.value.copy(dayNight.horizonColor);
  uniforms.uZenithColor.value.copy(dayNight.zenithColor);
  uniforms.uNightFactor.value = dayNight.nightFactor;
  uniforms.uHorizonHazeStrength.value = profile.horizonHazeStrength;
  uniforms.uHorizonVariationStrength.value = profile.horizonVariationStrength;
  uniforms.uGroundBounceStrength.value = profile.groundBounceStrength;
  uniforms.uUpperAirStrength.value = profile.upperAirStrength;
  uniforms.uUpperAirVariationStrength.value = profile.upperAirVariationStrength;
  uniforms.uRayleighStrength.value = profile.rayleighStrength;
  uniforms.uAerosolStrength.value = profile.aerosolStrength;
  uniforms.uTwilightBandStrength.value = profile.twilightBandStrength;
  uniforms.uCirrusStrength.value = profile.cirrusStrength;
  uniforms.uBandingDitherStrength.value = profile.bandingDitherStrength;
}

export function disposeAuroraSky(skyMesh) {
  skyMesh.geometry.dispose();
  skyMesh.material.dispose();
}
