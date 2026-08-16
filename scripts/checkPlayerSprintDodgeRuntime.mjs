#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-sprint-dodge');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(`[checkPlayerSprintDodgeRuntime] ${message}`); };

const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

await page.addInitScript(() => {
	window.__playerMotionFrames = [];
	window.addEventListener('aapw:player-motion', (event) => {
		window.__playerMotionFrames.push(structuredClone(event.detail));
		if (window.__playerMotionFrames.length > 480) window.__playerMotionFrames.shift();
	});
});

const waitForMotionState = async (state, timeout = 4000) => {
	await page.waitForFunction(
		(expected) => window.__playerMotionFrames?.at(-1)?.state === expected,
		state,
		{ timeout },
	);
};

const waitForRecoveredSprintBudget = async (minimum, timeout = 5000) => {
	await page.waitForFunction(
		(target) => {
			const latest = window.__playerMotionFrames?.at(-1);
			return latest?.stamina >= target && latest?.sprintExhausted === false;
		},
		minimum,
		{ timeout },
	);
};

const readLatestMotion = () => page.evaluate(() => structuredClone(window.__playerMotionFrames.at(-1)));
const readVitals = () => page.evaluate(() => {
	const stamina = document.querySelector('.g3d-stamina-bar');
	const fill = document.querySelector('.g3d-stamina-bar-fill');
	return {
		role: stamina?.getAttribute('role'),
		label: stamina?.getAttribute('aria-label'),
		min: stamina?.getAttribute('aria-valuemin'),
		max: stamina?.getAttribute('aria-valuemax'),
		now: stamina?.getAttribute('aria-valuenow'),
		text: stamina?.getAttribute('aria-valuetext'),
		state: stamina?.dataset.state,
		visibleText: document.querySelector('.g3d-stamina-bar-text')?.textContent,
		fillWidth: fill?.style.width,
		fillFilter: fill?.style.filter,
	};
});
const distanceXZ = (a, b) => Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	await page.waitForFunction(() => window.__playerMotionFrames?.length > 0, null, { timeout: 15000 });
	await page.waitForFunction(
		() => document.querySelector('.g3d-stamina-bar')?.getAttribute('aria-valuenow') === '100',
		null,
		{ timeout: 15000 },
	);

	const canvas = page.locator('#game3d-canvas');
	const vitals = page.locator('.g3d-player-vitals');
	const baselinePng = await canvas.screenshot();
	const baselineVitalsPng = await vitals.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-baseline.png'), baselinePng);
	fs.writeFileSync(path.join(outDir, 'player-vitals-baseline.png'), baselineVitalsPng);
	const baseline = await readLatestMotion();
	const baselineVitals = await readVitals();
	need(baseline?.state === 'idle', `expected idle baseline, got ${baseline?.state}`);
	need(baseline.stamina === 100 && baseline.maxStamina === 100, `expected 100/100 stamina baseline, got ${baseline.stamina}/${baseline.maxStamina}`);
	need(baseline.staminaRatio === 1, `expected full stamina ratio, got ${baseline.staminaRatio}`);
	need(baseline.canDodge === true, 'full grounded baseline should report dodge ready');
	need(baselineVitals.role === 'meter' && baselineVitals.label === 'Dayanıklılık', `stamina HUD semantics missing: ${JSON.stringify(baselineVitals)}`);
	need(baselineVitals.min === '0' && baselineVitals.max === '100' && baselineVitals.now === '100', `stamina HUD baseline mismatch: ${JSON.stringify(baselineVitals)}`);
	need(baselineVitals.state === 'idle' && baselineVitals.visibleText === '100 / 100', `stamina HUD idle paint mismatch: ${JSON.stringify(baselineVitals)}`);

	// Double-run-intent dodge. Synchronize each edge to real controller telemetry instead of relying
	// on fixed millisecond sleeps that can collapse into one sampled input state on a slow runner.
	await page.keyboard.down('KeyW');
	await page.keyboard.down('ShiftLeft');
	await waitForMotionState('sprint');
	await page.keyboard.up('ShiftLeft');
	await waitForMotionState('walk');
	const beforeDodge = await readLatestMotion();
	await page.keyboard.down('ShiftLeft');
	await waitForMotionState('dodge');
	// The first observed dodge frame may only have travelled ~one 60 Hz step. Wait for actual
	// world-space burst displacement from the synchronized pre-dodge position while the real
	// controller still reports dodge instead of using a fixed sleep that varies with frame rate.
	await page.waitForFunction(
		(origin) => {
			const latest = window.__playerMotionFrames?.at(-1);
			return latest?.state === 'dodge'
				&& Math.hypot(latest.position.x - origin.x, latest.position.z - origin.z) > 0.35;
		},
		beforeDodge.position,
		{ timeout: 2500 },
	);

	const duringDodge = await page.evaluate(() => ({ latest: window.__playerMotionFrames.at(-1), frames: window.__playerMotionFrames.slice() }));
	need(duringDodge.frames.some((frame) => frame.state === 'sprint'), 'real scene never entered sprint state');
	need(duringDodge.frames.some((frame) => frame.state === 'dodge'), 'real scene never entered dodge state');
	const dodgeFrame = [...duringDodge.frames].reverse().find((frame) => frame.state === 'dodge');
	const measuredDodgeCost = beforeDodge.stamina - dodgeFrame.stamina;
	need(measuredDodgeCost >= 27.9 && measuredDodgeCost <= 28.1, `dodge cost mismatch: ${beforeDodge.stamina} -> ${dodgeFrame.stamina} (${measuredDodgeCost})`);
	need(dodgeFrame.canDodge === false, 'active dodge should close dodge-ready telemetry');
	need(distanceXZ(dodgeFrame, beforeDodge) > 0.35, 'dodge produced no independent world-space displacement');
	const dodgeVitals = await readVitals();
	need(dodgeVitals.state === 'dodge', `HUD did not enter dodge state: ${JSON.stringify(dodgeVitals)}`);
	need(Number(dodgeVitals.now) === Math.ceil(dodgeFrame.stamina), `HUD did not project dodge stamina cost: ${JSON.stringify(dodgeVitals)}`);
	need(dodgeVitals.fillFilter.includes('brightness'), 'HUD dodge emphasis was not applied');
	const dodgePng = await canvas.screenshot();
	const dodgeVitalsPng = await vitals.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-dodge.png'), dodgePng);
	fs.writeFileSync(path.join(outDir, 'player-vitals-dodge.png'), dodgeVitalsPng);

	await page.waitForTimeout(520);
	const sprintStart = await readLatestMotion();
	await page.waitForTimeout(520);
	const sprintEnd = await readLatestMotion();
	need(sprintEnd.state === 'sprint', `expected sprint after dodge, got ${sprintEnd.state}`);
	need(sprintEnd.stamina < sprintStart.stamina, `sprint did not drain stamina: ${sprintStart.stamina} -> ${sprintEnd.stamina}`);
	need(distanceXZ(sprintEnd, sprintStart) > 1.5, 'sprint did not move the real player enough');
	need(sprintEnd.speedMps > 6, `sprint telemetry speed too low: ${sprintEnd.speedMps}`);
	const sprintPng = await canvas.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-sprint.png'), sprintPng);

	await page.keyboard.up('ShiftLeft');
	await page.keyboard.up('KeyW');
	await page.waitForTimeout(1100);
	const recovery = await readLatestMotion();
	need(recovery.state === 'idle', `expected idle after input release, got ${recovery.state}`);
	need(recovery.stamina > sprintEnd.stamina, `stamina did not recover after delay: ${sprintEnd.stamina} -> ${recovery.stamina}`);

	// Sprint-jump exploit guard: while run intent + movement remain held, airborne frames may coast
	// but their stamina sequence must never increase after the normal regen delay expires.
	await page.keyboard.down('KeyW');
	await page.keyboard.down('ShiftLeft');
	await waitForMotionState('sprint');
	const airborneMarker = await page.evaluate(() => window.__playerMotionFrames.length);
	await page.keyboard.press('Space');
	await waitForMotionState('airborne', 2500);
	await waitForMotionState('sprint', 2500);
	const airborneProof = await page.evaluate((startIndex) => window.__playerMotionFrames.slice(startIndex).filter((frame) => !frame.isGrounded), airborneMarker);
	need(airborneProof.length > 0, 'sprint-jump produced no airborne telemetry');
	let maxAirborneIncrease = 0;
	for (let index = 1; index < airborneProof.length; index += 1) {
		maxAirborneIncrease = Math.max(maxAirborneIncrease, airborneProof[index].stamina - airborneProof[index - 1].stamina);
	}
	const airborneStart = airborneProof[0];
	const maxAirborneStamina = Math.max(...airborneProof.map((frame) => frame.stamina));
	need(maxAirborneIncrease <= 0.01, `stamina increased while sprint intent stayed held in air: max step +${maxAirborneIncrease.toFixed(2)}`);

	// Continue the same real sprint to zero. Exhaustion must fall back to walking movement, hold at
	// zero while Shift remains held, then reopen sprint only after the configured 20-point budget.
	await waitForMotionState('exhausted', 6000);
	const exhausted = await readLatestMotion();
	const exhaustedVitals = await readVitals();
	need(exhausted.stamina === 0 && exhausted.sprintExhausted === true, `expected zero-stamina exhausted state: ${JSON.stringify(exhausted)}`);
	need(exhausted.speedMps <= 4.2, `exhausted fallback should be walk-speed, got ${exhausted.speedMps}`);
	need(exhausted.canDodge === false, 'zero stamina must close dodge readiness');
	need(exhaustedVitals.now === '0' && exhaustedVitals.state === 'exhausted', `HUD exhaustion mismatch: ${JSON.stringify(exhaustedVitals)}`);
	need(exhaustedVitals.text?.includes('Tükendi'), `HUD exhaustion accessibility text missing: ${JSON.stringify(exhaustedVitals)}`);
	const exhaustedPng = await canvas.screenshot();
	const exhaustedVitalsPng = await vitals.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-exhausted.png'), exhaustedPng);
	fs.writeFileSync(path.join(outDir, 'player-vitals-exhausted.png'), exhaustedVitalsPng);

	await page.waitForTimeout(500);
	const heldExhausted = await readLatestMotion();
	need(heldExhausted.stamina === 0 && heldExhausted.state === 'exhausted', `held run intent regenerated without release: ${JSON.stringify(heldExhausted)}`);

	await page.keyboard.up('ShiftLeft');
	await waitForMotionState('walk');
	await waitForRecoveredSprintBudget(20, 5000);
	const restartBudget = await readLatestMotion();
	need(restartBudget.stamina >= 20 && restartBudget.sprintExhausted === false, `sprint restart budget never reopened: ${JSON.stringify(restartBudget)}`);
	await page.keyboard.down('ShiftLeft');
	await waitForMotionState('sprint');
	const restartedSprint = await readLatestMotion();
	need(restartedSprint.stamina > 0 && restartedSprint.speedMps > 6, `sprint did not restart after recovery threshold: ${JSON.stringify(restartedSprint)}`);

	await page.keyboard.up('ShiftLeft');
	await page.keyboard.up('KeyW');
	await waitForMotionState('idle');
	await page.waitForTimeout(900);
	const finalRecovery = await readLatestMotion();
	const finalVitals = await readVitals();
	need(finalRecovery.stamina > restartedSprint.stamina, `final idle recovery failed: ${restartedSprint.stamina} -> ${finalRecovery.stamina}`);
	need(finalVitals.state === 'idle' && Number(finalVitals.now) > 0, `HUD did not return to idle recovery: ${JSON.stringify(finalVitals)}`);
	need(errors.length === 0, errors.join(' | '));

	const report = {
		schema: 'aapw-player-sprint-dodge-runtime-v2',
		baseline,
		beforeDodge,
		dodge: dodgeFrame,
		measuredDodgeCost: Number(measuredDodgeCost.toFixed(2)),
		sprintStart,
		sprintEnd,
		recovery,
		airborne: {
			first: airborneStart,
			framesObserved: airborneProof.length,
			maxStamina: maxAirborneStamina,
			maxIncrease: Number(maxAirborneIncrease.toFixed(2)),
		},
		exhausted,
		heldExhausted,
		restartBudget,
		restartedSprint,
		finalRecovery,
		hud: { baseline: baselineVitals, dodge: dodgeVitals, exhausted: exhaustedVitals, final: finalVitals },
		framesObserved: duringDodge.frames.length,
		browserErrors: errors,
		sha256: {
			baseline: sha256(baselinePng),
			baselineVitals: sha256(baselineVitalsPng),
			dodge: sha256(dodgePng),
			dodgeVitals: sha256(dodgeVitalsPng),
			sprint: sha256(sprintPng),
			exhausted: sha256(exhaustedPng),
			exhaustedVitals: sha256(exhaustedVitalsPng),
		},
	};
	fs.writeFileSync(path.join(outDir, 'player-sprint-dodge-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`PLAYER_SPRINT_DODGE_RUNTIME_METRICS=${JSON.stringify(report)}`);
	console.log('PLAYER_SPRINT_DODGE_RUNTIME_OK');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
