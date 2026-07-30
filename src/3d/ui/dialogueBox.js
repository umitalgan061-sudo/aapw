/**
 * Fixed-position DOM dialogue box (FAZ 5, run 33 — the second step of the interaction system after
 * `ui/interactionPrompt.js`'s proximity affordance). Same DOM-ownership pattern as
 * `ui/touchJoystick.js`/`ui/interactionPrompt.js`: renders its own DOM rather than a canvas draw, no
 * render-budget cost. Deliberately still minimal — one static, generic greeting line per NPC (built
 * from its `displayName`, not real per-character dialogue content/branching yet), no options/replies.
 * `game3d.js` owns the open/close *decision* (keypress, distance-based auto-close); this class only
 * owns the DOM.
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

		const hintEl = document.createElement('p');
		hintEl.className = 'g3d-dialogue-box-hint';
		hintEl.textContent = 'E / Esc - Kapat';
		this._el.appendChild(hintEl);

		this._el.hidden = true;
		container.appendChild(this._el);
		this._visible = false;
	}

	/**
	 * Shows the box with the given text, replacing whatever was shown before.
	 * @param {string} text
	 */
	show(text) {
		this._textEl.textContent = text;
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
