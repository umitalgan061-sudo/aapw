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
	window.__gamepadHaptics = [];
	Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__runtimePads });
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
	const deadline = Date.now() + timeout;
	let last = null;
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
	haptics: structuredClone(window.__gamepadHaptics),
}));
const latestMotion = () => page.evaluate(() => structuredClone(window.__gamepadMotion.at(-1)));
const waitHistory = (key, predicate, label, timeout) => waitFor(
	histories,
	(history) => [...history[key]].reverse().find(predicate) ?? null,
	label,
	timeout,
);
const resetMotionHistory = () => page.evaluate(() => { window.__gamepadMotion.length = 0; });

async function setPads(specs) {
	await page.evaluate((nextSpecs) => {
		window.__runtimePads = nextSpecs.map((spec) => ({
			index: spec.index,
			id: `AAPW Runtime Pad ${spec.index}`,
			connected: spec.connected !== false,
			mapping: spec.mapping ?? 'standard',
			axes: spec.axes ?? [0, 0, 0, 0],
			buttons: Array.from({ length: 16 }, (_, index) => {
				const value = Number(spec.values?.[index] ?? (spec.buttons?.[index] ? 1 : 0));
				return { pressed: Boolean(spec.buttons?.[index]) || value > 0.5, value };
			}),
			vibrationActuator: spec.haptics === false ? null : {
				playEffect: (type, options) => {
					window.__gamepadHaptics.push({ gamepadIndex: spec.index, type, options: structuredClone(options) });
					return Promise.resolve('complete');
				},
			},
			timestamp: performance.now(),
		}));
	}, specs);
}

const directionBetween = (start, end) => {
	if (!start?.position || !end?.position) return null;
	const dx = end.position.x - start.position.x;
	const dz = end.position.z - start.position.z;
	const length = Math.hypot(dx, dz);
	return length > 0.01 ? { x: dx / length, z: dz / length, distance: length } : null;
};

