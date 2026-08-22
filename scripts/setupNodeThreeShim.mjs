#!/usr/bin/env node
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorRoot = resolve(repoRoot, 'src/3d/vendor/three');
const packageRoot = resolve(repoRoot, 'node_modules/three');

await mkdir(packageRoot, { recursive: true });
await rm(resolve(packageRoot, 'three.module.js'), { force: true });
await rm(resolve(packageRoot, 'addons'), { recursive: true, force: true });
await symlink(resolve(vendorRoot, 'three.module.js'), resolve(packageRoot, 'three.module.js'));
await symlink(resolve(vendorRoot, 'addons'), resolve(packageRoot, 'addons'), 'dir');
await writeFile(resolve(packageRoot, 'package.json'), JSON.stringify({
  name: 'three',
  private: true,
  type: 'module',
  exports: {
    '.': './three.module.js',
    './addons/*': './addons/*',
  },
}, null, 2));

console.log('[setupNodeThreeShim] PASS: bare three imports resolve to src/3d/vendor/three.');
