import assert from 'node:assert/strict';
import { createAtmosphericPerspectiveDirector, ATMOSPHERIC_PERSPECTIVE_DEFAULTS } from '../src/3d/world/atmosphericPerspectiveDirector.js';

class Color {
  constructor(hex = 0) {
    this.isColor = true;
    this.setHex(hex);
  }
  setHex(hex) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  clone() { return new Color().setRGB(this.r, this.g, this.b); }
  copy(value) { return this.setRGB(value.r, value.g, value.b); }
  multiplyScalar(value) { this.r *= value; this.g *= value; this.b *= value; return this; }
  lerp(value, alpha) { this.r += (value.r - this.r) * alpha; this.g += (value.g - this.g) * alpha; this.b += (value.b - this.b) * alpha; return this; }
  setHSL(h, s, l) { this.r = l; this.g = l * (1 - s * 0.5); this.b = l * (1 - s); return this; }
}

const THREE = { Color };
const makeScene = () => ({ background: new Color(0), fog: { color: new Color(0), near: 0, far: 1 }, userData: {} });
const makeLights = () => ({ hemisphere: { color: new Color(0), groundColor: new Color(0), intensity: 0 }, sun: { color: new Color(0), intensity: 0 } });
const makeDirector = () => {
  const scene = makeScene();
  const camera = { position: { y: 700 } };
  const renderer = { toneMappingExposure: 1 };
  const lights = makeLights();
  const director = createAtmosphericPerspectiveDirector({ THREE, scene, camera, renderer, lights });
  return { director, scene, camera, renderer, lights };
};

const a = makeDirector();
const day = a.director.update({ hour: 12, deltaSeconds: 1 / 60 });
assert.equal(Number.isFinite(day.exposure), true);
assert.equal(Number.isFinite(day.fog.near), true);
assert.equal(Number.isFinite(day.fog.far), true);
assert.equal(day.fog.far > day.fog.near, true);
assert.equal(a.scene.background.r >= ATMOSPHERIC_PERSPECTIVE_DEFAULTS.minBackgroundLuma, true);

const first = a.director.update({ hour: 23, deltaSeconds: 0 });
const second = a.director.update({ hour: 23, deltaSeconds: 0 });
assert.deepEqual(first, second);
assert.equal(a.scene.fog.far > a.scene.fog.near, true);
assert.equal(a.renderer.toneMappingExposure >= ATMOSPHERIC_PERSPECTIVE_DEFAULTS.minExposure, true);

const b = makeDirector();
const repeat = b.director.update({ hour: 23, deltaSeconds: 0 });
assert.deepEqual(repeat, second);
assert.deepEqual(b.scene.background, a.scene.background);

const malformed = a.director.update({ hour: Number.NaN, sunElevation: Number.POSITIVE_INFINITY, deltaSeconds: Number.NaN });
for (const value of [malformed.phase, malformed.exposure, malformed.fog.near, malformed.fog.far]) assert.equal(Number.isFinite(value), true);
assert.equal(a.director.getState().elapsedSeconds >= 0, true);

assert.equal(typeof a.director.updateFromClock, 'function');
assert.equal(a.director.id, 'atmospheric-perspective-director-v7');
console.log('ATMOSPHERIC_PERSPECTIVE_DIRECTOR_PASS');
