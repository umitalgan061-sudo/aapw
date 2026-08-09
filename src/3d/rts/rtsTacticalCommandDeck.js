const COMMAND_DECK_ID = 'rts-tactical-command-deck';
const HISTORY_LIMIT = 6;
const TELEMETRY_INTERVAL_MS = 250;
const PAN_CODES = Object.freeze({ up: 'KeyW', left: 'KeyA', right: 'KeyD', down: 'KeyS' });

let activeSurface = null;
let readinessObserver = null;

function editableTarget(target) {
	return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function formatInteger(value) {
	return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function createElement(tag, className, text = '') {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text) element.textContent = text;
	return element;
}

function createButton(label, action, className = 'rts-tactical-button') {
	const button = createElement('button', className, label);
	button.type = 'button';
	button.dataset.action = action;
	return button;
}

function createStyles() {
	const style = document.createElement('style');
	style.dataset.rtsTacticalCommandDeck = 'true';
	style.textContent = `
#${COMMAND_DECK_ID}{position:fixed;left:16px;top:82px;z-index:42;width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 150px);display:grid;grid-template-rows:auto 1fr;border:1px solid rgba(229,194,102,.48);border-radius:14px;background:linear-gradient(180deg,rgba(28,24,17,.95),rgba(15,14,11,.92));box-shadow:0 18px 48px rgba(0,0,0,.42);backdrop-filter:blur(12px);color:#f3e4b2;font:500 13px/1.35 system-ui,sans-serif;overflow:hidden}
#${COMMAND_DECK_ID}[data-collapsed="true"] .rts-tactical-body{display:none}
.rts-tactical-head{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 10px;border-bottom:1px solid rgba(229,194,102,.22);background:rgba(229,194,102,.06)}
.rts-tactical-title{min-width:0;flex:1;font-weight:800;letter-spacing:.12em;color:#e5c266;font-size:12px}
.rts-tactical-head button{min-width:38px;min-height:38px;border:1px solid rgba(229,194,102,.34);border-radius:9px;background:rgba(255,255,255,.04);color:#f3e4b2;cursor:pointer}
.rts-tactical-body{overflow:auto;padding:10px;display:grid;gap:10px}
.rts-tactical-section{display:grid;gap:7px;padding:9px;border:1px solid rgba(229,194,102,.16);border-radius:10px;background:rgba(0,0,0,.16)}
.rts-tactical-section-title{font-size:10px;font-weight:800;letter-spacing:.14em;color:#bca866}
.rts-tactical-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.rts-tactical-button{min-height:44px;padding:8px 9px;border:1px solid rgba(229,194,102,.30);border-radius:9px;background:rgba(46,39,25,.9);color:#f3e4b2;font:700 12px/1.2 system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
.rts-tactical-button:hover,.rts-tactical-button:focus-visible{border-color:#e5c266;outline:none;background:rgba(76,61,31,.96)}
.rts-tactical-button[data-active="true"]{border-color:#e5c266;background:rgba(118,87,31,.72);box-shadow:inset 0 0 0 1px rgba(229,194,102,.22)}
.rts-tactical-telemetry{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.rts-tactical-stat{min-height:48px;padding:7px 8px;border-radius:8px;background:rgba(255,255,255,.035);display:grid;align-content:center;gap:2px}
.rts-tactical-stat strong{font-size:15px;color:#fff2c9}.rts-tactical-stat span{font-size:9px;letter-spacing:.10em;color:#aa9b75}
.rts-tactical-camera{display:grid;grid-template-columns:44px 44px 44px 1fr;grid-template-rows:44px 44px 44px;gap:5px;align-items:center}
.rts-tactical-camera button{width:44px;height:44px;padding:0;border:1px solid rgba(229,194,102,.30);border-radius:10px;background:rgba(46,39,25,.92);color:#f8e9b7;font-weight:900;font-size:17px;touch-action:none;user-select:none;cursor:pointer}
.rts-tactical-camera button[data-pan="up"]{grid-column:2;grid-row:1}.rts-tactical-camera button[data-pan="left"]{grid-column:1;grid-row:2}.rts-tactical-camera button[data-pan="right"]{grid-column:3;grid-row:2}.rts-tactical-camera button[data-pan="down"]{grid-column:2;grid-row:3}
.rts-tactical-zoom{grid-column:4;grid-row:1/4;display:grid;grid-template-rows:1fr 1fr;gap:5px}.rts-tactical-zoom button{width:100%;height:auto;min-height:44px}
.rts-tactical-history{list-style:none;padding:0;margin:0;display:grid;gap:5px;counter-reset:rtslog}.rts-tactical-history li{counter-increment:rtslog;display:grid;grid-template-columns:24px 1fr;gap:7px;padding:5px 0;border-bottom:1px solid rgba(229,194,102,.09);color:#d7cba8}.rts-tactical-history li::before{content:counter(rtslog,decimal-leading-zero);color:#8e805f;font:700 10px/1.4 ui-monospace,monospace}.rts-tactical-history li:last-child{border-bottom:0}
.rts-tactical-hint{font-size:10px;color:#94896d}.rts-tactical-hint kbd{padding:1px 5px;border:1px solid rgba(229,194,102,.24);border-radius:4px;background:rgba(255,255,255,.04);font:700 10px ui-monospace,monospace;color:#e5c266}
@media(max-width:720px),(pointer:coarse){#${COMMAND_DECK_ID}{left:8px;top:auto;bottom:82px;width:calc(100vw - 16px);max-height:min(58vh,520px);border-radius:12px}.rts-tactical-body{grid-template-columns:1fr 1fr;align-items:start}.rts-tactical-section[data-section="orders"],.rts-tactical-section[data-section="camera"]{grid-column:span 1}.rts-tactical-section[data-section="telemetry"],.rts-tactical-section[data-section="history"]{grid-column:1/-1}.rts-tactical-button{min-height:46px}.rts-tactical-head{min-height:48px}}
@media(max-width:480px){.rts-tactical-body{grid-template-columns:1fr}.rts-tactical-section{grid-column:1!important}.rts-tactical-telemetry{grid-template-columns:repeat(4,minmax(0,1fr))}.rts-tactical-stat{padding:6px 4px;text-align:center}.rts-tactical-stat strong{font-size:13px}.rts-tactical-stat span{font-size:8px}}
`;
	return style;
}

function installDeck() {
	if (activeSurface && !activeSurface.getSnapshot().disposed) return activeSurface;
	if (!window.__WESTEROS_RTS__ || document.body.dataset.rtsReady !== 'true') return null;
	if (document.getElementById(COMMAND_DECK_ID)) return window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__ || null;

	const api = window.__WESTEROS_RTS__;
	const canvas = document.getElementById('rts-canvas');
	const statusElement = document.getElementById('rts-status');
	const selectionElement = document.getElementById('rts-selection-count');
	const selectAllButton = document.getElementById('rts-select-all');
	const moveButton = document.getElementById('rts-move-command');
	const focusButton = document.getElementById('rts-focus-army');
	if (!(canvas instanceof HTMLCanvasElement) || !(moveButton instanceof HTMLButtonElement)) return null;

	const style = createStyles();
	const panel = createElement('section');
	panel.id = COMMAND_DECK_ID;
	panel.dataset.collapsed = 'false';
	panel.setAttribute('aria-label', 'RTS taktik komuta merkezi');
	panel.setAttribute('role', 'region');

	const head = createElement('div', 'rts-tactical-head');
	const title = createElement('div', 'rts-tactical-title', 'KOMUTA MERKEZİ');
	const collapseButton = createButton('−', 'collapse', '');
	collapseButton.setAttribute('aria-label', 'Komuta merkezini daralt');
	collapseButton.setAttribute('aria-expanded', 'true');
	head.append(title, collapseButton);

	const body = createElement('div', 'rts-tactical-body');
	const orderSection = createElement('section', 'rts-tactical-section');
	orderSection.dataset.section = 'orders';
	orderSection.append(createElement('div', 'rts-tactical-section-title', 'EMİRLER'));
	const orderGrid = createElement('div', 'rts-tactical-grid');
	const selectButton = createButton('Tüm Ordu', 'select-all');
	const tacticalMoveButton = createButton('Hedef Ver', 'move');
	const tacticalFocusButton = createButton('Orduyu Bul', 'focus');
	const clearButton = createButton('Seçimi Temizle', 'clear');
	orderGrid.append(selectButton, tacticalMoveButton, tacticalFocusButton, clearButton);
	orderSection.append(orderGrid);

	const cameraSection = createElement('section', 'rts-tactical-section');
	cameraSection.dataset.section = 'camera';
	cameraSection.append(createElement('div', 'rts-tactical-section-title', 'TAKTİK KAMERA'));
	const cameraGrid = createElement('div', 'rts-tactical-camera');
	for (const [direction, glyph] of [['up', '▲'], ['left', '◀'], ['right', '▶'], ['down', '▼']]) {
		const button = createButton(glyph, `pan-${direction}`, '');
		button.dataset.pan = direction;
		button.setAttribute('aria-label', `Kamerayı ${direction === 'up' ? 'ileri' : direction === 'down' ? 'geri' : direction === 'left' ? 'sola' : 'sağa'} kaydır`);
		cameraGrid.append(button);
	}
	const zoom = createElement('div', 'rts-tactical-zoom');
	const zoomIn = createButton('+', 'zoom-in', '');
	const zoomOut = createButton('−', 'zoom-out', '');
	zoomIn.setAttribute('aria-label', 'Kamerayı yakınlaştır');
	zoomOut.setAttribute('aria-label', 'Kamerayı uzaklaştır');
	zoom.append(zoomIn, zoomOut);
	cameraGrid.append(zoom);
	cameraSection.append(cameraGrid);

	const telemetrySection = createElement('section', 'rts-tactical-section');
	telemetrySection.dataset.section = 'telemetry';
	telemetrySection.append(createElement('div', 'rts-tactical-section-title', 'SAHA TELEMETRİSİ'));
	const telemetry = createElement('div', 'rts-tactical-telemetry');
	const statElements = {};
	for (const [key, label] of [['selection', 'SEÇİLİ'], ['drawCalls', 'DRAW CALL'], ['triangles', 'ÜÇGEN'], ['threats', 'YARATIK']]) {
		const card = createElement('div', 'rts-tactical-stat');
		const strong = createElement('strong', '', '—');
		card.append(strong, createElement('span', '', label));
		telemetry.append(card);
		statElements[key] = strong;
	}
	telemetrySection.append(telemetry);

	const historySection = createElement('section', 'rts-tactical-section');
	historySection.dataset.section = 'history';
	historySection.append(createElement('div', 'rts-tactical-section-title', 'KOMUT GÜNLÜĞÜ'));
	const historyList = createElement('ol', 'rts-tactical-history');
	historySection.append(historyList, createElement('div', 'rts-tactical-hint', 'Panel: <H>'));
	historySection.lastElementChild.innerHTML = 'Panel: <kbd>H</kbd> • Mevcut M/F kısayolları korunur';
	body.append(orderSection, cameraSection, telemetrySection, historySection);
	panel.append(head, body);
	document.head.append(style);
	document.body.append(panel);

	let disposed = false;
	let collapsed = false;
	let telemetryTimer = 0;
	let panDispatchCount = 0;
	const activePanCodes = new Set();
	const history = [];
	const removers = [];

	function listen(target, type, listener, options) {
		target?.addEventListener(type, listener, options);
		removers.push(() => target?.removeEventListener(type, listener, options));
	}

	function record(message) {
		const text = String(message || '').trim();
		if (!text || history.at(-1) === text) return;
		history.push(text);
		if (history.length > HISTORY_LIMIT) history.shift();
		historyList.replaceChildren(...history.map((entry) => createElement('li', '', entry)));
	}

	function setCollapsed(next) {
		collapsed = Boolean(next);
		panel.dataset.collapsed = String(collapsed);
		collapseButton.textContent = collapsed ? '+' : '−';
		collapseButton.setAttribute('aria-expanded', String(!collapsed));
		collapseButton.setAttribute('aria-label', collapsed ? 'Komuta merkezini genişlet' : 'Komuta merkezini daralt');
	}

	function dispatchKeyboard(type, code) {
		window.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
	}

	function beginPan(code) {
		if (!code || activePanCodes.has(code)) return;
		activePanCodes.add(code);
		panDispatchCount += 1;
		dispatchKeyboard('keydown', code);
	}

	function endPan(code) {
		if (!activePanCodes.delete(code)) return;
		dispatchKeyboard('keyup', code);
	}

	function releasePan() {
		for (const code of [...activePanCodes]) endPan(code);
	}

	function zoomCamera(deltaY) {
		canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
	}

	function refresh() {
		if (disposed) return null;
		const snapshot = api.getSnapshot?.() || {};
		const moveMode = moveButton.classList.contains('is-active');
		tacticalMoveButton.dataset.active = String(moveMode);
		tacticalMoveButton.setAttribute('aria-pressed', String(moveMode));
		moveButton.setAttribute('aria-pressed', String(moveMode));
		statElements.selection.textContent = `${snapshot.selectedCount ?? 0}/${snapshot.unitCount ?? 0}`;
		statElements.drawCalls.textContent = formatInteger(snapshot.drawCalls);
		statElements.triangles.textContent = formatInteger(snapshot.triangles);
		statElements.threats.textContent = formatInteger((snapshot.animalCount || 0) + (snapshot.dragonCount || 0));
		return snapshot;
	}

	function getSnapshot() {
		const snapshot = refresh() || api.getSnapshot?.() || {};
		return {
			disposed,
			collapsed,
			moveMode: moveButton.classList.contains('is-active'),
			selectedCount: snapshot.selectedCount ?? 0,
			unitCount: snapshot.unitCount ?? 0,
			drawCalls: snapshot.drawCalls ?? 0,
			triangles: snapshot.triangles ?? 0,
			history: [...history],
			historyCount: history.length,
			activePanCodes: [...activePanCodes].sort(),
			panDispatchCount,
		};
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		releasePan();
		window.clearInterval(telemetryTimer);
		removers.splice(0).reverse().forEach((remove) => remove());
		statusObserver.disconnect();
		selectionObserver.disconnect();
		moveObserver.disconnect();
		panel.remove();
		style.remove();
		document.body.removeAttribute('data-rts-tactical-command-deck');
		if (window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__ === surface) delete window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__;
		activeSurface = null;
	}

	listen(collapseButton, 'click', () => setCollapsed(!collapsed));
	listen(selectButton, 'click', () => selectAllButton?.click());
	listen(tacticalMoveButton, 'click', () => { if (!moveButton.classList.contains('is-active')) moveButton.click(); else moveButton.click(); });
	listen(tacticalFocusButton, 'click', () => focusButton?.click());
	listen(clearButton, 'click', () => dispatchKeyboard('keydown', 'Escape'));
	listen(zoomIn, 'click', () => zoomCamera(-420));
	listen(zoomOut, 'click', () => zoomCamera(420));
	for (const button of cameraGrid.querySelectorAll('[data-pan]')) {
		const code = PAN_CODES[button.dataset.pan];
		listen(button, 'pointerdown', (event) => { event.preventDefault(); button.setPointerCapture?.(event.pointerId); beginPan(code); });
		listen(button, 'pointerup', () => endPan(code));
		listen(button, 'pointercancel', () => endPan(code));
		listen(button, 'lostpointercapture', () => endPan(code));
	}
	listen(window, 'blur', releasePan);
	listen(window, 'keydown', (event) => {
		if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || editableTarget(event.target) || event.code !== 'KeyH') return;
		event.preventDefault();
		setCollapsed(!collapsed);
	});
	listen(window, 'pagehide', dispose, { once: true });

	const statusObserver = new MutationObserver(() => { record(statusElement?.textContent); refresh(); });
	const selectionObserver = new MutationObserver(refresh);
	const moveObserver = new MutationObserver(refresh);
	if (statusElement) statusObserver.observe(statusElement, { childList: true, characterData: true, subtree: true });
	if (selectionElement) selectionObserver.observe(selectionElement, { childList: true, characterData: true, subtree: true });
	moveObserver.observe(moveButton, { attributes: true, attributeFilter: ['class'] });
	record(statusElement?.textContent);
	telemetryTimer = window.setInterval(refresh, TELEMETRY_INTERVAL_MS);
	refresh();
	document.body.dataset.rtsTacticalCommandDeck = 'ready';

	const surface = Object.freeze({ refresh, getSnapshot, setCollapsed, dispose });
	window.__WESTEROS_RTS_TACTICAL_COMMAND_DECK__ = surface;
	activeSurface = surface;
	return surface;
}

/**
 * Adds a DOM-only tactical command surface over the established RTS ownership boundaries.
 * Commands delegate to the existing buttons/input path; this module never owns army simulation,
 * selection state, camera transforms, renderer state or deterministic world state.
 */
export function installRtsTacticalCommandDeck() {
	const installed = installDeck();
	if (installed) return installed;
	if (readinessObserver) return null;
	readinessObserver = new MutationObserver(() => {
		const surface = installDeck();
		if (!surface) return;
		readinessObserver?.disconnect();
		readinessObserver = null;
	});
	readinessObserver.observe(document.body, { attributes: true, attributeFilter: ['data-rts-ready'] });
	return null;
}
