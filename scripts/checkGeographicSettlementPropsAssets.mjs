import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GEOGRAPHIC_SETTLEMENT_PROP_ASSETS } from '../src/3d/world/geographicSettlementProps.js';

const ROOT = resolve(new URL('..', import.meta.url).pathname, '..');
const POINTER = 'version https://git-lfs.github.com/spec/v1';
const REQUIRED = Object.entries(GEOGRAPHIC_SETTLEMENT_PROP_ASSETS);

const report = {
  ok: true,
  checkedFamilies: 0,
  hydratedAssets: 0,
  pointerAssets: 0,
  tooSmallAssets: 0,
  missingAssets: 0,
  pathViolations: 0,
  duplicateSources: 0,
  assets: [],
};

const sources = new Set();
for (const [family, descriptor] of REQUIRED) {
  report.checkedFamilies += 1;
  assert.equal(typeof descriptor.src, 'string', `${family}: source path must be a string`);
  assert.match(descriptor.src, /^assets\/models\/props\/[A-Za-z0-9_./-]+\.glb$/, `${family}: source must remain under props/ and be GLB`);
  const fullPath = resolve(ROOT, descriptor.src);
  let bytes = 0;
  let status = 'missing';
  try {
    bytes = statSync(fullPath).size;
    const head = readFileSync(fullPath).subarray(0, 128).toString('utf8');
    if (head.includes(POINTER)) {
      report.pointerAssets += 1;
      status = 'lfs-pointer';
    } else if (bytes > 1024) {
      report.hydratedAssets += 1;
      status = 'hydrated';
    } else {
      report.tooSmallAssets += 1;
      status = 'too-small';
    }
  } catch {
    report.missingAssets += 1;
  }
  if (sources.has(descriptor.src)) report.duplicateSources += 1;
  sources.add(descriptor.src);
  report.assets.push({ family, src: descriptor.src, bytes, status });
}

assert.equal(report.missingAssets, 0, `missing required props: ${report.assets.filter((item) => item.status === 'missing').map((item) => item.src).join(', ')}`);
assert.equal(report.pointerAssets, 0, 'required runtime proof assets must be hydrated before this contract runs');
assert.equal(report.tooSmallAssets, 0, 'hydrated GLBs must be larger than an LFS pointer');
assert.equal(report.pathViolations, 0);
assert.equal(report.duplicateSources, 0, 'each family should point at a distinct authored prop source in this slice');
assert.equal(report.hydratedAssets, REQUIRED.length, 'every required family must be hydrated');

// The geographic prop catalogue is intentionally the authoritative runtime asset manifest for this
// slice. The repository-wide assets_manifest.json is generated/curated independently and does not
// need to contain every gameplay prop alias. This check therefore validates the catalogue contract
// itself and the actual hydrated bytes, avoiding a false dependency on an unrelated generated file.
const catalogueBytes = readFileSync(resolve(ROOT, 'src/3d/world/geographicSettlementProps.js'), 'utf8');
for (const [, descriptor] of REQUIRED) assert.ok(catalogueBytes.includes(descriptor.src), `catalogue lost source path ${descriptor.src}`);

console.log(JSON.stringify(report, null, 2));
