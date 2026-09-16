#!/usr/bin/env node
/**
 * Static boundary guard for the runtime platform.
 *
 * The adaptive platform is a policy layer, not a second gameplay engine. This guard makes that
 * distinction executable: platform modules may not own scene mutation, timers, random world state,
 * network fetches, persistent writes, or editor-only runtime APIs. It also enforces the repository's
 * 600-line source-file ceiling and prevents accidental imports from contested gameplay owners.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PLATFORM = path.join(ROOT, 'src', '3d', 'platform');
const MAX_LINES = 600;

const files = fs.readdirSync(PLATFORM).filter((name) => name.endsWith('.js')).sort();
const forbidden = [
	{ label: 'timer', pattern: /\b(setTimeout|setInterval|requestAnimationFrame|cancelAnimationFrame)\s*\(/ },
	{ label: 'randomness', pattern: /\b(Math\.random|crypto\.getRandomValues)\b/ },
	{ label: 'volatile clock ownership', pattern: /\b(Date\.now|new Date\s*\()\b/ },
	{ label: 'network side effect', pattern: /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/ },
	{ label: 'persistent write', pattern: /\b(localStorage|sessionStorage)\.(setItem|removeItem|clear)\s*\(/ },
	{ label: 'editor runtime import', pattern: /EditorMaterialStudio|EditorInstance|worldEditor/i },
	{ label: 'scene ownership', pattern: /\b(scene\.add|scene\.remove|Object3D\s*\()\b/ },
];
const contested = ['game3d.js', 'sceneManager.js', 'terrain.js', 'water.js', 'roads.js', 'rivers.js', 'naturalGeology.js'];
let failures = 0;
let totalLines = 0;
for (const name of files) {
	const file = path.join(PLATFORM, name);
	const text = fs.readFileSync(file, 'utf8');
	const lines = text.split('\n').length;
	totalLines += lines;
	if (lines > MAX_LINES) {
		failures += 1;
		console.error(`FAIL ${name}: ${lines} lines exceeds ${MAX_LINES}-line cap`);
	}
	for (const rule of forbidden) {
		if (rule.pattern.test(text)) {
			failures += 1;
			console.error(`FAIL ${name}: forbidden ${rule.label} ownership pattern`);
		}
	}
	for (const owner of contested) {
		if (new RegExp(`['\"](?:\\./|\\.\\./)*${owner.replace('.', '\\.')}['\"]`).test(text)) {
			failures += 1;
			console.error(`FAIL ${name}: imports contested owner ${owner}`);
		}
	}
	if (!/Object\.freeze|freeze\(/.test(text)) {
		failures += 1;
		console.error(`FAIL ${name}: exported runtime policy should expose immutable output`);
	}
}

if (!files.length) {
	failures += 1;
	console.error('FAIL platform directory contains no JavaScript modules');
}
console.log(`RUNTIME_SOURCE_BOUNDARY_FILES=${files.length}`);
console.log(`RUNTIME_SOURCE_BOUNDARY_LINES=${totalLines}`);
console.log(`RUNTIME_SOURCE_BOUNDARY_${failures ? 'FAIL' : 'PASS'}`);
process.exit(failures ? 1 : 0);
