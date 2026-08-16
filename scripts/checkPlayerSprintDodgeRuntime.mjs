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
		if (window.__playerMotionFrames.length > 240) window.__playerMotionFrames.shift();
	});
});

const waitForMotionState = async (state, timeout = 3000) => {
	await page.waitForFunction(
		(expected) => window.__playerMotionFrames?.at(-1)?.state === expected,
		state,
		{ timeout },
	);
};

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	await page.waitForFunction(() => window.__playerMotionFrames?.length > 0, null, { timeout: 15000 });

	const canvas = page.locator('#game3d-canvas');
	const baselinePng = await canvas.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-baseline.png'), baselinePng);
	const baseline = await page.evaluate(() => window.__playerMotionFrames.at(-1));
	need(baseline?.state === 'idle', `expected idle baseline, got ${baseline?.state}`);
	need(baseline.stamina === 100, `expected full stamina baseline, got ${baseline.stamina}`);

	await page.keyboard.down('KeyW');
	await page.keyboard.down('ShiftLeft');
	await waitForMotionState('sprint');
	await page.keyboard.up('ShiftLeft');
	await waitForMotionState('walk');
	await page.keyboard.down('ShiftLeft');
	await waitForMotionState('dodge');

	const duringDodge = await page.evaluate(() => ({ latest: window.__playerMotionFrames.at(-1), frames: window.__playerMotionFrames.slice() }));
	need(duringDodge.frames.some((frame) => frame.state === 'sprint'), 'real scene never entered sprint state');
	need(duringDodge.frames.some((frame) => frame.state === 'dodge'), 'real scene never entered dodge state');
	const dodgeFrame = [...duringDodge.frames].reverse().find((frame) => frame.state === 'dodge');
	need(dodgeFrame.stamina <= 71, `dodge did not spend expected stamina: ${dodgeFrame.stamina}`);
	need(Math.hypot(dodgeFrame.position.x - baseline.position.x, dodgeFrame.position.z - baseline.position.z) > 0.35, 'dodge produced no world-space displacement');
	const dodgePng = await canvas.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-dodge.png'), dodgePng);

	await page.waitForTimeout(520);
	const sprintStart = await page.evaluate(() => window.__playerMotionFrames.at(-1));
	await page.waitForTimeout(520);
	const sprintEnd = await page.evaluate(() => window.__playerMotionFrames.at(-1));
	need(sprintEnd.state === 'sprint', `expected sprint after dodge, got ${sprintEnd.state}`);
	need(sprintEnd.stamina < sprintStart.stamina, `sprint did not drain stamina: ${sprintStart.stamina} -> ${sprintEnd.stamina}`);
	need(Math.hypot(sprintEnd.position.x - sprintStart.position.x, sprintEnd.position.z - sprintStart.position.z) > 1.5, 'sprint did not move the real player enough');
	const sprintPng = await canvas.screenshot();
	fs.writeFileSync(path.join(outDir, 'player-sprint.png'), sprintPng);

	await page.keyboard.up('ShiftLeft');
	await page.keyboard.up('KeyW');
	await page.waitForTimeout(1100);
	const recovery = await page.evaluate(() => window.__playerMotionFrames.at(-1));
	need(recovery.state === 'idle', `expected idle after input release, got ${recovery.state}`);
	need(recovery.stamina > sprintEnd.stamina, `stamina did not recover after delay: ${sprintEnd.stamina} -> ${recovery.stamina}`);
	need(errors.length === 0, errors.join(' | '));

	const report = {
		schema: 'aapw-player-sprint-dodge-runtime-v1', baseline, dodge: dodgeFrame, sprintStart, sprintEnd, recovery,
		framesObserved: duringDodge.frames.length,
		browserErrors: errors,
		sha256: { baseline: sha256(baselinePng), dodge: sha256(dodgePng), sprint: sha256(sprintPng) },
	};
	fs.writeFileSync(path.join(outDir, 'player-sprint-dodge-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
	console.log(`PLAYER_SPRINT_DODGE_RUNTIME_METRICS=${JSON.stringify(report)}`);
	console.log('PLAYER_SPRINT_DODGE_RUNTIME_OK');
} finally {
	await page.close();
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