async function moveThenStop(padSpec, label, durationMs = 420) {
	const start = await latestMotion();
	need(start?.state === 'idle' && start.isGrounded, `${label} must start from grounded idle`);
	await resetMotionHistory();
	await setPads([padSpec]);
	const moving = await waitHistory('motion', (motion) => motion.state === 'walk' && motion.speedMps > 0.5, `${label} walk`);
	await sleep(durationMs);
	await resetMotionHistory();
	await setPads([{ index: padSpec.index }]);
	const end = await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, `${label} stop`, 5000);
	return { start, moving, end, direction: directionBetween(start, end) };
}

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });

	const baseline = await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'grounded idle baseline', 15000);
	need(baseline.attackKind === 'none', 'baseline combat state');

	const inputsBeforeConnect = (await histories()).inputs.length;
	await setPads([{ index: 1, buttons: { 2: true } }]);
	const firstDevice = await waitHistory('devices', (event) => event.device === 'gamepad' && event.gamepadIndex === 1, 'initial selection');
	await sleep(350);
	need((await histories()).inputs.length === inputsBeforeConnect, 'phantom connect input');
	need(firstDevice.reason === 'selected', 'bad device reason');

	await setPads([{ index: 1 }]);
	await sleep(120);
	await setPads([{ index: 1, buttons: { 2: true } }]);
	const lightInput = await waitHistory('inputs', (event) => event.kind === 'light' && event.source === 'gamepad', 'X light');
	const lightStart = await waitHistory('attacks', (event) => event.kind === 'light' && event.phase === 'start', 'light start');
	const lightHaptic = await waitHistory('haptics', (event) => event.gamepadIndex === 1, 'light haptic');
	need(lightStart.comboStep === 1 && lightHaptic.type === 'dual-rumble', 'light chain');
	await waitHistory('attacks', (event) => event.serial === lightStart.serial && event.phase === 'finish', 'light finish', 20000);

	await setPads([{ index: 1 }]);
	await resetMotionHistory();
	await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'post-light idle', 5000);
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -0.59, 0, 0] }]);
	const partial = await waitHistory('motion', (motion) => motion.state === 'walk' && motion.speedMps > 0.5, 'partial walk');
	await setPads([{ index: 1 }]);
	await waitHistory('motion', (motion) => motion.state === 'idle', 'partial neutral');

	const fullRun = await moveThenStop({ index: 1, axes: [0, -1, 0, 0] }, 'full walk');
	const full = fullRun.moving;
	const ratio = partial.speedMps / full.speedMps;
	need(ratio > 0.42 && ratio < 0.58, `analog ratio ${ratio}`);
	const beforeDir = fullRun.direction;
	need(beforeDir?.distance > 0.5, `baseline displacement ${beforeDir?.distance ?? 0}`);

	await setPads([{ index: 1 }]);
	await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'pre-drift idle', 5000);
	const driftStaminaBefore = (await latestMotion()).stamina;
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -0.35, 0, 0], buttons: { 1: true, 10: true } }]);
	const driftWalk = await waitHistory('motion', (motion) => motion.state === 'walk' && motion.speedMps > 0 && motion.speedMps < 2 && motion.runIntent === false, 'drift-safe walk', 5000);
	await sleep(320);
	const driftHistory = (await histories()).motion;
	need(!driftHistory.some((motion) => motion.state === 'sprint' || motion.state === 'dodge'), `drift triggered action ${JSON.stringify(driftHistory.slice(-8))}`);
	const driftLast = driftHistory.at(-1) ?? driftWalk;
	need(Math.abs(driftLast.stamina - driftStaminaBefore) < 0.05, `drift spent stamina ${driftStaminaBefore}->${driftLast.stamina}`);
	await setPads([{ index: 1 }]);
	await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'post-drift idle', 5000);

	// Sprint hysteresis works on post-deadzone magnitude. The no-restart phase intentionally remains
	// in the same walk/runIntent=false Player state as the release phase, so telemetry dedupe may emit
	// no new snapshot. Observe a bounded interval and reject any sprint/runIntent=true transition
	// instead of requiring a duplicate walk event that production correctly suppresses.
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -0.85, 0, 0], buttons: { 10: true } }]);
	const hysteresisStart = await waitHistory('motion', (motion) => motion.state === 'sprint' && motion.runIntent && motion.speedMps > 6, 'hysteresis sprint start', 5000);
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -0.71, 0, 0], buttons: { 10: true } }]);
	const hysteresisHold = await waitHistory('motion', (motion) => motion.state === 'sprint' && motion.runIntent && motion.speedMps > 4, 'hysteresis sprint hold', 5000);
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -0.60, 0, 0], buttons: { 10: true } }]);
	const hysteresisRelease = await waitHistory('motion', (motion) => motion.state === 'walk' && !motion.runIntent && motion.speedMps > 0, 'hysteresis sprint release', 5000);
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -0.71, 0, 0], buttons: { 10: true } }]);
	await sleep(420);
	const hysteresisNoRestartHistory = (await histories()).motion;
	need(!hysteresisNoRestartHistory.some((motion) => motion.state === 'sprint' || motion.runIntent === true), `mid-band restarted sprint ${JSON.stringify(hysteresisNoRestartHistory.slice(-8))}`);
	await setPads([{ index: 1 }]);
	await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'post-hysteresis idle', 5000);

	const dpadRun = await moveThenStop({ index: 1, buttons: { 12: true } }, 'D-pad forward walk');
	const dpadDir = dpadRun.direction;
	need(dpadDir?.distance > 0.5, `D-pad displacement ${dpadDir?.distance ?? 0}`);
	const dpadDot = beforeDir.x * dpadDir.x + beforeDir.z * dpadDir.z;
	need(dpadDot > 0.97, `D-pad must share camera-relative forward direction; dot=${dpadDot}`);
	need(Math.abs(dpadRun.moving.speedMps - full.speedMps) < 0.25, `D-pad digital walk speed ${dpadRun.moving.speedMps} vs ${full.speedMps}`);

	await setPads([{ index: 1, axes: [0, 0, 1, 0] }]);
	await sleep(520);
	await setPads([{ index: 1 }]);
	await sleep(120);
	const orbitRun = await moveThenStop({ index: 1, axes: [0, -1, 0, 0], values: { 7: 0.35 } }, 'post-orbit walk');
	const afterDir = orbitRun.direction;
	need(afterDir?.distance > 0.5, `post orbit displacement ${afterDir?.distance ?? 0}`);
	const cameraDirectionDot = beforeDir.x * afterDir.x + beforeDir.z * afterDir.z;
	need(cameraDirectionDot < 0.8, `camera direction dot ${cameraDirectionDot}`);

	await setPads([{ index: 1 }]);
	await sleep(120);
	await resetMotionHistory();
	await setPads([{ index: 1, buttons: { 5: true } }]);
	const parryGuard = await waitHistory('motion', (motion) => motion.state === 'guard' && motion.guarding === true && motion.parryWindowRemaining > 0, 'RB parry guard edge', 5000);
	need(parryGuard.parryWindowRemaining > 0 && parryGuard.parryWindowRemaining <= 0.16, `RB parry window ${parryGuard.parryWindowRemaining}`);
	await setPads([{ index: 1 }]);
	await waitHistory('motion', (motion) => motion.state === 'idle' && motion.isGrounded, 'RB parry release', 5000);

	const dodgeBase = await latestMotion();
	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -1, 0, 0], buttons: { 1: true } }]);
	const dodge = await waitHistory('motion', (motion) => motion.state === 'dodge' && motion.dodgeRemaining > 0 && motion.stamina < dodgeBase.stamina, 'B dodge', 5000);
	need(dodge.speedMps > full.speedMps, `dodge speed ${dodge.speedMps}`);
	await setPads([{ index: 1 }]);
	await waitHistory('motion', (motion) => motion.state === 'idle' && motion.dodgeRemaining === 0, 'dodge recovery', 5000);

	await resetMotionHistory();
	await setPads([{ index: 1, axes: [0, -1, 0, 0], buttons: { 10: true } }]);
	const sprint = await waitHistory('motion', (motion) => motion.state === 'sprint' && motion.runIntent && motion.speedMps > 6 && motion.stamina < dodge.stamina, 'sprint');

	const heavyBefore = (await histories()).inputs.filter((event) => event.kind === 'heavy').length;
	await setPads([
		{ index: 0, axes: [-1, 0, 0, 0], buttons: { 3: true } },
		{ index: 1, axes: [0, -1, 0, 0], buttons: { 10: true } },
	]);
	await sleep(350);
	let snapshot = await histories();
	need(snapshot.devices.filter((event) => event.gamepadIndex === 0).length === 0, 'hotplug steal');
	need(snapshot.inputs.filter((event) => event.kind === 'heavy').length === heavyBefore, 'inactive heavy');

	await setPads([
		{ index: 0, axes: [-1, 0, 0, 0], buttons: { 3: true, 4: true } },
		{ index: 1, connected: false },
	]);
	const fallback = await waitHistory('devices', (event) => event.device === 'gamepad' && event.gamepadIndex === 0, 'fallback');
	const guard = await waitHistory('motion', (motion) => motion.guarding === true, 'fallback guard');
	await sleep(250);
	snapshot = await histories();
	need(snapshot.inputs.filter((event) => event.kind === 'heavy').length === heavyBefore, 'phantom fallback heavy');
	need(fallback.reason === 'selected' && guard.guarding, 'fallback state');

	await setPads([{ index: 0 }]);
	await sleep(120);
	await setPads([{ index: 0, buttons: { 3: true } }]);
	const heavyInput = await waitHistory('inputs', (event) => event.kind === 'heavy' && event.source === 'gamepad', 'Y heavy');
	const heavyStart = await waitHistory('attacks', (event) => event.kind === 'heavy' && event.phase === 'start' && event.serial > lightStart.serial, 'heavy start');
	const heavyHaptic = await waitHistory('haptics', (event) => event.gamepadIndex === 0, 'heavy haptic');
	need(heavyStart.damageScale > 1 && heavyHaptic.options.strongMagnitude > lightHaptic.options.strongMagnitude, 'heavy chain');

	await setPads([]);
	const disconnected = await waitHistory('devices', (event) => event.device === 'keyboard-pointer' && event.gamepadIndex === null, 'disconnect');
	need(disconnected.reason === 'disconnected', 'disconnect reason');

	await page.screenshot({ path: path.join(outDir, 'gamepad-runtime.png'), fullPage: true });
	snapshot = await histories();
	need(errors.length === 0, `browser errors ${JSON.stringify(errors)}`);
	const metrics = {
		ok: true,
		baseline: { state: baseline.state, stamina: baseline.stamina },
		light: { input: lightInput, serial: lightStart.serial, haptic: lightHaptic.options },
		analog: { partialSpeedMps: partial.speedMps, fullSpeedMps: full.speedMps, ratio: Number(ratio.toFixed(3)), fullDisplacementMeters: Number(beforeDir.distance.toFixed(3)) },
		driftSafety: { speedMps: driftWalk.speedMps, staminaBefore: driftStaminaBefore, staminaAfter: driftLast.stamina, sprintOrDodgeStates: driftHistory.filter((motion) => motion.state === 'sprint' || motion.state === 'dodge').length },
		sprintHysteresis: { startState: hysteresisStart.state, holdState: hysteresisHold.state, releaseState: hysteresisRelease.state, noRestartSprintEvents: hysteresisNoRestartHistory.filter((motion) => motion.state === 'sprint' || motion.runIntent === true).length, holdSpeedMps: hysteresisHold.speedMps, releaseSpeedMps: hysteresisRelease.speedMps },
		dpad: { speedMps: dpadRun.moving.speedMps, directionDot: Number(dpadDot.toFixed(3)), displacementMeters: Number(dpadDir.distance.toFixed(3)) },
		camera: { directionDotAfterRightStick: Number(cameraDirectionDot.toFixed(3)), postOrbitDisplacementMeters: Number(afterDir.distance.toFixed(3)), triggerZoomExercised: 0.35 },
		parry: { state: parryGuard.state, guarding: parryGuard.guarding, windowSeconds: parryGuard.parryWindowRemaining },
		dodge: { state: dodge.state, speedMps: dodge.speedMps, staminaBefore: dodgeBase.stamina, staminaAfter: dodge.stamina },
		sprint: { speedMps: sprint.speedMps, stamina: sprint.stamina, state: sprint.state },
		fallback: { device: fallback, guarding: guard.guarding },
		heavy: { input: heavyInput, serial: heavyStart.serial, damageScale: heavyStart.damageScale, haptic: heavyHaptic.options },
		browserErrors: errors,
	};
	fs.writeFileSync(path.join(outDir, 'gamepad-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
	console.log(`PLAYER_GAMEPAD_RUNTIME_OK ${JSON.stringify({ analogRatio: metrics.analog.ratio, driftStaminaDelta: Number((metrics.driftSafety.staminaAfter - metrics.driftSafety.staminaBefore).toFixed(3)), hysteresisHold: metrics.sprintHysteresis.holdState, hysteresisRelease: metrics.sprintHysteresis.releaseState, noRestartSprintEvents: metrics.sprintHysteresis.noRestartSprintEvents, dpadDot: metrics.dpad.directionDot, cameraDot: metrics.camera.directionDotAfterRightStick, parryWindow: metrics.parry.windowSeconds, dodgeSpeedMps: dodge.speedMps, sprintSpeedMps: sprint.speedMps, errors: errors.length })}`);
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
