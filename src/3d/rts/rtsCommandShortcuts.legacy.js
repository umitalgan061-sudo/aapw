const SHORTCUT_DEFINITIONS = Object.freeze([
	Object.freeze({ code: 'KeyM', key: 'M', buttonId: 'rts-move-command', label: 'Hareket Emri' }),
	Object.freeze({ code: 'KeyF', key: 'F', buttonId: 'rts-focus-army', label: 'Orduya Odaklan' }),
]);

let installed = false;
let disposed = false;
let keydownCount = 0;
let lastShortcut = null;
let hintElement = null;
let onKeyDown = null;
let onPageHide = null;

function isEditableTarget(target) {
	if (!(target instanceof Element)) return false;
	if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function shortcutSnapshot() {
	return {
		installed,
		disposed,
		keydownCount,
		lastShortcut,
		hintVisible: Boolean(hintElement?.isConnected),
		coarsePointer: window.matchMedia?.('(pointer: coarse)').matches === true,
	};
}

function annotateButtons() {
	for (const definition of SHORTCUT_DEFINITIONS) {
		const button = document.getElementById(definition.buttonId);
		button?.setAttribute('aria-keyshortcuts', definition.key);
		button?.setAttribute('data-rts-shortcut', definition.key);
	}
}

function installHint() {
	if (window.matchMedia?.('(pointer: coarse)').matches === true) return null;
	const help = document.querySelector('.rts-help');
	if (!help) return null;
	const hint = document.createElement('span');
	hint.id = 'rts-command-shortcut-hint';
	hint.setAttribute('aria-hidden', 'true');
	hint.textContent = ' • M: hareket emri • F: orduya odaklan';
	help.appendChild(hint);
	return hint;
}

function disposeRtsCommandShortcuts() {
	if (!installed || disposed) return;
	disposed = true;
	if (onKeyDown) window.removeEventListener('keydown', onKeyDown);
	if (onPageHide) window.removeEventListener('pagehide', onPageHide);
	hintElement?.remove();
	hintElement = null;
	installed = false;
}

/**
 * Adds keyboard parity for the existing RTS command-bar buttons without owning command/game state.
 * M delegates to the established Move Command button; F delegates to the established Focus Army
 * button. The layer ignores editable targets and browser/system modifier chords, and disposes its
 * listener + desktop-only hint on pagehide.
 */
export function installRtsCommandShortcuts() {
	if (installed && !disposed) return window.__WESTEROS_RTS_SHORTCUTS__;
	disposed = false;
	annotateButtons();
	hintElement = installHint();

	onKeyDown = (event) => {
		if (disposed || event.repeat || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
		const definition = SHORTCUT_DEFINITIONS.find((candidate) => candidate.code === event.code);
		if (!definition) return;
		const button = document.getElementById(definition.buttonId);
		if (!(button instanceof HTMLButtonElement) || button.disabled) return;
		event.preventDefault();
		button.click();
		keydownCount += 1;
		lastShortcut = definition.key;
		document.body.dataset.rtsLastShortcut = definition.key;
	};
	onPageHide = () => disposeRtsCommandShortcuts();
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('pagehide', onPageHide, { once: true });
	installed = true;

	window.__WESTEROS_RTS_SHORTCUTS__ = {
		getSnapshot: shortcutSnapshot,
		dispose: disposeRtsCommandShortcuts,
		definitions: SHORTCUT_DEFINITIONS.map(({ key, buttonId, label }) => ({ key, buttonId, label })),
	};
	return window.__WESTEROS_RTS_SHORTCUTS__;
}

installRtsCommandShortcuts();
