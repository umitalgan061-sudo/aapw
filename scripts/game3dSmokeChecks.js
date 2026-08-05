/**
 * game3dSmokeChecks.js — per-entity gameplay check functions run by `smokeTestGame3D.js`.
 *
 * Split out of `smokeTestGame3D.js` originally (was 552 lines; adding `checkNpcPatrol` in-place
 * would have pushed it past this project's 600-line file cap) — see DECISIONS.md ADR-0028 for the
 * same "extract into a focused module, moved verbatim" pattern `game3d.js` itself used. Split
 * *again* run 40 (was 587/600 lines): page/scene-level checks (2D shell load, 3D mode boot, water
 * shader geometry, F4 debug camera) moved into `game3dSmokeChecksScene.js`. Split a *third* time
 * this run (was 596/600 lines; the next check added here wouldn't have fit): the waypoint-patrol/
 * flee/pack-alert movement-AI checks (wolf flee/pack-alert, NPC waypoint patrol, wolf waypoint
 * patrol) moved into `game3dSmokeChecksMovement.js`. This file now keeps only the non-movement
 * per-entity checks: settlement collider, jump arc, interaction controller, interaction-prompt tap.
 * There are now five check modules in total (run 68's split added `game3dSmokeChecksDragonFlight.js`
 * — DECISIONS.md ADR-0087); `smokeTestGame3D.js` calls every one of their exports and its own header
 * carries the authoritative module + check list.
 *
 * Every function here takes `(browser, baseUrl)` and returns `Promise<{name, ok, details}>`. See
 * each function's own comment for what it guards against.
 * @module scripts/game3dSmokeChecks
 */

/** Timeout for a page navigation (`domcontentloaded`) — asset fetches happen after this. Same
 * value/convention as `game3dSmokeChecksScene.js`'s/`game3dSmokeChecksMovement.js`'s own copies;
 * duplicated rather than shared/imported across the sibling check files since it's a single
 * primitive with no other state. */
const NAV_TIMEOUT_MS = 15000;

