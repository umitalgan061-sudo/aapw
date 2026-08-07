import assert from 'node:assert/strict';

class FakeElement {
	constructor(tagName) {
		this.tagName = tagName.toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.className = '';
		this.textContent = '';
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

const { DayNightClock } = await import('../src/3d/ui/dayNightClock.js');
const clock = new DayNightClock({ container: body });

assert.equal(clock._root.getAttribute('role'), 'timer');
assert.equal(clock._root.getAttribute('aria-live'), 'off');
assert.equal(clock._root.getAttribute('aria-atomic'), 'true');
assert.equal(clock._root.getAttribute('aria-label'), 'Oyun içi saat');
assert.equal(clock._icon.getAttribute('aria-hidden'), 'true');
assert.equal(body.children[0], clock._root);

clock.update(0.5, 0);
assert.equal(clock._time.textContent, '12:00');
assert.equal(clock._root.getAttribute('aria-label'), 'Oyun içi saat 12:00');
assert.equal(clock._icon.textContent, '☀️');

clock.update(0.25, 0.3);
assert.equal(clock._time.textContent, '06:00');
assert.equal(clock._root.getAttribute('aria-label'), 'Oyun içi saat 06:00');
assert.equal(clock._icon.textContent, '🌅');

clock.update(0, 1);
assert.equal(clock._time.textContent, '00:00');
assert.equal(clock._root.getAttribute('aria-label'), 'Oyun içi saat 00:00');
assert.equal(clock._icon.textContent, '🌙');

clock.update(1.25, 0.3);
assert.equal(clock._time.textContent, '06:00', 'time ratio wraps deterministically');
assert.equal(clock._root.getAttribute('aria-label'), 'Oyun içi saat 06:00');
assert.equal(clock._root.getAttribute('aria-live'), 'off', 'compressed clock must not become a chatty live region');

clock.dispose();
assert.equal(clock._root.removed, true);

console.log('[checkDayNightClockAccessibility] PASS: timer semantics, quiet live-region policy, Turkish accessible time, decorative icon hiding, wraparound and dispose are intact.');
