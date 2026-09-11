#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('fs');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assertStaticWiring() {
	const touchSource = fs.readFileSync('src/3d/ui/touchJoystick.js', 'utf8');
	const gameSource = fs.readFileSync('src/3d/game3d.js', 'utf8');
	const helpSource = fs.readFileSync('src/3d/ui/controlsHelp.js', 'utf8');
	const cssSource = fs.readFileSync('game3d.css', 'utf8');

	assert.match(touchSource, /className = 'g3d-touch-jump-button'/, 'touch joystick must create the jump button');
	assert.match(touchSource, /consumeJumpRequested\(\)/, 'touch joystick must expose an edge-triggered jump consumer');
	assert.match(touchSource, /_jumpRequested = false/, 'touch jump state must be resettable');
	assert.match(touchSource, /removeEventListener\('click', this\._onJumpClick\)/, 'dispose must remove the jump listener');

	const consumeLine = 'if (state.touchJoystick?.consumeJumpRequested()) keyboardAxes.jumpRequested = true;';
	const playerUpdateLine = 'state.player.update(delta, moveDirection, axes.running, keyboardAxes.jumpRequested);';
	assert.ok(gameSource.includes(consumeLine), 'game loop must merge the mobile jump edge into the existing player jump flag');
	assert.ok(gameSource.indexOf(consumeLine) < gameSource.indexOf(playerUpdateLine), 'mobile jump must be consumed before player.update');
	assert.match(helpSource, /\['Zıpla', 'Sağdaki Zıpla düğmesine dokun'\]/, 'mobile controls help must document the jump control');
	assert.match(cssSource, /\.g3d-touch-jump-button\s*\{[\s\S]*?width:\s*64px;[\s\S]*?height:\s*64px;/, 'jump button must keep a 64px touch target');
}

function overlaps(a, b) {
	return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

async function main() {
	assertStaticWiring();
	const playwright = loadPlaywright();
	if (!playwright) process.exit(2);
	const server = await startStaticServer();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	const browser = await playwright.chromium.launch({ headless: true });
	const errors = [];
	try {
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
		const page = await context.newPage();
		page.on('pageerror', (error) => errors.push(`page:${error.message}`));
		page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await page.waitForFunction(() => document.getElementById('game3d-loading')?.classList.contains('g3d-loading-hidden'), { timeout: 60000 });

		const layout = await page.evaluate(() => {
			const toRect = (element) => {
				const rect = element.getBoundingClientRect();
				return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
			};
			const jump = document.querySelector('.g3d-touch-jump-button');
			const joystick = document.querySelector('.g3d-joystick-base');
			const help = document.querySelector('.g3d-controls-help-button');
			return {
				jump: jump ? { rect: toRect(jump), text: jump.textContent.trim(), ariaLabel: jump.getAttribute('aria-label') } : null,
				joystick: joystick ? toRect(joystick) : null,
				help: help ? toRect(help) : null,
			};
		});

		assert.ok(layout.jump, 'mobile runtime must render the jump button');
		assert.equal(layout.jump.text, 'Zıpla', 'jump button label must remain Turkish');
		assert.equal(layout.jump.ariaLabel, 'Zıpla', 'jump button accessible name must remain Turkish');
		assert.ok(layout.jump.rect.width >= 44 && layout.jump.rect.height >= 44, 'jump touch target must be at least 44x44px');
		assert.ok(layout.joystick, 'mobile runtime must still render the movement joystick');
		assert.ok(layout.help, 'mobile runtime must still render the controls-help button');
		assert.equal(overlaps(layout.jump.rect, layout.joystick), false, 'jump button must not overlap the movement joystick');
		assert.equal(overlaps(layout.jump.rect, layout.help), false, 'jump button must not overlap the controls-help button');

		await page.click('.g3d-touch-jump-button');
		await page.waitForTimeout(100);
		assert.deepEqual(errors, [], 'mobile jump activation must not cause console/page errors');
		await context.close();
		console.log(`[checkMobileJumpControl] PASS: live mobile button ${layout.jump.rect.width}x${layout.jump.rect.height}px, no joystick/help overlap, click path clean.`);
	} finally {
		await browser.close();
		server.close();
	}
}

main().catch((error) => {
	console.error('[checkMobileJumpControl] FAIL:', error.message || error);
	process.exit(1);
});