/**
 * Replays ADR-0037's manual collider verification as a persisted, always-run regression check.
 * Runs entirely in-page via dynamic `import()` against the real modules over HTTP (not a separate
 * unit-test harness) so it exercises the exact same module resolution the live game uses.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkSettlementCollider(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createSettlementCollider } = await import('/src/3d/physics.js');
			const { SETTLEMENT_CONFIG } = await import('/src/3d/config.js');

			const seats = [{ id: 'test-castle', x: 1000, z: 500, groundY: 10 }];
			const collider = createSettlementCollider(seats, SETTLEMENT_CONFIG);
			const expectedHalfExtent = SETTLEMENT_CONFIG.KEEP_WIDTH_METERS / 2 + 0.4;

			const center = collider.resolveXZ(1000, 500);
			const centerDist = Math.hypot(center.x - 1000, center.z - 500);
			const centerOk = Math.abs(centerDist - expectedHalfExtent) < 1e-6;

			const far = collider.resolveXZ(5000, 5000);
			const farOk = far.x === 5000 && far.z === 5000;

			let x = 1000;
			let z = 560;
			for (let i = 0; i < 3000; i++) {
				const resolved = collider.resolveXZ(x, z - 0.05);
				x = resolved.x;
				z = resolved.z;
			}
			const walkerDist = Math.hypot(x - 1000, z - 500);
			const walkerOk = Math.abs(walkerDist - expectedHalfExtent) < 1e-6;

			return { centerOk, centerDist, farOk, walkerOk, walkerDist, expectedHalfExtent };
		});
	} finally {
		await page.close();
	}
	const ok = result.centerOk && result.farOk && result.walkerOk;
	const details = ok
		? `castle-center push=${result.centerDist.toFixed(2)}m, far point unchanged, ` +
			`3000-step walker stopped at ${result.walkerDist.toFixed(2)}m (expected ${result.expectedHalfExtent}m)`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'settlement collider (physics.js)', ok, details };
}

/**
 * Regression guard for `physics.js`'s `integrateJumpArc` (run 36, DECISIONS.md ADR-0039) — FAZ 4's
 * previously-open "no gravity/jump" gap. Runs the same in-page dynamic-`import()` pattern
 * `checkSettlementCollider` above established, stepping the pure function frame-by-frame the same
 * way `gameplay/player.js`'s `update()` does, and checking the resulting arc against the closed-form
 * ballistic-motion formula (peak height `v² / (2·|g|)`, flight time `2v / |g|`) rather than just
 * "it runs without throwing".
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkJumpArc(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { integrateJumpArc } = await import('/src/3d/physics.js');
			const { PLAYER_CONFIG } = await import('/src/3d/gameplay/gameplayConfig.js');
			const gravity = PLAYER_CONFIG.GRAVITY_MPS2;
			const jumpSpeed = PLAYER_CONFIG.JUMP_SPEED_MPS;
			const delta = 1 / 60;

			// Standing still (never jumped): height/velocity 0 in, must stay grounded at height 0.
			const idle = integrateJumpArc(0, 0, delta, gravity);
			const idleOk = idle.isGrounded && idle.heightAboveGroundMeters === 0 && idle.velocityYMps === 0;

			// A full jump arc, stepped frame-by-frame exactly like `player.js`'s `update()` loop.
			let height = 0;
			let velocity = jumpSpeed;
			let peak = 0;
			let frames = 0;
			let wentNegative = false;
			let landedFrame = -1;
			for (let i = 0; i < 600 && landedFrame === -1; i++) {
				const step = integrateJumpArc(height, velocity, delta, gravity);
				height = step.heightAboveGroundMeters;
				velocity = step.velocityYMps;
				if (height < 0) wentNegative = true;
				if (height > peak) peak = height;
				frames++;
				if (step.isGrounded) landedFrame = frames;
			}

			const expectedPeak = (jumpSpeed * jumpSpeed) / (2 * -gravity);
			const expectedFlightSeconds = (2 * jumpSpeed) / -gravity;
			const expectedFrames = expectedFlightSeconds / delta;
			// Semi-implicit Euler integration (velocity updated before position each step, matching
			// `integrateJumpArc`'s own order) systematically undershoots the true continuous-time
			// peak by a small, delta-dependent amount — not a bug, just discretization error, so the
			// tolerance is wider than a floating-point epsilon on purpose.
			const peakOk = Math.abs(peak - expectedPeak) < 0.1;
			const landedOk = landedFrame > 0 && !wentNegative;
			const frameCountOk = Math.abs(frames - expectedFrames) <= 3;

			return {
				idleOk, peak, expectedPeak, peakOk, landedOk, landedFrame, frames, expectedFrames, frameCountOk,
			};
		});
	} finally {
		await page.close();
	}
	const ok = result.idleOk && result.peakOk && result.landedOk && result.frameCountOk;
	const details = ok
		? `idle stays grounded at 0, peak=${result.peak.toFixed(3)}m (expected ${result.expectedPeak.toFixed(3)}m), ` +
			`landed after ${result.frames} frames (expected ~${result.expectedFrames.toFixed(1)}), never negative`
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'jump/gravity arc (physics.js)', ok, details };
}

/**
 * Regression guard for `gameplay/interaction.js`'s `createInteractionController` (run 36, third
 * chained sub-task, DECISIONS.md ADR-0041). The module has no `THREE`/DOM dependency of its own
 * (its collaborators — `interactionPrompt`/`dialogueBox` — are injected), so this test uses plain
 * fake stubs instead of the real UI modules, same in-page dynamic-`import()` pattern as
 * `checkSettlementCollider`/`checkJumpArc` for real module resolution.
 * @returns {Promise<{name: string, ok: boolean, details: string}>}
 */
