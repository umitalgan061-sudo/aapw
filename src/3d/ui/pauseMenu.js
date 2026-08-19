import { QUALITY_LEVELS, STORAGE_KEYS } from '../config.js';

/**
 * Pause overlay for the 3D mode (run 339, `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3 item 7 — "menü /
 * duraklat / ayarlar akışı", the last of the seven "what a full game needs" gaps with no code yet).
 *
 * Scope, deliberately kept small for one bounded subtask: a toggleable full-screen overlay with
 * "Devam Et" (resume) and "Ana Menüye Dön" (quit to the 2D hub, same destination as the always-
 * visible `.g3d-back-link` in `game3d.html`). `game3d.js`'s tick loop is the thing that actually
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
 *
 * Run 341 (ADR-0289) added the settings screen this file's own header used to name as its documented
 * next step — scoped to graphics quality only, not volume: `GOVERNANCE_FULL_GAME_DIRECTIVE.md` §3's
 * own audio row already records `assets/audio/` as empty, so there is no volume to control yet
 * (narrowing note, run 346: `assets/audio/` now holds one CC0 UI click sound played from this
 * class's own open/close transitions via `audio/audioManager.js` — still no volume/mute control
 * here, this settings screen's own scope, so the gap above stays open, just narrower). The
 * quality picker writes `STORAGE_KEYS.QUALITY_SETTING` (present in `config.js` since FAZ 0, unread
 * until now) and reloads — `renderQuality.js`'s `resolveRenderQuality()` only consumes it at scene
 * construction (`sceneManager.js`), so there is no live-apply path to build here. Desktop-only, same
 * boundary `renderQuality.js` itself already draws: the mobile perf budget (DrawCalls<500,
 * Triangles<500K, ADR-0010) is treated as fixed, not something a settings screen should loosen, so a
 * coarse-pointer device sees an explanatory note instead of the picker (`isMobileClass` constructor
 * option, `game3d.js`'s own `isCoarsePointerDevice()` call site — same pattern `ControlsHelp`'s
 * `isMobileClass` already uses, not a second independent device probe).
 */

let pauseMenuInstanceCounter = 0;

/** Order matters: this is the on-screen list order for the quality radio group. */
const QUALITY_OPTIONS = [
	{ level: QUALITY_LEVELS.AUTOMATIC, label: 'Otomatik (önerilen)' },
	{ level: QUALITY_LEVELS.HIGH, label: 'Yüksek' },
	{ level: QUALITY_LEVELS.MEDIUM, label: 'Orta' },
	{ level: QUALITY_LEVELS.LOW, label: 'Düşük' },
];

/** Same try/catch-wrapped `localStorage` access `ui/settlementDiscovery.js` already established —
 * kept local rather than imported since that module's version returns a `Set`-shaped default this
 * file has no use for. */
function getDefaultStorage() {
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}

