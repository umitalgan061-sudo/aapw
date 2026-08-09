#!/usr/bin/env node
/** Run200: additive-only registration for the dormant canonical developer startup module. */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVICE_WORKER = path.join(ROOT, 'service-worker.js');
const LINE = "GAME3D_SHELL_FILES.push('./src/3d/world/worldReferenceCanonicalDeveloperStartup.js');";

const source = fs.readFileSync(SERVICE_WORKER, 'utf8');
if (source.includes(LINE)) {
	console.log('[applyRun200CanonicalDeveloperStartup] already applied');
	process.exit(0);
}

fs.appendFileSync(
	SERVICE_WORKER,
	`\n// Run200 / ADR-0219 — dormant opt-in canonical developer startup composition.\n${LINE}\n`,
	'utf8',
);
console.log('[applyRun200CanonicalDeveloperStartup] PASS: appended developer startup module to the 3D offline shell');
