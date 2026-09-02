import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../src/3d/fog.js', import.meta.url), 'utf8');

assert.match(source, /const FOG_BOOT_HORIZON_COLOR = 0x596979;/, 'boot fog must use a non-black atmospheric horizon');
assert.doesNotMatch(source, /new THREE\.FogExp2\(0x000000\s*,/, 'FogExp2 must never initialize from black');
assert.match(
  source,
  /new THREE\.FogExp2\(FOG_BOOT_HORIZON_COLOR, FOG_DENSITY_DAY\)/,
  'createFog must use the atmospheric startup horizon',
);
assert.match(source, /const FOG_HORIZON_LUMINANCE_FLOOR = 0\.035;/, 'dynamic horizon luminance floor drifted');
assert.match(
  source,
  /const FOG_HORIZON_FLOOR_COLOR = new THREE\.Color\(FOG_BOOT_HORIZON_COLOR\);/,
  'dynamic horizon floor must reuse the restrained atmospheric boot color',
);
assert.match(
  source,
  /if \(fogLuminance < FOG_HORIZON_LUMINANCE_FLOOR\) \{[\s\S]*?fog\.color\.lerp\(FOG_HORIZON_FLOOR_COLOR, rescue\);[\s\S]*?\}/,
  'updateFog must rescue transient near-black lighting horizons',
);
assert.match(source, /const FOG_DENSITY_MIN = 0\.00026;/, 'minimum aerial-perspective density contract drifted');
assert.match(source, /const FOG_DENSITY_MAX = 0\.00072;/, 'maximum aerial-perspective density contract drifted');
assert.match(
  source,
  /fog\.density = THREE\.MathUtils\.clamp\(density, FOG_DENSITY_MIN, FOG_DENSITY_MAX\);/,
  'phase-derived fog density must remain bounded',
);

const hex = 0x596979;
const r = ((hex >> 16) & 0xff) / 255;
const g = ((hex >> 8) & 0xff) / 255;
const b = (hex & 0xff) / 255;
const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
assert.ok(luminance > 0.12, `boot horizon luminance must remain visibly above black, got ${luminance}`);
assert.ok(luminance < 0.55, `boot horizon must remain restrained, got ${luminance}`);

const minDynamicLuminance = 0.035;
assert.ok(minDynamicLuminance > 0.025, 'dynamic horizon rescue must remain visibly above numerical black');
assert.ok(minDynamicLuminance < 0.08, 'dynamic horizon rescue must not wash out legitimate deep night');

const minDensity = 0.00026;
const maxDensity = 0.00072;
assert.ok(minDensity > 0, 'fog minimum must remain positive');
assert.ok(maxDensity > minDensity, 'fog density envelope must have positive width');
assert.ok(maxDensity < 0.001, 'fog maximum must not become a near-field visibility wall');

console.log('FOG_HORIZON_SAFETY_PASS', JSON.stringify({ luminance, minDynamicLuminance, minDensity, maxDensity }));
