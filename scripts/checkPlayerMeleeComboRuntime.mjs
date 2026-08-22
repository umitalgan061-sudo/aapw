#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-stamina-dodge');
const need = (ok, message) => { if (!ok) throw new Error(`[player-melee-combo-runtime] ${message}`); };
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
	window.__meleeMotion = [];
	window.__meleeWindows = [];
	window.__meleeInputs = [];
	window.__meleeBufferHeavy = false;
	window.addEventListener('aapw:player-motion', (event) => {
		window.__meleeMotion.push(structuredClone(event.detail));
		if (window.__meleeMotion.length > 900) window.__meleeMotion.shift();
	});
	window.addEventListener('aapw:player-attack-window', (event) => {
		const detail = structuredClone(event.detail);
		window.__meleeWindows.push(detail);
		if (window.__meleeBufferHeavy && detail.kind === 'light' && detail.phase === 'active-end') {
			window.__meleeBufferHeavy = false;
			window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true }));
			window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', key: 'r', bubbles: true }));
		}
	});
	window.addEventListener('aapw:player-combat-input', (event) => window.__meleeInputs.push(structuredClone(event.detail)));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const latestMotion = () => page.evaluate(() => structuredClone(window.__meleeMotion.at(-1)));
const motionHistory = () => page.evaluate(() => structuredClone(window.__meleeMotion));
const attackWindows = () => page.evaluate(() => structuredClone(window.__meleeWindows));
const combatInputs = () => page.evaluate(() => structuredClone(window.__meleeInputs));
const recoveryProofTimeoutMs = 20000;
const lfsPointerPrefix = 'version https://git-lfs.github.com/spec/v1';
const lfsPointerCache = new Map();
async function isVerifiedLfsPointerAsset(assetPath) {
	if (lfsPointerCache.has(assetPath)) return lfsPointerCache.get(assetPath);
	let isPointer = false;
	try {
		const prefix = await page.evaluate(async (url) => {
			const response = await fetch(`/${url}`, { cache: 'no-store' });
			return (await response.text()).slice(0, 96);
		}, assetPath);
		isPointer = prefix.startsWith(lfsPointerPrefix);
	} catch {
		isPointer = false;
	}
	lfsPointerCache.set(assetPath, isPointer);
	return isPointer;
}
async function classifyBrowserErrors(recordedErrors) {
	const runtimeErrors = [];
	const lfsPointerErrors = [];
	const assetPattern = /assets\/[^"')},\s]+?\.(?:glb|fbx)/g;
	for (const error of recordedErrors) {
		if (!error.startsWith('console:')) {
			runtimeErrors.push(error);
			continue;
		}
		const assetPaths = [...new Set(error.match(assetPattern) || [])];
		if (assetPaths.length === 0) {
			runtimeErrors.push(error);
			continue;
		}
		const checks = await Promise.all(assetPaths.map((assetPath) => isVerifiedLfsPointerAsset(assetPath)));
		if (checks.every(Boolean)) lfsPointerErrors.push(error);
		else runtimeErrors.push(error);
	}
	return Object.freeze({
		runtimeErrors,
		lfsPointerErrors,
		lfsPointerAssets: [...lfsPointerCache.entries()].filter(([, isPointer]) => isPointer).map(([assetPath]) => assetPath).sort(),
	});
}
async function waitFor(read, predicate, label, timeout = 6000, interval = 40) {
	const deadline = Date.now() + timeout; let last = null;
	while (Date.now() < deadline) {
		last = await read();
		const found = predicate(last);
		if (found) return found;
		await sleep(interval);
	}
	throw new Error(`[player-melee-combo-runtime] timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}
const waitMotion = (predicate, label, timeout) => waitFor(motionHistory, (motions) => [...motions].reverse().find(predicate) ?? null, label, timeout);
const waitWindow = (predicate, label, timeout) => waitFor(attackWindows, (events) => [...events].reverse().find(predicate) ?? null, label, timeout);
const planarDistance = (a, b) => Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0));
function closestActiveMotion(event, motions, label) {
	const candidates = (motions || []).filter((motion) => motion.attackKind === event?.kind && motion.attackComboStep === event?.comboStep && motion.attackActive && motion.position);
	need(candidates.length > 0, `${label} needs active Player motion telemetry for the same combo step`);
	return candidates.reduce((closest, motion) => planarDistance(event.position, motion.position) < planarDistance(event.position, closest.position) ? motion : closest);
}
function validateActiveAnchor(event, motions, baseline, label) {
	const motion = closestActiveMotion(event, motions, label);
	const facingLength = Math.hypot(event?.facing?.x ?? 0, event?.facing?.z ?? 0);
	const eventMotionDelta = planarDistance(event?.position, motion?.position);
	const groundDelta = Math.abs((event?.position?.y ?? Infinity) - (baseline?.position?.y ?? 0));
	need(Math.abs(facingLength - 1) <= 0.002, `${label} facing must be normalized; got ${facingLength}`);
	need(eventMotionDelta <= 0.05, `${label} attack-window anchor must match same-step Player motion history; delta=${eventMotionDelta}`);
	need(groundDelta <= 0.05, `${label} active anchor drifted from grounded baseline; deltaY=${groundDelta}`);
	return Object.freeze({ facingLength: Number(facingLength.toFixed(5)), eventMotionDelta: Number(eventMotionDelta.toFixed(4)), groundDelta: Number(groundDelta.toFixed(4)) });
}

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	const baseline = await waitMotion((motion) => motion.state === 'idle' && motion.isGrounded, 'grounded idle baseline', 15000);
	need(baseline.stamina === 100 && baseline.attackKind === 'none' && baseline.attackPhase === 'none', `bad baseline ${JSON.stringify(baseline)}`);

	await page.evaluate(() => { window.__meleeBufferHeavy = true; });
	await page.keyboard.press('KeyE');
	const lightStart = await waitWindow((event) => event.phase === 'start' && event.kind === 'light' && event.comboStep === 1, 'keyboard light attack start');
	need(Math.abs(lightStart.stamina - 88) < 0.2, `light stamina cost should be 12, got ${lightStart.stamina}`);
	const lightActive = await waitWindow((event) => event.serial === lightStart.serial && event.phase === 'active-start' && event.active, 'light active window');
	need(lightActive.reachMeters >= 1.5 && lightActive.damageScale === 1, `bad light hit window ${JSON.stringify(lightActive)}`);
	const lockedLight = await waitMotion((motion) => motion.attackKind === 'light' && motion.attackActive, 'light active motion');
	need(!lockedLight.canDodge && !lockedLight.guarding && lockedLight.state === 'attack-light', `light attack must lock dodge/guard ${JSON.stringify(lockedLight)}`);
	const lightGeometry = validateActiveAnchor(lightActive, await motionHistory(), baseline, 'light');

	await waitWindow((event) => event.serial === lightStart.serial && event.phase === 'active-end', 'light active-end recovery buffer window');
	const bufferedHeavyInput = await waitFor(combatInputs, (events) => [...events].reverse().find((event) => event.kind === 'heavy' && event.source === 'keyboard') ?? null, 'buffered heavy keyboard intent');
	const heavyStart = await waitWindow((event) => event.phase === 'start' && event.kind === 'heavy' && event.comboStep === 2, 'buffered heavy combo start');
	need(bufferedHeavyInput.kind === 'heavy', 'heavy combo must use the shared keyboard combat-intent path');
	need(heavyStart.serial > lightStart.serial, 'heavy chain needs a new attack serial');
	need(Math.abs(heavyStart.stamina - 64) < 0.25, `light+heavy chain should spend 36 stamina, got ${heavyStart.stamina}`);
	const heavyActive = await waitWindow((event) => event.serial === heavyStart.serial && event.phase === 'active-start' && event.active, 'heavy active window');
	need(heavyActive.reachMeters > lightActive.reachMeters && heavyActive.damageScale > lightActive.damageScale, 'heavy attack needs stronger reach/damage metadata');
	const lockedHeavy = await waitMotion((motion) => motion.attackKind === 'heavy' && motion.attackActive, 'heavy active motion');
	const heavyGeometry = validateActiveAnchor(heavyActive, await motionHistory(), baseline, 'heavy');
	await waitWindow((event) => event.serial === heavyStart.serial && event.phase === 'finish', 'heavy recovery finish', recoveryProofTimeoutMs);
	await waitMotion((motion) => motion.state === 'idle' && motion.attackKind === 'none', 'post-combo idle', recoveryProofTimeoutMs);

	const windowsBeforeGuard = (await attackWindows()).length;
	await page.keyboard.down('KeyQ');
	await waitMotion((motion) => motion.state === 'guard' && motion.guarding, 'guard before blocked attack intent', 6000);
	await page.keyboard.press('KeyE');
	await sleep(450);
	const guardStill = await latestMotion();
	need(guardStill.state === 'guard' && guardStill.guarding && guardStill.attackKind === 'none', `attack must not start through held guard ${JSON.stringify(guardStill)}`);
	need((await attackWindows()).length === windowsBeforeGuard, 'expired guard-held attack intent must not publish an attack window');
	await page.keyboard.up('KeyQ');
	await waitMotion((motion) => motion.state === 'idle', 'idle after guard release', 6000);

	await page.evaluate(async () => {
		const { TouchJoystick } = await import('./src/3d/ui/touchJoystick.js');
		window.__meleeTouch = new TouchJoystick(document.body);
		document.querySelector('.g3d-touch-light-attack-button')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9001 }));
	});
	const touchInput = await waitFor(combatInputs, (events) => [...events].reverse().find((event) => event.kind === 'light' && event.source === 'touch') ?? null, 'touch light combat intent');
	const touchStart = await waitWindow((event) => event.phase === 'start' && event.kind === 'light' && event.serial > heavyStart.serial, 'touch light attack start');
	need(touchInput.source === 'touch' && touchStart.comboStep === 1, `touch attack must enter the same Player state machine ${JSON.stringify({ touchInput, touchStart })}`);
	await waitWindow((event) => event.serial === touchStart.serial && event.phase === 'finish', 'touch attack finish', recoveryProofTimeoutMs);
	await page.evaluate(() => { window.__meleeTouch?.dispose?.(); window.__meleeTouch = null; });

	await page.screenshot({ path: path.join(outDir, 'melee-combo.png'), fullPage: true });
	const allWindows = await attackWindows();
	const allInputs = await combatInputs();
	const classifiedErrors = await classifyBrowserErrors(errors);
	need(classifiedErrors.runtimeErrors.length === 0, `browser/page errors: ${JSON.stringify(classifiedErrors.runtimeErrors)}`);
	const metrics = {
		ok: true,
		baseline,
		light: { start: lightStart, active: lightActive, lockedMotion: lockedLight, geometry: lightGeometry },
		heavy: { input: bufferedHeavyInput, start: heavyStart, active: heavyActive, lockedMotion: lockedHeavy, geometry: heavyGeometry },
		touch: { input: touchInput, start: touchStart },
		windowPhases: allWindows.map(({ serial, kind, comboStep, phase, active }) => ({ serial, kind, comboStep, phase, active })),
		inputSources: allInputs,
		browserErrors: classifiedErrors.runtimeErrors,
		verifiedUnhydratedLfsPointerErrors: classifiedErrors.lfsPointerErrors.length,
		verifiedUnhydratedLfsPointerAssets: classifiedErrors.lfsPointerAssets,
	};
	fs.writeFileSync(path.join(outDir, 'melee-combo.json'), `${JSON.stringify(metrics, null, 2)}\n`);
	console.log(`PLAYER_MELEE_COMBO_RUNTIME_OK ${JSON.stringify({ lightStamina: lightStart.stamina, heavyStamina: heavyStart.stamina, touchSerial: touchStart.serial, lightGeometry, heavyGeometry, errors: classifiedErrors.runtimeErrors.length, verifiedLfsPointers: classifiedErrors.lfsPointerAssets.length })}`);
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
