import assert from 'node:assert/strict';

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.className = '';
		this.textContent = '';
		this.hidden = false;
		this.style = {};
		this.removed = false;
	}
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	append(...children) { this.children.push(...children); }
	appendChild(child) { this.children.push(child); return child; }
	remove() { this.removed = true; }
}

const body = new FakeElement('body');
globalThis.document = {
	body,
	createElement(tagName) { return new FakeElement(tagName); },
};

const { SettlementCompass } = await import('../src/3d/ui/settlementCompass.js');

const seats = [
	{ name: 'Kızıl Kale', x: 0, z: 0 },
	{ name: 'Kışlaboyu', x: 1000, z: 0 },
];
const compass = new SettlementCompass({ seats, container: body });

// Static role/live-region wiring is present from construction, before the first update() —
// same "constructor sets the quiet-live-region contract" pattern as run157's DayNightClock
// (ADR-0179): this widget's distance text can change every ~10m of player movement, which is
// far too chatty for aria-live="polite" (see run150/153/154/155's toast/discovery/dialogue/
// health-bar widgets, all of which change on genuinely infrequent events, not continuous ones).
assert.equal(compass._root.getAttribute('role'), 'status');
assert.equal(compass._root.getAttribute('aria-live'), 'off');
assert.equal(compass._root.getAttribute('aria-atomic'), 'true');
assert.equal(compass._root.getAttribute('aria-label'), 'En yakın yerleşim');
assert.equal(body.children[0], compass._root);

// First update: nearest seat found, aria-label refreshes with the queryable value even though
// aria-live="off" will not auto-announce it.
compass.update({ x: 0, z: 5 }, 0);
assert.equal(compass._name.textContent, 'Kızıl Kale');
assert.equal(compass._distance.textContent, '10 m');
assert.equal(compass._root.getAttribute('aria-label'), 'En yakın yerleşim: Kızıl Kale, 10 m');
assert.equal(compass._root.hidden, false);

// Same distance bucket, same nearest seat: no redundant aria-label churn (mirrors the existing
// this._lastSeat/this._lastDistanceBucket paint-skip optimization already in update()).
const labelBeforeNoOpUpdate = compass._root.getAttribute('aria-label');
compass.update({ x: 0, z: 6 }, 0);
assert.equal(compass._root.getAttribute('aria-label'), labelBeforeNoOpUpdate, 'same 10m bucket must not rewrite aria-label');

// Distance bucket changes: aria-label follows the visible distance text.
compass.update({ x: 0, z: 25 }, 0);
assert.equal(compass._distance.textContent, '30 m');
assert.equal(compass._root.getAttribute('aria-label'), 'En yakın yerleşim: Kızıl Kale, 30 m');

// Nearest seat changes: aria-label follows the new settlement name.
compass.update({ x: 999, z: 0 }, 0);
assert.equal(compass._name.textContent, 'Kışlaboyu');
assert.equal(compass._root.getAttribute('aria-label'), 'En yakın yerleşim: Kışlaboyu, 0 m');

// No seat in range (filtered out entirely): widget hides, no crash, no stale-visible aria-label
// rewrite attempted (update() returns before reaching the label logic).
compass.setSeatFilter(() => false);
compass.update({ x: 0, z: 0 }, 0);
assert.equal(compass._root.hidden, true);

compass.dispose();
assert.equal(compass._root.removed, true);

console.log('[checkSettlementCompassAccessibility] PASS: quiet status live-region role, queryable dynamic aria-label, redundant-update skip, and dispose are intact.');
