import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_REFERENCE_PALETTE,
  GEOGRAPHIC_REFERENCE_PALETTE_POLICY,
  relativeLuminanceFromHex,
} from '../src/3d/world/geographicReferencePalette.js';

const terrain = GEOGRAPHIC_REFERENCE_PALETTE.terrain;
const water = GEOGRAPHIC_REFERENCE_PALETTE.water;

assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.renderOnly, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.deterministic, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.heightAuthorityUnchanged, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.hydrologyAuthorityUnchanged, true);
assert.equal(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.routeAuthorityUnchanged, true);
assert.match(GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id, /aerial-lowland-ecotones/);

const finiteHex = (value, label) => {
  assert.equal(Number.isInteger(value), true, `${label} must be an integer hex colour`);
  assert.equal(value >= 0x000000 && value <= 0xffffff, true, `${label} must be RGB24`);
};

for (const [label, value] of Object.entries(terrain)) finiteHex(value, `terrain.${label}`);
for (const [label, value] of Object.entries(water)) finiteHex(value, `water.${label}`);

const luminance = Object.fromEntries(
  Object.entries(terrain).map(([label, value]) => [label, relativeLuminanceFromHex(value)]),
);

const separation = (a, b) => Math.abs(luminance[a] - luminance[b]);
assert.ok(separation('meadow', 'mossShadow') > 0.025, 'meadow must separate from moss shadow aerially');
assert.ok(separation('meadow', 'dryHeather') > 0.012, 'meadow must separate from dry heath aerially');
assert.ok(separation('dryHeather', 'exposedEarth') > 0.008, 'dry heath must separate from ferric earth');
assert.ok(separation('graniteSunlit', 'quartz') > 0.006, 'sunlit granite must separate from quartz');
assert.ok(luminance.meadow > luminance.mossShadow, 'meadow must not collapse into moss shadow');
assert.ok(luminance.exposedEarth > luminance.dryHeather, 'ferric earth must remain warmer/brighter than dry heath');
assert.ok(luminance.quartz > luminance.graniteSunlit, 'quartz must remain readable against sunlit granite');

const channel = (hex, shift) => (hex >> shift) & 0xff;
const cyanBias = (hex) => channel(hex, 0) - channel(hex, 16);
assert.ok(cyanBias(water.shoreClear) < 45, 'shore clear must not drift into neon cyan');
assert.ok(cyanBias(water.lakeClear) < 55, 'lake clear must not drift into neon cyan');
assert.ok(cyanBias(water.deepSea) < 35, 'deep sea must remain chromatically restrained');

const repeat = JSON.stringify({ terrain, water, policy: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id });
assert.equal(repeat, JSON.stringify({ terrain, water, policy: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id }));

console.log('GEOGRAPHIC_REFERENCE_PALETTE_AERIAL_CONTRAST_OK');
console.log(JSON.stringify({
  policy: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id,
  luminance: {
    meadow: luminance.meadow,
    dryHeather: luminance.dryHeather,
    exposedEarth: luminance.exposedEarth,
    graniteSunlit: luminance.graniteSunlit,
    quartz: luminance.quartz,
  },
}));
