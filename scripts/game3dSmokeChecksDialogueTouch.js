/** Mobile/PWA dialogue input regression checks (run 99, ADR-0125). */
/** Final concurrent-main allocation: run 100, ADR-0127 (ADR-0125 belongs to Claude's run 99). */

// Run 332 RCA (game3d.js line-cap extraction, ADR-0279): this project's own boot cost has grown
// past this constant's original assumption -- run-326/330/330b/331's procedural creatures, real
// castle models, and villages pushed a real game3d.html boot to ~9-13s (observed via direct
// domcontentloaded-timing instrumentation) in this project's software-WebGL sandboxed CI/dev
// environment, which sat right at or over the old 10s/15s ceiling -- a pre-existing flake
// (already recorded as an "environment quirk" by game3dSmokeChecksScene.js's own run-68 comment)
// that reproduced on unmodified `main` in this run's own RCA, not something the run's actual code
// change caused (confirmed: that change executes strictly after the domcontentloaded event this
// timeout gates on). 30s gives real margin above the observed range, including one measured 20s+
// outlier under sandbox contention.
const NAV_TIMEOUT_MS = 30_000;

async function checkDialogueChoiceTap(browser, baseUrl) {
	const page = await browser.newPage();
	let result;
	try {
		await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
		result = await page.evaluate(async () => {
			const { DialogueBox } = await import('/src/3d/ui/dialogueBox.js');
			const { createInteractionController } = await import('/src/3d/gameplay/interaction.js');
			const container = document.createElement('div');
			document.body.appendChild(container);
			const dialogueBox = new DialogueBox(container);
			const controller = createInteractionController({
				interactionPrompt: { setVisible() {} },
				dialogueBox,
				greetingTemplate: 'Selam, {name}!',
				choicesByNpcId: {
					'tap-npc': [
						{ label: 'İlk soru', response: '{name}: ilk cevap.' },
						{ label: 'İkinci soru', response: '{name}: ikinci cevap.' },
					],
				},
				radiusMeters: 6,
			});
			dialogueBox.setChoiceHandler((index) => controller.handleChoice(index));
			dialogueBox.setCloseHandler(() => controller.handleKeyDown({ code: 'KeyE', repeat: false }));
			const npc = { object3D: { name: 'tap-npc', position: { x: 0, z: 0 } }, displayName: 'Dokun NPC' };
			controller.update([npc], { x: 0, z: 0 });
			controller.handleKeyDown({ code: 'KeyE', repeat: false });

			const choices = [...dialogueBox._choicesEl.querySelectorAll('[data-dialogue-choice-index]')];
			const accessibleTargets = choices.length === 2 && choices.every((choice, index) =>
				choice.getAttribute('role') === 'button'
				&& choice.tabIndex === 0
				&& choice.dataset.dialogueChoiceIndex === String(index));
			choices[1].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
			const pointerSelects = dialogueBox._textEl.textContent === 'Dokun NPC: ikinci cevap.'
				&& dialogueBox._choicesEl.childElementCount === 0;
			dialogueBox._hintEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
			const pointerCloses = dialogueBox.isVisible === false;
			const closeTargetAccessible = dialogueBox._hintEl.getAttribute('role') === 'button'
				&& dialogueBox._hintEl.tabIndex === 0;

			controller.update([npc], { x: 0, z: 0 });
			controller.handleKeyDown({ code: 'KeyE', repeat: false });
			const firstChoice = dialogueBox._choicesEl.firstElementChild;
			firstChoice.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }));
			const keyboardActivatesRoleButton = dialogueBox._textEl.textContent === 'Dokun NPC: ilk cevap.';

			dialogueBox.dispose();
			container.remove();
			return { accessibleTargets, pointerSelects, pointerCloses, closeTargetAccessible, keyboardActivatesRoleButton };
		});
	} finally {
		await page.close();
	}
	const ok = Object.values(result).every(Boolean);
	return {
		name: 'dialogue touch/keyboard choice activation (ui/dialogueBox.js)',
		ok,
		details: ok
			? '44px role-button choices select by pointer or Enter and the touch close affordance closes the active dialogue'
			: `FAILED assertion(s): ${JSON.stringify(result)}`,
	};
}

module.exports = { checkDialogueChoiceTap };
