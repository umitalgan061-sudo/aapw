#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const audioDir = path.join(root, 'src', '3d', 'audio');
const files = fs.readdirSync(audioDir).filter((name) => name.endsWith('.js')).sort();
const forbidden = [
	{ label: 'randomness', regex: /\bMath\.random\b/ },
	{ label: 'wall-clock', regex: /\bDate\.now\b|new Date\s*\(/ },
	{ label: 'timer ownership', regex: /\bsetTimeout\s*\(|\bsetInterval\s*\(/ },
	{ label: 'animation-frame ownership', regex: /\brequestAnimationFrame\s*\(/ },
	{ label: 'network side effect', regex: /\bfetch\s*\(|new\s+WebSocket\b|XMLHttpRequest/ },
	{ label: 'persistent storage mutation', regex: /\.(setItem|removeItem|clear)\s*\(/ },
	{ label: 'scene mutation', regex: /\bscene\.(add|remove|attach|detach)\s*\(/ },
];
let failures = 0;
let lines = 0;
for (const name of files) {
	const text = fs.readFileSync(path.join(audioDir, name), 'utf8');
	const count = text.split('\n').length;
	lines += count;
	if (count > 600) { failures += 1; console.error(`FAIL ${name}: ${count} lines`); }
	for (const rule of forbidden) if (rule.regex.test(text)) { failures += 1; console.error(`FAIL ${name}: ${rule.label}`); }
	if (!/Object\.freeze|freeze\(/.test(text)) { failures += 1; console.error(`FAIL ${name}: missing immutable output guard`); }
}
if (files.length < 10) { failures += 1; console.error(`FAIL expected >=10 audio modules, got ${files.length}`); }
console.log(`IMMERSIVE_AUDIO_FILES=${files.length}`);
console.log(`IMMERSIVE_AUDIO_LINES=${lines}`);
console.log(`IMMERSIVE_AUDIO_BOUNDARY_${failures ? 'FAIL' : 'PASS'}`);
process.exit(failures ? 1 : 0);