async function checkInteractionController(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');

			function makeFakes(extraOptions = {}) {
				const prompt = { visible: null, setVisible(v) { this.visible = v; } };
				const dialogue = {
					shown: null,
					shownChoices: null,
					show(text, choices = []) { this.shown = text; this.shownChoices = choices; },
					hide() { this.shown = null; this.shownChoices = null; },
				};
				const controller = createInteractionController({
					interactionPrompt: prompt,
					dialogueBox: dialogue,
					greetingTemplate: 'Selam, {name}!',
					radiusMeters: 6,
					...extraOptions,
				});
				return { prompt, dialogue, controller };
			}
			const npc = { object3D: { position: { x: 10, z: 0 } }, displayName: 'Test NPC' };
			const near = { x: 10, z: 3 }; // distance 3 < radius 6
			const far = { x: 10, z: 100 }; // distance 100 > radius 6

			const t1 = makeFakes();
			t1.controller.update([npc], far);
			const farHidesPrompt = t1.prompt.visible === false && t1.dialogue.shown === null;

			const t2 = makeFakes();
			t2.controller.update([npc], near);
			const nearShowsPrompt = t2.prompt.visible === true && t2.dialogue.shown === null;

			const t3 = makeFakes();
			t3.controller.update([npc], near);
			t3.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const eOpensDialogue = t3.dialogue.shown === 'Selam, Test NPC!' && t3.prompt.visible === false;

			const t4 = makeFakes();
			t4.controller.update([npc], near);
			t4.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t4.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const eAgainCloses = t4.dialogue.shown === null;

			const t5 = makeFakes();
			t5.controller.update([npc], near);
			t5.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t5.controller.handleKeyDown({ code: 'Escape', repeat: false });
			const escapeCloses = t5.dialogue.shown === null;

			const t6 = makeFakes();
			t6.controller.update([npc], near);
			t6.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t6.controller.update([npc], far); // player walked away while dialogue open
			const walkingAwayAutoCloses = t6.dialogue.shown === null;

			const t7 = makeFakes();
			t7.controller.update([npc], near);
			t7.controller.handleKeyDown({ code: 'KeyE', repeat: true }); // held-key repeat, must be ignored
			const repeatIgnored = t7.dialogue.shown === null;

			// run 40 (ADR-0051): per-NPC greeting lookup by object3D.name, falling back to the
			// generic template when an id has no entry — both branches asserted here.
			const namedNpc = { object3D: { position: { x: 10, z: 0 }, name: 'test-guard-1' }, displayName: 'Named NPC' };
			const t8 = makeFakes({ greetingsByNpcId: { 'test-guard-1': '{name} diyor ki: özel selam!' } });
			t8.controller.update([namedNpc], near);
			t8.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const perNpcGreetingUsed = t8.dialogue.shown === 'Named NPC diyor ki: özel selam!';

			const unnamedNpc = { object3D: { position: { x: 10, z: 0 }, name: 'unknown-id' }, displayName: 'Unknown NPC' };
			const t9 = makeFakes({ greetingsByNpcId: { 'test-guard-1': '{name} diyor ki: özel selam!' } });
			t9.controller.update([unnamedNpc], near);
			t9.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const unmappedIdFallsBackToTemplate = t9.dialogue.shown === 'Selam, Unknown NPC!';

			// run 44 (ADR-0058): choice-branching pilot. Greeting shows 2 numbered choice labels;
			// picking one (Digit1/Digit2) replaces the shown text with that choice's own response and
			// clears the choice list; E/Escape still close from either state.
			const choiceNpc = { object3D: { position: { x: 10, z: 0 }, name: 'choice-guard-1' }, displayName: 'Choice NPC' };
			const choicesByNpcId = {
				'choice-guard-1': [
					{ label: 'İlk soru?', response: '{name} diyor ki: ilk cevap.' },
					{ label: 'İkinci soru?', response: '{name} diyor ki: ikinci cevap.' },
				],
			};

			const t10 = makeFakes({ choicesByNpcId });
			t10.controller.update([choiceNpc], near);
			t10.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const greetingOffersChoiceLabels = t10.dialogue.shown === 'Selam, Choice NPC!'
				&& JSON.stringify(t10.dialogue.shownChoices) === JSON.stringify(['İlk soru?', 'İkinci soru?']);

			const t11 = makeFakes({ choicesByNpcId });
			t11.controller.update([choiceNpc], near);
			t11.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t11.controller.handleKeyDown({ code: 'Digit2', repeat: false });
			const secondChoiceShowsItsOwnResponse = t11.dialogue.shown === 'Choice NPC diyor ki: ikinci cevap.'
				&& t11.dialogue.shownChoices.length === 0;

			const t12 = makeFakes({ choicesByNpcId });
			t12.controller.update([choiceNpc], near);
			t12.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t12.controller.handleKeyDown({ code: 'Digit3', repeat: false }); // only 2 choices exist — no-op
			const outOfRangeDigitIgnored = t12.dialogue.shown === 'Selam, Choice NPC!' && t12.dialogue.shownChoices.length === 2;

			const t13 = makeFakes({ choicesByNpcId });
			t13.controller.update([choiceNpc], near);
			t13.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			t13.controller.handleKeyDown({ code: 'Digit1', repeat: false });
			t13.controller.handleKeyDown({ code: 'Digit2', repeat: false }); // choice already consumed — no-op
			const secondDigitAfterChoiceConsumedIgnored = t13.dialogue.shown === 'Choice NPC diyor ki: ilk cevap.';

			const t14 = makeFakes({ choicesByNpcId });
			t14.controller.update([choiceNpc], near);
			t14.controller.handleKeyDown({ code: 'KeyE', repeat: false }); // choices offered, not yet picked
			t14.controller.handleKeyDown({ code: 'KeyE', repeat: false }); // E still closes mid-choice
			const eClosesWhileChoicesOffered = t14.dialogue.shown === null;

			const t15 = makeFakes({ greetingsByNpcId: { 'test-guard-1': '{name} diyor ki: özel selam!' } });
			t15.controller.update([namedNpc], near); // no choicesByNpcId entry for this id at all
			t15.controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const noChoicesEntryBehavesLikeBefore = t15.dialogue.shown === 'Named NPC diyor ki: özel selam!'
				&& t15.dialogue.shownChoices.length === 0;

			return {
				farHidesPrompt, nearShowsPrompt, eOpensDialogue, eAgainCloses, escapeCloses,
				walkingAwayAutoCloses, repeatIgnored, perNpcGreetingUsed, unmappedIdFallsBackToTemplate,
				greetingOffersChoiceLabels, secondChoiceShowsItsOwnResponse, outOfRangeDigitIgnored,
				secondDigitAfterChoiceConsumedIgnored, eClosesWhileChoicesOffered, noChoicesEntryBehavesLikeBefore,
			};
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'far hides prompt, near shows it, E opens/closes, Escape closes, walking away auto-closes, key-repeat ignored, ' +
			'per-NPC greeting lookup + fallback-to-template both correct, choice-branching pilot (offer/select/' +
			'out-of-range/already-consumed/E-closes-mid-choice/no-entry-unaffected) all correct'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'interaction controller (gameplay/interaction.js)', ok, details };
}


