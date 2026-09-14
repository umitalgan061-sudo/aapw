#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const failures = [];
const checks = [];
const check = (condition, message) => {
  checks.push({ ok: Boolean(condition), message });
  if (!condition) failures.push(message);
};

const ASSETS = Object.freeze([
  Object.freeze({ id: 'peasant-girl', source: 'assets/models/characters/peasant_girl.fbx', requiredSidecars: [] }),
  Object.freeze({ id: 'paladin-j-nordstrom', source: 'assets/models/characters/paladin_j_nordstrom.fbx', requiredSidecars: [] }),
  Object.freeze({ id: 'erika-archer', source: 'assets/models/characters/erika_archer.fbx', requiredSidecars: [] }),
  Object.freeze({ id: 'white-horse', source: 'assets/models/animals/white_horse_bEdE4rmZy9.glb', requiredSidecars: [] }),
  Object.freeze({ id: 'wolf', source: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb', requiredSidecars: [] }),
  Object.freeze({ id: 'dragon', source: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx', requiredSidecars: [
    'assets/models/creatures/dragon/textures/Dragon_ground_color.jpg',
    'assets/models/creatures/dragon/textures/Dragon_Bump_Col2.jpg',
    'assets/models/creatures/dragon/textures/Dragon_Nor.jpg',
    'assets/models/creatures/dragon/textures/Ani_Fire_A.png',
  ] }),
]);

function readStatus(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return { state: 'missing', bytes: 0 };
  const stats = fs.statSync(absolute);
  if (!stats.isFile() || stats.size <= 0) return { state: 'empty', bytes: stats.size };
  const prefix = fs.readFileSync(absolute, { encoding: 'utf8' }).slice(0, 128);
  if (prefix.startsWith('version https://git-lfs.github.com/spec')) return { state: 'lfs-pointer', bytes: stats.size };
  return { state: 'hydrated', bytes: stats.size };
}

function run() {
  for (const asset of ASSETS) {
    const source = readStatus(asset.source);
    check(source.state !== 'missing' && source.state !== 'empty', `${asset.id} source is not present as a non-empty file`);
    check(source.state !== 'lfs-pointer', `${asset.id} source is still an LFS pointer during asset proof`);
    check(source.bytes > 1024, `${asset.id} source file is suspiciously small: ${source.bytes} bytes`);
    for (const sidecar of asset.requiredSidecars) {
      const texture = readStatus(sidecar);
      check(texture.state === 'hydrated', `${asset.id} required texture is not hydrated: ${sidecar}`);
      check(texture.bytes > 256, `${asset.id} texture is suspiciously small: ${sidecar} (${texture.bytes} bytes)`);
    }
  }

  const manifest = fs.readFileSync(path.join(ROOT, 'assets_manifest.json'), 'utf8');
  check(manifest.includes('Dragon_Baked_Actions_fbx_7.4_binary.fbx'), 'asset manifest does not mention the real dragon source');
  check(manifest.includes('Wolf-Blender-2.82a.glb'), 'asset manifest does not mention the real wolf source');
  check(manifest.includes('white_horse_bEdE4rmZy9.glb'), 'asset manifest does not mention the real horse source');

  const result = {
    assets: ASSETS.map((asset) => ({ id: asset.id, source: asset.source, source: readStatus(asset.source), requiredSidecars: asset.requiredSidecars.map((file) => ({ file, ...readStatus(file) })) })),
    checks: checks.length,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
