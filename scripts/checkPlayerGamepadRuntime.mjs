#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-gamepad');
const need = (ok, message) => { if (!ok) throw new Error(`[player-gamepad-runtime] ${message}`); };
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
	window.__runtimePads = [];
	window.__gamepadMotion = [];
	window.__gamepadInputs = [];
	window.__gamepadDevices = [];
	window.__gamepadAttacks = [];
	Object.defineProperty(navigator, 'getGamepads', {
		configurable: true,
		value: () => window.__runtimePads,
	});
	window.addEventListener('aapw:player-motion', (event) => {
		window.__gamepadMotion.push(structuredClone(event.detail));
		if (window.__gamepadMotion.length > 1200) window.__gamepadMotion.shift();
	});
	window.addEventListener('aapw:player-combat-input', (event) => window.__gamepadInputs.push(structuredClone(event.detail)));
	window.addEventListener('aapw:player-input-device', (event) => window.__gamepadDevices.push(structuredClone(event.detail)));
	window.addEventListener('aapw:player-attack-window', (event) => window.__gamepadAttacks.push(structuredClone(event.detail)));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(read, predicate, label, timeout = 10000, interval = 50) {
	const deadline = Date.now() + timeout; let last = null;
	while (Date.now() < deadline) {
		last = await read();
		const found = predicate(last);
		if (found) return found;
		await sleep(interval);
	}
	throw new Error(`[player-gamepad-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}
const histories = () => page.evaluate(() => ({
	motion: structuredClone(window.__gamepadMotion),
	inputs: structuredClone(window.__gamepadInputs),
	devices: structuredClone(window.__gamepadDevices),
	attacks: structuredClone(window.__gamepadAttacks),
}));
const waitHistory = (key, predicate, label, timeout) => waitFor(
	histories,
	(history) => [...history[key]].reverse().find(predicate) ?? null,
	label,
	timeout,
);

async function setPads(specs) {
	await page.evaluate((nextSpecs) => {
		window.__runtimePads = nextSpecs.map((spec) => ({
			index: spec.index,
			id: `AAPW Runtime Pad ${spec.index}`,
			connected: spec.connected !== false,
			mapping: spec.mapping ?? 'standard',
			axes: spec.axes ?? [0, 0, 0, 0],
			buttons: Array.from({ length: 12 }, (_, index) => ({ pressed: Boolean(spec.buttons?.[index]), value: spec.buttons?.[index] ? 1 : 0 })),
			timestamp: performance.now(),
		}));
	}, specs);
}

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	const baseline = await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'grounded idle baseline', 15000);
	need(baseline.attackKind === 'none', `baseline must be combat-idle: ${JSON.stringify(baseline)}`);

	const inputsBeforeConnect = (await histories()).inputs.length;
	await setPads([{ index: 1, buttons: { 2: true } }]);
	const firstDevice = await waitHistory('devices', (event) => event.device === 'gamepad' && event.gamepadIndex === 1, 'initial gamepad selection');
	await sleep(350);
	need((await histories()).inputs.length === inputsBeforeConnect, 'held X during connection produced phantom combat input');
	need(firstDevice.reason === 'selected', `unexpected initial device reason ${JSON.stringify(firstDevice)}`);

	await setPads([{ index: 1 }]);
	await sleep(120);
	await setPads([{ index: 1, buttons: { 2: true } }]);
	const lightInput = await waitHistory('inputs', (event) => event.kind === 'light' && event.source === 'gamepad', 'gamepad X light intent');
	const lightStart = await waitHistory('attacks', (event) => event.kind === 'light' && event.phase === 'start', 'gamepad light attack start');
	need(lightInput.source === 'gamepad' && lightStart.comboStep === 1, 'gamepad X must enter the existing Player melee state machine');
	await waitHistory('attacks', (event) => event.serial === lightStart.serial && event.phase === 'finish', 'gamepad light finish', 20000);

	const sprintMarker = (await histories()).motion.length;
	await setPads([{ index: 1, axes: [0, -1, 0, 0], buttons: { 10: true } }]);
	const sprint = await waitFor(histories, (history) => history.motion.slice(sprintMarker).find((motion) => motion.running && motion.speed > 6 && motion.stamina < baseline.stamina) ?? null, 'analog L3 sprint');
	need(sprint.speed > 6, `gamepad sprint speed too low: ${sprint.speed}`);
	need(sprint.stamina < baseline.stamina, `gamepad sprint must drain stamina: ${sprint.stamina}`);

	const heavyBeforeHotplug = (await histories()).inputs.filter((event) => event.kind === 'heavy').length;
	await setPads([
		{ index: 0, axes: [-1, 0, 0, 0], buttons: { 3: true } },
		{ index: 1, axes: [0, -1, 0, 0], buttons: { 10: true } },
	]);
	await sleep(350);
	let snapshot = await histories();
	need(snapshot.devices.filter((event) => event.gamepadIndex === 0).length === 0, 'lower-index hotplug stole sticky active controller');
	need(snapshot.inputs.filter((event) => event.kind === 'heavy').length === heavyBeforeHotplug, 'inactive controller leaked heavy combat input');

	await setPads([
		{ index: 0, axes: [-1, 0, 0, 0], buttons: { 3: true, 4: true } },
		{ index: 1, connected: false },
	]);
	const fallbackDevice = await waitHistory('devices', (event) => event.device === 'gamepad' && event.gamepadIndex === 0, 'fallback gamepad selection');
	const fallbackGuard = await waitHistory('motion', (motion) => motion.guarding === true, 'fallback held guard');
	await sleep(250);
	snapshot = await histories();
	need(snapshot.inputs.filter((event) => event.kind === 'heavy').length === heavyBeforeHotplug, 'held Y during fallback handoff produced phantom heavy');
	need(fallbackDevice.reason === 'selected' && fallbackGuard.guarding, 'fallback controller did not preserve safe held guard');

	await setPads([{ index: 0 }]);
	await sleep(120);
	await setPads([{ index: 0, buttons: { 3: true } }]);
	const heavyInput = await waitHistory('inputs', (event) => event.kind === 'heavy' && event.source === 'gamepad', 'fallback Y heavy intent');
	const heavyStart = await waitHistory('attacks', (event) => event.kind === 'heavy' && event.phase === 'start' && event.serial > lightStart.serial, 'fallback heavy attack start');
	need(heavyInput.source === 'gamepad' && heavyStart.damageScale > 1, 'fallback Y must enter existing heavy attack contract');

	await setPads([]);
	const disconnected = await waitHistory('devices', (event) => event.device === 'keyboard-pointer' && event.gamepadIndex === null, 'gamepad disconnect');
	need(disconnected.reason === 'disconnected', `unexpected disconnect telemetry ${JSON.stringify(disconnected)}`);

	await page.screenshot({ path: path.join(outDir, 'gamepad-runtime.png'), fullPage: true });
	snapshot = await histories();
	need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
	const metrics = {
		ok: true,
		baseline: { state: baseline.state, stamina: baseline.stamina },
		light: { input: lightInput, serial: lightStart.serial, comboStep: lightStart.comboStep },
		sprint: { speed: sprint.speed, stamina: sprint.stamina, state: sprint.state },
		fallback: { device: fallbackDevice, guarding: fallbackGuard.guarding },
		heavy: { input: heavyInput, serial: heavyStart.serial, damageScale: heavyStart.damageScale },
		deviceEvents: snapshot.devices,
		browserErrors: errors,
	};
	fs.writeFileSync(path.join(outDir, 'gamepad-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
	console.log(`PLAYER_GAMEPAD_RUNTIME_OK ${JSON.stringify({ sprintSpeed: sprint.speed, lightSerial: lightStart.serial, heavySerial: heavyStart.serial, errors: errors.length })}`);
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