async function checkInteractionPromptTap(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { InteractionPrompt } = await import('/src/3d/ui/interactionPrompt.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const prompt = new InteractionPrompt(container);
			let activations = 0;
			prompt.setActivateHandler(() => { activations++; });

			prompt.setVisible(false);
			prompt._el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
			const hiddenTapIgnored = activations === 0;

			prompt.setVisible(true);
			prompt._el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
			const visibleTapActivates = activations === 1;
			const actionClassApplied = prompt._el.classList.contains('g3d-interaction-prompt-action');

			prompt.setActivateHandler(null);
			prompt._el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
			const nullHandlerDisablesTap = activations === 1 && !prompt._el.classList.contains('g3d-interaction-prompt-action');

			prompt.dispose();
			container.remove();
			return { hiddenTapIgnored, visibleTapActivates, actionClassApplied, nullHandlerDisablesTap };
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	const details = ok
		? 'prompt tap only activates while visible and handler-enabled; disabling the handler removes the action class'
		: `FAILED assertion(s): ${JSON.stringify(result)}`;
	return { name: 'interaction prompt tap activation (ui/interactionPrompt.js)', ok, details };
}

module.exports = {
	checkSettlementCollider,
	checkJumpArc,
	checkInteractionController,
	checkInteractionPromptTap,
};
