/**
 * Pause overlay for the 3D mode (run 339, `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3 item 7 — "menü /
 * duraklat / ayarlar akışı", the last of the seven "what a full game needs" gaps with no code yet).
 *
 * Scope, deliberately kept small for one bounded subtask: a toggleable full-screen overlay with
 * "Devam Et" (resume) and "Ana Menüye Dön" (quit to the 2D hub, same destination as the always-
 * visible `.g3d-back-link` in `game3d.html`) — no settings screen yet (that's this file's own
 * documented next step, not silently dropped). `game3d.js`'s tick loop is the thing that actually
 * freezes the world: it reads this instance's `isOpen` each frame and clamps `delta` to 0 while
 * `true` (see its own inline comment) — this class only owns the overlay's DOM/open-state/input,
 * never touches `state` or the render loop directly, matching `ControlsHelp`'s and
 * `SettlementCompass`'s existing shape (a plain constructor option object, no direct `gameState`
 * coupling).
 *
 * Two independent ways to open: a small always-visible corner button (discoverable, and the only
 * option on touch devices with no physical Escape key) and the desktop `Escape` key. `ControlsHelp`
 * already binds its own `Escape` handler to close *itself* when open; this class's handler only
 * toggles the pause overlay, so the two can coexist — worst case both panels are open at once,
 * a harmless visual overlap, not a functional conflict (each closes independently). Escape while
 * paused always closes the pause overlay (resume), mirroring `ControlsHelp`'s own escape-to-close.
 */

let pauseMenuInstanceCounter = 0;

export class PauseMenu {
	/**
	 * @param {{container?: HTMLElement, onOpenChange?: (open: boolean) => void, quitHref?: string}} [options]
	 *   `onOpenChange` fires synchronously from `setOpen()` (including the Escape/button-driven
	 *   paths below) — `game3d.js` uses it only to flip its own `state.paused` flag, no other
	 *   coupling. `quitHref` defaults to `index.html`, the same destination `game3d.html`'s
	 *   `.g3d-back-link` already uses — overridable for tests, which don't want a real navigation.
	 */
	constructor({ container = document.body, onOpenChange = null, quitHref = 'index.html' } = {}) {
		this._open = false;
		this._onOpenChange = onOpenChange;

		this._root = document.createElement('div');
		this._root.className = 'g3d-pause-menu';

		this._button = document.createElement('button');
		this._button.type = 'button';
		this._button.className = 'g3d-pause-menu-button';
		this._button.textContent = '⏸';
		this._button.setAttribute('aria-label', 'Oyunu duraklat');

		this._overlay = document.createElement('div');
		this._overlay.id = `g3d-pause-menu-overlay-${++pauseMenuInstanceCounter}`;
		this._overlay.className = 'g3d-pause-menu-overlay';
		this._overlay.hidden = true;
		this._overlay.setAttribute('role', 'dialog');
		this._overlay.setAttribute('aria-modal', 'true');
		this._overlay.setAttribute('aria-label', 'Duraklatma menüsü');
		this._button.setAttribute('aria-controls', this._overlay.id);
		this._button.setAttribute('aria-expanded', 'false');

		const panel = document.createElement('div');
		panel.className = 'g3d-pause-menu-panel';

		const title = document.createElement('h2');
		title.textContent = 'Duraklatıldı';
		panel.appendChild(title);

		this._resumeButton = document.createElement('button');
		this._resumeButton.type = 'button';
		this._resumeButton.className = 'g3d-pause-menu-resume';
		this._resumeButton.textContent = 'Devam Et';
		panel.appendChild(this._resumeButton);

		this._quitLink = document.createElement('a');
		this._quitLink.className = 'g3d-pause-menu-quit';
		this._quitLink.href = quitHref;
		this._quitLink.textContent = 'Ana Menüye Dön';
		panel.appendChild(this._quitLink);

		this._overlay.appendChild(panel);

		this._onButtonClick = () => this.setOpen(true);
		this._onResumeClick = () => this.setOpen(false);
		this._onKeyDown = (event) => {
			if (event.code !== 'Escape') return;
			this.setOpen(!this._open);
		};
		this._button.addEventListener('click', this._onButtonClick);
		this._resumeButton.addEventListener('click', this._onResumeClick);
		window.addEventListener('keydown', this._onKeyDown);

		this._root.append(this._button, this._overlay);
		container.appendChild(this._root);
	}

	setOpen(open) {
		if (this._open === open) return;
		this._open = open;
		this._overlay.hidden = !open;
		this._button.setAttribute('aria-expanded', String(open));
		if (open) this._resumeButton.focus();
		this._onOpenChange?.(open);
	}

	get isOpen() {
		return this._open;
	}

	dispose() {
		this._button.removeEventListener('click', this._onButtonClick);
		this._resumeButton.removeEventListener('click', this._onResumeClick);
		window.removeEventListener('keydown', this._onKeyDown);
		this._root.remove();
	}
}
