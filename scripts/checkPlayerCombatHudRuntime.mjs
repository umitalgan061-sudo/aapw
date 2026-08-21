#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = path.resolve(outArg ? outArg.slice('--out-dir='.length) : 'artifacts/player-combat-hud');
const need = (ok, message) => { if (!ok) throw new Error(`[player-combat-hud-runtime] ${message}`); };
const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright unavailable');
fs.mkdirSync(outDir, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

// The attack active window is intentionally short. Capture the HUD after the canonical event has
// completed dispatch rather than racing a later Playwright DOM read against the following frame.
await page.addInitScript(() => {
	window.__combatHudAttackSamples = [];
	window.addEventListener('aapw:player-attack-window', (event) => {
		if (event?.detail?.phase !== 'active-start') return;
		queueMicrotask(() => {
			const el = document.querySelector('.g3d-combat-status');
			window.__combatHudAttackSamples.push({
				serial: event.detail.serial,
				kind: event.detail.kind,
				phase: event.detail.phase,
				comboStep: event.detail.comboStep,
				text: el?.textContent ?? '',
				state: el?.dataset.state ?? '',
				range: el?.dataset.range ?? '',
			});
		});
	});
});

try {
	await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
	await page.locator('#run266-entry-enter').click();
	await page.waitForFunction(() => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'), null, { timeout: 90000 });
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.textContent?.includes('Serbest'), null, { timeout: 15000 });
	const baseline = await page.locator('.g3d-combat-status').evaluate((el) => ({ text: el.textContent, role: el.getAttribute('role'), live: el.getAttribute('aria-live'), state: el.dataset.state ?? '', range: el.dataset.range ?? '' }));
	need(baseline.role === 'status' && baseline.live === 'polite', `combat HUD accessibility contract missing: ${JSON.stringify(baseline)}`);

	// Real unlocked melee must remain valid: reach telemetry exists, but without a lock there is no
	// range comparison and the HUD must stay `unknown` rather than dereferencing an absent target.
	await page.keyboard.press('KeyE');
	await page.waitForFunction(() => window.__combatHudAttackSamples?.some((sample) => sample.kind === 'light' && sample.phase === 'active-start'), null, { timeout: 10000 });
	const active = await page.evaluate(() => window.__combatHudAttackSamples.find((sample) => sample.kind === 'light' && sample.phase === 'active-start'));
	need(active?.state === 'attack-active-start' && active.text.includes('Hafif') && active.text.includes('VURUŞ'), `real light attack did not project active phase: ${JSON.stringify(active)}`);
	need(active.text.includes('Erişim') && active.text.includes('Güç'), `real attack tuning missing from HUD: ${JSON.stringify(active)}`);
	need(active.range === 'unknown', `unlocked melee must not fabricate a range comparison: ${JSON.stringify(active)}`);
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.dataset.state === 'free', null, { timeout: 15000 });

	const lockProjection = await page.evaluate(() => { globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: true, targetId: 'runtime-guard', distanceMeters: 12.345, reason: 'acquired' } })); const el = document.querySelector('.g3d-combat-status'); return { text: el?.textContent ?? '', state: el?.dataset.state ?? '', range: el?.dataset.range ?? '' }; });
	need(lockProjection.state === 'locked' && lockProjection.text.includes('runtime-guard') && lockProjection.text.includes('12.3 m'), `lock event projection failed: ${JSON.stringify(lockProjection)}`);
	const outOfRange = await page.evaluate(() => {
		globalThis.dispatchEvent(new CustomEvent('aapw:player-attack-window', { detail: { kind: 'light', phase: 'active-start', comboStep: 2, reachMeters: 1.65, damageScale: 1 } }));
		const el = document.querySelector('.g3d-combat-status');
		return { text: el?.textContent ?? '', state: el?.dataset.state ?? '', range: el?.dataset.range ?? '' };
	});
	need(outOfRange.state === 'attack-active-start' && outOfRange.range === 'out-of-range' && outOfRange.text.includes('UZAK') && outOfRange.text.includes('Erişim 1.6 m') && outOfRange.text.includes('Seri x2'), `out-of-range melee cue failed: ${JSON.stringify(outOfRange)}`);
	const inRange = await page.evaluate(() => {
		globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: true, targetId: 'runtime-guard', distanceMeters: 1.2, reason: 'tracking' } }));
		const el = document.querySelector('.g3d-combat-status');
		return { text: el?.textContent ?? '', state: el?.dataset.state ?? '', range: el?.dataset.range ?? '' };
	});
	need(inRange.range === 'in-range' && inRange.text.includes('MENZİLDE') && inRange.text.includes('1.2 m'), `in-range melee cue failed: ${JSON.stringify(inRange)}`);
	await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent('aapw:player-attack-window', { detail: { kind: 'light', phase: 'finish', comboStep: 2, reachMeters: 1.65, damageScale: 1 } })));

	// Defense feedback consumes the same fields the Player defense adapter writes before health
	// consumption. Distinct sentinel amounts let the live-world proof assert that this exact synthetic
	// feedback yields within the bounded window even if a newer real defense event legitimately replaces it.
	const parrySentinel = '17.3 savuşturuldu';
	const parryProjection = await page.evaluate(async () => { const { gameEvents } = await import('./src/3d/eventBus.js'); const { EVENTS } = await import('./src/3d/config.js'); gameEvents.emit(EVENTS.PLAYER_DAMAGED, { rawAmount: 17.25, blockedAmount: 17.25, amount: 0, mitigation: 'parry' }); const el = document.querySelector('.g3d-combat-status'); return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' }; });
	need(parryProjection.state === 'defense-parry' && parryProjection.text.includes('PARRY') && parryProjection.text.includes(parrySentinel), `parry mitigation detail failed: ${JSON.stringify(parryProjection)}`);
	await page.waitForFunction((sentinel) => !document.querySelector('.g3d-combat-status')?.textContent?.includes(sentinel), parrySentinel, { timeout: 3000 });
	const afterParry = await page.locator('.g3d-combat-status').evaluate((el) => ({ text: el.textContent, state: el.dataset.state ?? '' }));
	need(!afterParry.text.includes(parrySentinel), `synthetic parry feedback did not yield: ${JSON.stringify(afterParry)}`);
	const lockAfterParry = await page.evaluate(() => {
		globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: true, targetId: 'runtime-guard', distanceMeters: 1.2, reason: 'tracking' } }));
		const el = document.querySelector('.g3d-combat-status');
		return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' };
	});
	need(lockAfterParry.state === 'locked' && lockAfterParry.text.includes('runtime-guard'), `post-parry lock projection failed: ${JSON.stringify(lockAfterParry)}`);

	const guardSentinel = '13.3 engellendi';
	const guardProjection = await page.evaluate(async () => { const { gameEvents } = await import('./src/3d/eventBus.js'); const { EVENTS } = await import('./src/3d/config.js'); gameEvents.emit(EVENTS.PLAYER_DAMAGED, { rawAmount: 23.25, blockedAmount: 13.25, amount: 10, mitigation: 'guard' }); const el = document.querySelector('.g3d-combat-status'); return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' }; });
	need(guardProjection.state === 'defense-guard' && guardProjection.text.includes('BLOK') && guardProjection.text.includes(guardSentinel) && guardProjection.text.includes('10.0 hasar'), `guard mitigation detail failed: ${JSON.stringify(guardProjection)}`);
	await page.waitForFunction((sentinel) => !document.querySelector('.g3d-combat-status')?.textContent?.includes(sentinel), guardSentinel, { timeout: 3000 });
	const afterGuard = await page.locator('.g3d-combat-status').evaluate((el) => ({ text: el.textContent, state: el.dataset.state ?? '' }));
	need(!afterGuard.text.includes(guardSentinel), `synthetic guard feedback did not yield: ${JSON.stringify(afterGuard)}`);
	const lockAfterGuard = await page.evaluate(() => {
		globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: true, targetId: 'runtime-guard', distanceMeters: 1.2, reason: 'tracking' } }));
		const el = document.querySelector('.g3d-combat-status');
		return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' };
	});
	need(lockAfterGuard.state === 'locked' && lockAfterGuard.text.includes('runtime-guard'), `post-guard lock projection failed: ${JSON.stringify(lockAfterGuard)}`);
	await page.evaluate(() => globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: false, targetId: 'runtime-guard', reason: 'toggle-release' } })));
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.dataset.state === 'free');

	const noTarget = await page.evaluate(() => {
		globalThis.dispatchEvent(new CustomEvent('aapw:player-lock-on', { detail: { locked: false, targetId: null, reason: 'no-target' } }));
		const el = document.querySelector('.g3d-combat-status');
		return { text: el?.textContent ?? '', state: el?.dataset.state ?? '' };
	});
	need(noTarget.state === 'no-target' && noTarget.text.includes('Hedef yok'), `failed lock feedback missing: ${JSON.stringify(noTarget)}`);
	await page.waitForFunction(() => document.querySelector('.g3d-combat-status')?.dataset.state === 'free', null, { timeout: 2500 });
	const noTargetReset = await page.locator('.g3d-combat-status').evaluate((el) => ({ text: el.textContent, state: el.dataset.state ?? '' }));
	need(noTargetReset.text.includes('Serbest'), `failed lock feedback did not reset: ${JSON.stringify(noTargetReset)}`);

	await page.screenshot({ path: path.join(outDir, 'combat-hud-runtime.png'), fullPage: true });
	need(errors.length === 0, `browser/page errors: ${JSON.stringify(errors)}`);
	const metrics = { ok: true, baseline, active, lockProjection, outOfRange, inRange, parryProjection, afterParry, lockAfterParry, guardProjection, afterGuard, lockAfterGuard, noTarget, noTargetReset, browserErrors: errors };
	fs.writeFileSync(path.join(outDir, 'combat-hud-runtime.json'), `${JSON.stringify(metrics, null, 2)}\n`);
	console.log(`PLAYER_COMBAT_HUD_RUNTIME_OK ${JSON.stringify({ active: active.text, unlockedRange: active.range, locked: lockProjection.text, outOfRange: outOfRange.text, inRange: inRange.text, parry: parryProjection.text, afterParry: afterParry.state, guard: guardProjection.text, afterGuard: afterGuard.state, noTarget: noTarget.text, reset: noTargetReset.text, errors: errors.length })}`);
} finally {
	await browser.close();
	await new Promise((resolve) => server.close(resolve));
}