export class PauseMenu {
	/**
	 * @param {{container?: HTMLElement, onOpenChange?: (open: boolean) => void, quitHref?: string,
	 *   isMobileClass?: boolean, storage?: Storage|null, reload?: () => void}} [options]
	 *   `onOpenChange` fires synchronously from `setOpen()` (including the Escape/button-driven
	 *   paths below) — `game3d.js` uses it only to flip its own `state.paused` flag, no other
	 *   coupling. `quitHref` defaults to `index.html`, the same destination `game3d.html`'s
	 *   `.g3d-back-link` already uses — overridable for tests, which don't want a real navigation.
	 *   `isMobileClass` defaults to `false` (desktop); `game3d.js` passes its own
	 *   `isCoarsePointerDevice()` result. `storage` defaults to `globalThis.localStorage` (guarded);
	 *   overridable for tests. `reload` defaults to `() => window.location.reload()`; overridable for
	 *   tests, which don't want a real navigation.
	 */
	constructor({
		container = document.body,
		onOpenChange = null,
		quitHref = 'index.html',
		isMobileClass = false,
		storage,
		reload = () => window.location.reload(),
	} = {}) {
		this._open = false;
		this._onOpenChange = onOpenChange;
		this._storage = storage === undefined ? getDefaultStorage() : storage;
		this._reload = reload;

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
		panel.className = 'g3d-pause-menu-panel g3d-pause-menu-main-panel';

		const title = document.createElement('h2');
		title.textContent = 'Duraklatıldı';
		panel.appendChild(title);

		this._resumeButton = document.createElement('button');
		this._resumeButton.type = 'button';
		this._resumeButton.className = 'g3d-pause-menu-resume';
		this._resumeButton.textContent = 'Devam Et';
		panel.appendChild(this._resumeButton);

		this._settingsButton = document.createElement('button');
		this._settingsButton.type = 'button';
		this._settingsButton.className = 'g3d-pause-menu-settings-open';
		this._settingsButton.textContent = 'Ayarlar';
		panel.appendChild(this._settingsButton);

		this._quitLink = document.createElement('a');
		this._quitLink.className = 'g3d-pause-menu-quit';
		this._quitLink.href = quitHref;
		this._quitLink.textContent = 'Ana Menüye Dön';
		panel.appendChild(this._quitLink);

		this._mainPanel = panel;
		this._settingsPanel = this._buildSettingsPanel(isMobileClass);
		this._settingsPanel.hidden = true;

		this._overlay.append(panel, this._settingsPanel);

		this._onButtonClick = () => this.setOpen(true);
		this._onResumeClick = () => this.setOpen(false);
		this._onSettingsOpenClick = () => this._showSettings(true);
		this._onSettingsBackClick = () => this._showSettings(false);
		this._onKeyDown = (event) => {
			if (event.code !== 'Escape') return;
			this.setOpen(!this._open);
		};
		this._button.addEventListener('click', this._onButtonClick);
		this._resumeButton.addEventListener('click', this._onResumeClick);
		this._settingsButton.addEventListener('click', this._onSettingsOpenClick);
		this._settingsBackButton.addEventListener('click', this._onSettingsBackClick);
		window.addEventListener('keydown', this._onKeyDown);

		this._root.append(this._button, this._overlay);
		container.appendChild(this._root);
	}

	/**
	 * Builds the settings sub-panel (same `.g3d-pause-menu-panel` shape as the main one, swapped in
	 * via `_showSettings` rather than a second overlay). Desktop gets a graphics-quality radio group;
	 * a coarse-pointer device gets an explanatory note instead — see this file's own header for why.
	 * @param {boolean} isMobileClass
	 * @returns {HTMLElement}
	 * @private
	 */
	_buildSettingsPanel(isMobileClass) {
		const settingsPanel = document.createElement('div');
		settingsPanel.className = 'g3d-pause-menu-panel g3d-pause-menu-settings-panel';

		const title = document.createElement('h2');
		title.textContent = 'Ayarlar';
		settingsPanel.appendChild(title);

		this._qualityRadios = [];
		if (isMobileClass) {
			const note = document.createElement('p');
			note.className = 'g3d-pause-menu-settings-note';
			note.textContent = 'Bu cihazda grafik kalitesi mobil performans bütçesi için otomatik ayarlanır.';
			settingsPanel.appendChild(note);
		} else {
			const fieldset = document.createElement('fieldset');
			fieldset.className = 'g3d-pause-menu-settings-quality';
			const legend = document.createElement('legend');
			legend.textContent = 'Grafik Kalitesi';
			fieldset.appendChild(legend);

			const currentLevel = this._readStoredQualityLevel();
			for (const { level, label } of QUALITY_OPTIONS) {
				const row = document.createElement('label');
				row.className = 'g3d-pause-menu-settings-quality-option';
				const input = document.createElement('input');
				input.type = 'radio';
				input.name = `g3d-pause-menu-quality-${pauseMenuInstanceCounter}`;
				input.value = level;
				input.checked = level === currentLevel;
				row.append(input, document.createTextNode(label));
				fieldset.appendChild(row);
				this._qualityRadios.push(input);
			}
			settingsPanel.appendChild(fieldset);

			this._settingsApplyButton = document.createElement('button');
			this._settingsApplyButton.type = 'button';
			this._settingsApplyButton.className = 'g3d-pause-menu-settings-apply';
			this._settingsApplyButton.textContent = 'Uygula ve Yeniden Başlat';
			this._onSettingsApplyClick = () => this._applyQualitySelection();
			this._settingsApplyButton.addEventListener('click', this._onSettingsApplyClick);
			settingsPanel.appendChild(this._settingsApplyButton);
		}

		this._settingsBackButton = document.createElement('button');
		this._settingsBackButton.type = 'button';
		this._settingsBackButton.className = 'g3d-pause-menu-settings-back';
		this._settingsBackButton.textContent = 'Geri';
		settingsPanel.appendChild(this._settingsBackButton);

		return settingsPanel;
	}

