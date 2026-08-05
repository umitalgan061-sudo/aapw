/**
 * Fixed-position DOM dialogue box (FAZ 5, run 33 — the second step of the interaction system after
 * `ui/interactionPrompt.js`'s proximity affordance). Same DOM-ownership pattern as
 * `ui/touchJoystick.js`/`ui/interactionPrompt.js`: renders its own DOM rather than a canvas draw, no
 * render-budget cost. Greeting content is per-NPC (`gameplay/interaction.js` looks it up), and (run
 * 44, DECISIONS.md ADR-0058) an optional numbered choice list can follow the greeting on a pilot
 * subset of NPCs — still no persistence/quest hooks, one response per choice, no further branching.
 * `game3d.js`/`gameplay/interaction.js` own the open/close/selection *decision* (keypress,
 * distance-based auto-close); this class only owns the DOM.
 * @module ui/dialogueBox
 */

export class DialogueBox {
	/**
	 * @param {HTMLElement} [container] Parent element the box's DOM is appended to. Defaults to
	 *   `document.body`.
	 */
	constructor(container = document.body) {
		this._el = document.createElement('div');
		this._el.className = 'g3d-dialogue-box';

		this._textEl = document.createElement('p');
		this._textEl.className = 'g3d-dialogue-box-text';
		this._el.appendChild(this._textEl);

		this._choicesEl = document.createElement('div');
		this._choicesEl.className = 'g3d-dialogue-box-choices';
		this._el.appendChild(this._choicesEl);

		this._hintEl = document.createElement('p');
		this._hintEl.className = 'g3d-dialogue-box-hint';
		this._hintEl.textContent = 'E / Esc - Kapat';
		this._el.appendChild(this._hintEl);

		this._el.hidden = true;
		container.appendChild(this._el);
		this._visible = false;
	}

	/**
	 * Shows the box with the given text, replacing whatever was shown before.
	 * @param {string} text
	 * @param {string[]} [choiceLabels] Numbered choice labels rendered below the text (this method
	 *   adds the "1)"/"2)"/... prefix itself — callers pass the bare label). Omit/empty for a plain
	 *   response with no choices, which also reverts the hint back to "E / Esc - Kapat".
	 */
	show(text, choiceLabels = []) {
		this._textEl.textContent = text;
		this._choicesEl.replaceChildren(
			...choiceLabels.map((label, index) => {
				const choiceEl = document.createElement('p');
				choiceEl.className = 'g3d-dialogue-box-choice';
				choiceEl.textContent = `${index + 1}) ${label}`;
				return choiceEl;
			}),
		);
		// Built from choiceLabels.length rather than hardcoded "1/2" (run 79 and earlier) — that literal
		// was silently wrong for any NPC with a 3rd choice (interaction.js's DIALOGUE_CHOICE_KEY_CODES
		// already reaches Digit3; only the hint text never scaled). Byte-identical output for the
		// existing 2-choice case, so no behavior change for any of the 13 already-shipped NPCs.
		this._hintEl.textContent =
			choiceLabels.length > 0
				? `${choiceLabels.map((_, index) => index + 1).join('/')} - Seç, Esc - Kapat`
				: 'E / Esc - Kapat';
		this._visible = true;
		this._el.hidden = false;
	}

	hide() {
		if (!this._visible) return; // avoid a redundant DOM write
		this._visible = false;
		this._el.hidden = true;
	}

	get isVisible() {
		return this._visible;
	}

	dispose() {
		this._el.remove();
	}
}
