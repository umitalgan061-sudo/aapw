#!/usr/bin/env node
/** Run211: prove additive desktop keyboard parity delegates to existing RTS controls safely. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run211');
const assert = (value, message) => { if (!value) throw new Error(message); };

function playwrightModule() {
	for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
		try { return require(id); } catch {}
	}
	return null;
}

function contentType(file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === '.html') return 'text/html; charset=utf-8';
	if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
	if (ext === '.css') return 'text/css; charset=utf-8';
	if (ext === '.json' || ext === '.webmanifest') return ext === '.webmanifest' ? 'application/manifest+json' : 'application/json; charset=utf-8';
	if (ext === '.png') return 'image/png';
	if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
	if (ext === '.svg') return 'image/svg+xml';
	if (ext === '.glb') return 'model/gltf-binary';
	if (ext === '.gltf') return 'model/gltf+json';
	if (ext === '.fbx') return 'application/octet-stream';
	return 'application/octet-stream';
}

function server() {
	const instance = http.createServer((req, res) => {
		const clean = decodeURIComponent(req.url.split('?')[0]);
		const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
		const file = path.resolve(ROOT, relative);
		if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404);
			res.end('Not found');
			return;
		}
		res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve(instance)));
}

async function captureDesktop(browser, base, errors) {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();
	page.on('console', message => { if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`); });
	page.on('pageerror', error => errors.push(`desktop pageerror: ${String(error)}`));
	try {
		await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_SHORTCUTS__?.getSnapshot?.().installed === true, null, { timeout: 30000 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_SURFACE__?.status === 'ready', null, { timeout: 60000 });

		const initial = await page.evaluate(() => ({
			shortcuts: window.__WESTEROS_RTS_SHORTCUTS__.getSnapshot(),
			rts: window.__WESTEROS_RTS__.getSnapshot(),
			moveShortcut: document.getElementById('rts-move-command')?.getAttribute('aria-keyshortcuts'),
			focusShortcut: document.getElementById('rts-focus-army')?.getAttribute('aria-keyshortcuts'),
			hint: document.getElementById('rts-command-shortcut-hint')?.textContent || '',
		}));
		assert(initial.moveShortcut === 'M', `move aria-keyshortcuts=${initial.moveShortcut}`);
		assert(initial.focusShortcut === 'F', `focus aria-keyshortcuts=${initial.focusShortcut}`);
		assert(initial.hint.includes('M: hareket emri') && initial.hint.includes('F: orduya odaklan'), 'desktop shortcut hint missing');
		assert(initial.rts.selectedCount === 48, `initial selectedCount=${initial.rts.selectedCount}`);

		await page.keyboard.press('KeyM');
		await page.waitForFunction(() => document.getElementById('rts-move-command')?.classList.contains('is-active') === true);
		const moveState = await page.evaluate(() => ({
			status: document.getElementById('rts-status')?.textContent || '',
			shortcuts: window.__WESTEROS_RTS_SHORTCUTS__.getSnapshot(),
			rts: window.__WESTEROS_RTS__.getSnapshot(),
		}));
		assert(moveState.status.includes('Hareket emri'), `move status=${moveState.status}`);
		assert(moveState.shortcuts.lastShortcut === 'M' && moveState.shortcuts.keydownCount === 1, 'M shortcut bookkeeping drifted');
		await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-move-shortcut.png'), fullPage: true });

		await page.keyboard.press('KeyM');
		await page.waitForFunction(() => document.getElementById('rts-move-command')?.classList.contains('is-active') === false);
		await page.keyboard.press('KeyF');
		await page.waitForFunction(() => (document.getElementById('rts-status')?.textContent || '').includes('odaklandı'));
		const focusState = await page.evaluate(() => ({
			status: document.getElementById('rts-status')?.textContent || '',
			shortcuts: window.__WESTEROS_RTS_SHORTCUTS__.getSnapshot(),
			rts: window.__WESTEROS_RTS__.getSnapshot(),
		}));
		assert(focusState.shortcuts.lastShortcut === 'F' && focusState.shortcuts.keydownCount === 3, 'F shortcut bookkeeping drifted');
		assert(focusState.rts.selectedCount === 48, `focus selectedCount=${focusState.rts.selectedCount}`);
		assert(focusState.rts.drawCalls < 2500 && focusState.rts.triangles < 5000000, `desktop render budget exceeded: ${JSON.stringify(focusState.rts)}`);
		await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-focus-shortcut.png'), fullPage: true });

		const editableGuard = await page.evaluate(async () => {
			const move = document.getElementById('rts-move-command');
			const input = document.createElement('input');
			input.id = 'run211-editable-probe';
			document.body.appendChild(input);
			input.focus();
			return { before: move?.classList.contains('is-active') === true };
		});
		await page.keyboard.press('KeyM');
		const afterEditable = await page.evaluate(() => {
			const move = document.getElementById('rts-move-command');
			const probe = document.getElementById('run211-editable-probe');
			const snapshot = window.__WESTEROS_RTS_SHORTCUTS__.getSnapshot();
			probe?.remove();
			return { active: move?.classList.contains('is-active') === true, snapshot };
		});
		assert(editableGuard.before === false && afterEditable.active === false, 'editable target unexpectedly triggered Move Command');
		assert(afterEditable.snapshot.keydownCount === 3, `editable guard incremented keydownCount=${afterEditable.snapshot.keydownCount}`);

		await page.keyboard.press('Control+KeyM');
		const afterModifier = await page.evaluate(() => ({
			active: document.getElementById('rts-move-command')?.classList.contains('is-active') === true,
			snapshot: window.__WESTEROS_RTS_SHORTCUTS__.getSnapshot(),
		}));
		assert(afterModifier.active === false && afterModifier.snapshot.keydownCount === 3, 'Ctrl+M should remain browser/system-reserved');

		return { initial, moveState, focusState, final: afterModifier };
	} finally {
		await context.close();
	}
}

async function captureMobile(browser, base, errors) {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		deviceScaleFactor: 2,
	});
	const page = await context.newPage();
	page.on('console', message => { if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`); });
	page.on('pageerror', error => errors.push(`mobile pageerror: ${String(error)}`));
	try {
		await page.goto(`${base}/rts.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
		await page.waitForSelector('body[data-rts-ready="true"]', { timeout: 180000 });
		await page.waitForFunction(() => window.__WESTEROS_RTS_SHORTCUTS__?.getSnapshot?.().installed === true, null, { timeout: 30000 });
		const snapshot = await page.evaluate(() => ({
			shortcuts: window.__WESTEROS_RTS_SHORTCUTS__.getSnapshot(),
			rts: window.__WESTEROS_RTS__.getSnapshot(),
			hintPresent: document.getElementById('rts-command-shortcut-hint') !== null,
		}));
		assert(snapshot.shortcuts.coarsePointer === true, 'mobile coarse-pointer contract inactive');
		assert(snapshot.hintPresent === false, 'desktop keyboard hint should not consume mobile UI space');
		assert(snapshot.rts.drawCalls < 500 && snapshot.rts.triangles < 500000, `mobile render budget exceeded: ${JSON.stringify(snapshot.rts)}`);
		return snapshot;
	} finally {
		await context.close();
	}
}

async function main() {
	const playwright = playwrightModule();
	if (!playwright) throw new Error('Playwright unavailable');
	fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
	const s = await server();
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	const base = `http://127.0.0.1:${s.address().port}`;
	try {
		const desktop = await captureDesktop(browser, base, errors);
		const mobile = await captureMobile(browser, base, errors);
		assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
		const proof = { desktop, mobile, errors, visualEvidence: ['desktop-move-shortcut.png', 'desktop-focus-shortcut.png'] };
		fs.writeFileSync(path.join(ARTIFACT_DIR, 'proof.json'), JSON.stringify(proof, null, 2));
		console.log(`[checkRun211RtsKeyboardShortcuts] PROOF: ${JSON.stringify(proof)}`);
		console.log('[checkRun211RtsKeyboardShortcuts] PASS: M/F delegate to established commands, editable/modifier guards hold, mobile UI stays clean, budgets and console remain clean');
	} finally {
		await browser.close();
		await new Promise(resolve => s.close(resolve));
	}
}

main().catch(error => {
	console.error(`[checkRun211RtsKeyboardShortcuts] FAIL: ${error.stack || error}`);
	process.exitCode = 1;
});
