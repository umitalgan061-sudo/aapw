#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-lock-on');
const need = (ok, message) => { if (!ok) throw new Error(`[player-lock-on-runtime] ${message}`); };
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

await page.addInitScript(() => {
	window.__lockRuntimePads = [];
	window.__lockEvents = [];
	window.__lockAttacks = [];
	window.__lockMotion = [];
	Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__lockRuntimePads });
	window.addEventListener('aapw:player-lock-on', (event) => window.__lockEvents.push(structuredClone(event.detail)));
	window.addEventListener('aapw:player-attack-window', (event) => window.__lockAttacks.push(structuredClone(event.detail)));
	window.addEventListener('aapw:player-motion', (event) => {
		window.__lockMotion.push(structuredClone(event.detail));
		if (window.__lockMotion.length > 1000) window.__lockMotion.shift();
	});
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read, predicate, label, timeout = 10000, interval = 50) {
	const deadline = Date.now() + timeout;
	let last = null;
	while (Date.now() < deadline) {
		last = await read();
		const found = predicate(last);
		if (found) return found;
		await sleep(interval);
	}
	throw new Error(`[player-lock-on-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}
const histories = () => page.evaluate(() => ({
	locks: structuredClone(window.__lockEvents),
	attacks: structuredClone(window.__lockAttacks),
	motion: structuredClone(window.__lockMotion),
}));
const waitHistory = (key, predicate, label, timeout) => waitFor(histories, (history) => [...history[key]].reverse().find(predicate) ?? null, label, timeout);

async function setPad({ axes = [0, 0, 0, 0], buttons = {}, connected = true } = {}) {
	await page.evaluate(({ axes: nextAxes, buttons: nextButtons, connected: nextConnected }) => {
		window.__lockRuntimePads = [{
			index: 0,
			id: 'AAPW Lock-On Runtime Pad',
			connected: nextConnected,
			mapping: 'standard',
			axes: nextAxes,
			buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: Boolean(nextButtons[index]), value: nextButtons[index] ? 1 : 0 })),
			timestamp: performance.now(),
		}];
	}, { axes, buttons, connected });
}

function facingDot(attack, targetPosition) {
	const dx = targetPosition.x - attack.position.x;
	const dz = targetPosition.z - attack.position.z;
	const length = Math.hypot(dx, dz);
	if (!(length > 0.01)) return 1;
	return (attack.facing.x * dx + attack.facing.z * dz) / length;
}

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	const baseline = await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'grounded player baseline', 15000);

	// Seed the Standard pad, then walk camera-forward toward the shipped `umit` seat guards. This
	// uses the real collider/ground/chase-camera path; no NPC or Player position is teleported.
	await setPad();
	await sleep(150);
	await setPad({ buttons: { 12: true } });
	const approachStart = await waitHistory('motion', (motion) => motion.state === 'walk' && motion.speedMps > 2.5, 'D-pad approach walk', 5000);
	await sleep(9500);
	const motionCountBeforeStop = (await histories()).motion.length;
	await setPad();
	const approachEnd = await waitFor(
		histories,
		(history) => history.motion.slice(motionCountBeforeStop).find((motion) => motion.state === 'idle' && motion.isGrounded) ?? null,
		'approach stop after D-pad release',
		5000,
	);
	const displacement = Math.hypot(approachEnd.position.x - approachStart.position.x, approachEnd.position.z - approachStart.position.z);
	need(displacement > 15, `approach displacement too small: ${displacement}`);

	// R3 is a rising edge. Acquisition must come from the actual shipped state.npcs collection.
	await setPad({ buttons: { 11: true } });
	const acquired = await waitHistory('locks', (event) => event.locked === true && event.reason === 'acquired', 'R3 target acquisition', 7000);
	need(typeof acquired.targetId === 'string' && acquired.targetId.length > 0, `invalid target id ${JSON.stringify(acquired)}`);
	need(acquired.distanceMeters > 0 && acquired.distanceMeters <= 30, `acquired target outside 30m contract: ${acquired.distanceMeters}`);
	need(Number.isFinite(acquired.targetPosition?.x) && Number.isFinite(acquired.targetPosition?.z), `missing target position ${JSON.stringify(acquired)}`);

	// Give the bounded Player-facing adapter a few frames, then attack through the existing X/light
	// path. The existing attack-window event supplies Player world position + facing at attack start.
	await sleep(350);
	await setPad();
	await sleep(100);
	await setPad({ buttons: { 2: true } });
	const attack = await waitHistory('attacks', (event) => event.kind === 'light' && event.phase === 'start', 'locked light attack start', 7000);
	const dot = facingDot(attack, acquired.targetPosition);
	need(dot > 0.92, `locked attack must face acquired target; dot=${dot}`);
	await waitHistory('attacks', (event) => event.serial === attack.serial && event.phase === 'finish', 'locked light attack finish', 10000);

	// Release/repress R3 toggles the same lock off; holding never emits repeated toggles.
	await setPad();
	await sleep(120);
	const eventCountBeforeRelease = (await histories()).locks.length;
	await setPad({ buttons: { 11: true } });
	const released = await waitHistory('locks', (event) => event.locked === false && event.reason === 'toggle-release' && event.targetId === acquired.targetId, 'R3 target release', 5000);
	await sleep(250);
	need((await histories()).locks.length === eventCountBeforeRelease + 1, 'held R3 emitted repeated lock toggles');

	await page.screenshot({ path: path.join(outDir, 'lock-on-runtime.png'), fullPage: true });
	need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
	const metrics = {
		ok: true,
		baseline: { state: baseline.state, position: baseline.position },
		approach: { displacementMeters: Number(displacement.toFixed(3)), endPosition: approachEnd.position },
		acquired,
		attack: { serial: attack.serial, kind: attack.kind, position: attack.position, facing: attack.facing, targetFacingDot: Number(dot.toFixed(4)) },
		released,
		browserErrors: errors,
	};
	fs.writeFileSync(path.join(outDir, 'lock-on-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
	console.log(`PLAYER_LOCK_ON_RUNTIME_OK ${JSON.stringify({ targetId: acquired.targetId, distanceMeters: acquired.distanceMeters, targetFacingDot: metrics.attack.targetFacingDot, errors: errors.length })}`);
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