	/** @returns {string} A valid `QUALITY_LEVELS` value; falls back to `AUTOMATIC` for anything
	 * missing/unrecognized (a hand-edited or stale-version localStorage value included) — never
	 * throws, never leaves the radio group with nothing checked. */
	_readStoredQualityLevel() {
		let stored = null;
		try {
			stored = this._storage?.getItem(STORAGE_KEYS.QUALITY_SETTING) ?? null;
		} catch {
			stored = null;
		}
		const known = QUALITY_OPTIONS.some((option) => option.level === stored);
		return known ? stored : QUALITY_LEVELS.AUTOMATIC;
	}

	/** Persists the checked radio's level and reloads — `resolveRenderQuality()` only reads this at
	 * scene construction, so a reload is the only way this run's own scope makes the choice take
	 * effect (see this file's own header). No-op (writes nothing, does not reload) if no radio is
	 * checked, which cannot happen through this class's own UI but guards a hand-built `storage`. */
	_applyQualitySelection() {
		const selected = this._qualityRadios.find((input) => input.checked);
		if (!selected) return;
		try {
			this._storage?.setItem(STORAGE_KEYS.QUALITY_SETTING, selected.value);
		} catch {
			// Same swallow-and-continue policy `EditorLocalSession.js` already uses for a full/blocked
			// storage quota — losing this one preference is not worth failing the whole apply action.
		}
		this._reload();
	}

	/**
	 * Swaps which of the two `.g3d-pause-menu-panel` children is visible. Does not change
	 * `this._open`/`isOpen`/`onOpenChange` — the overlay itself stays open, only its content changes.
	 * @param {boolean} showSettings
	 * @private
	 */
	_showSettings(showSettings) {
		this._mainPanel.hidden = showSettings;
		this._settingsPanel.hidden = !showSettings;
		if (showSettings) this._settingsBackButton.focus();
		else this._settingsButton.focus();
	}

	setOpen(open) {
		if (this._open === open) return;
		this._open = open;
		this._overlay.hidden = !open;
		this._button.setAttribute('aria-expanded', String(open));
		if (open) {
			// Always reopen on the main screen, never mid-settings from a prior session — the settings
			// panel isn't itself stateful (it re-reads storage fresh via `_buildSettingsPanel`'s own
			// `checked` assignment, only run once at construction), but leaving it visible would mean a
			// closed-then-reopened overlay looks different depending on what the player last clicked.
			this._showSettings(false);
			this._resumeButton.focus();
		}
		this._onOpenChange?.(open);
	}

	get isOpen() {
		return this._open;
	}

	dispose() {
		this._button.removeEventListener('click', this._onButtonClick);
		this._resumeButton.removeEventListener('click', this._onResumeClick);
		this._settingsButton.removeEventListener('click', this._onSettingsOpenClick);
		this._settingsBackButton.removeEventListener('click', this._onSettingsBackClick);
		this._settingsApplyButton?.removeEventListener('click', this._onSettingsApplyClick);
		window.removeEventListener('keydown', this._onKeyDown);
		this._root.remove();
	}
}
