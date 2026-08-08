#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const ENTRY = "GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceGameplayTickFreezeShadow.js');";
const ANCHOR = "GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceCurrentRuntimeIntegrationShadow.js');";

let source = fs.readFileSync(SW_PATH, 'utf8');
if (!source.includes(ENTRY)) {
	if (!source.includes(ANCHOR)) throw new Error('Run197 PWA precache anchor not found');
	source = source.replace(ANCHOR, `${ANCHOR}\n${ENTRY}`);
	fs.writeFileSync(SW_PATH, source);
}
console.log('[applyRun197PwaPrecacheAddition] PASS: gameplay tick freeze shadow is included in GAME3D_SHELL_FILES with one additive line.');
