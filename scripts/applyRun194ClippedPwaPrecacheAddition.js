#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const RUN193 = "GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSceneShadowAdapter.js');";
const V1 = "GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceSceneWindowMigrationShadow.js');";
const V2 = "GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceClippedWindowOwnershipShadow.js');";

let source = fs.readFileSync(SW_PATH, 'utf8');
if (!source.includes(RUN193)) throw new Error('Run194 V2 PWA precache anchor not found');
if (!source.includes(V1)) source = source.replace(RUN193, `${RUN193}\n${V1}`);
if (!source.includes(V2)) source = source.replace(V1, `${V1}\n${V2}`);
fs.writeFileSync(SW_PATH, source);
console.log('[applyRun194ClippedPwaPrecacheAddition] PASS: retained Run194 V1 and superseding V2 shadow modules are additively precached.');
