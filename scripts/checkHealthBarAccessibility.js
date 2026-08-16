#!/usr/bin/env node
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

async function runViewport(browser, baseUrl, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async () => {
      const { HealthBar } = await import('/src/3d/ui/healthBar.js');
      const listeners = new Map();
      const bus = {
        on(name, fn) { listeners.set(name, fn); },
        off(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
        emit(name, payload) { listeners.get(name)?.(payload); },
      };
      const host = document.createElement('div');
      document.body.appendChild(host);
      const bar = new HealthBar({ eventsBus: bus, healthChangedEventName: 'health', damageEventName: 'damage', container: host });
      bus.emit('health', { current: 73.2, maxHealth: 100 });
      window.dispatchEvent(new CustomEvent('aapw:player-motion', { detail: { stamina: 71.2, maxStamina: 100, state: 'dodge' } }));
      const rect = bar._el.getBoundingClientRect();
      const snapshot = {
        healthNow: bar._el.getAttribute('aria-valuenow'),
        staminaRole: bar._staminaEl.getAttribute('role'),
        staminaLabel: bar._staminaEl.getAttribute('aria-label'),
        staminaNow: bar._staminaEl.getAttribute('aria-valuenow'),
        staminaText: bar._staminaEl.getAttribute('aria-valuetext'),
        staminaState: bar._staminaEl.dataset.state,
        dodgeFilter: bar._staminaFillEl.style.filter,
        fitsViewport: rect.left >= 0 && rect.right <= innerWidth,
      };
      bus.emit('damage');
      const flash = bar._el.classList.contains('g3d-health-bar-flash');
      bar.dispose();
      host.remove();
      return { snapshot, flash, listeners: listeners.size, connected: bar._el.isConnected };
    });
    if (errors.length) throw new Error(errors.join(' | '));
    const { snapshot } = result;
    if (snapshot.healthNow !== '74') throw new Error(`health aria mismatch ${snapshot.healthNow}`);
    if (snapshot.staminaRole !== 'meter' || snapshot.staminaLabel !== 'Dayanıklılık') throw new Error('stamina semantics missing');
    if (snapshot.staminaNow !== '72' || !snapshot.staminaText.includes('Kaçınma')) throw new Error('stamina paint mismatch');
    if (snapshot.staminaState !== 'dodge' || !snapshot.dodgeFilter.includes('brightness')) throw new Error('dodge feedback missing');
    if (!snapshot.fitsViewport || !result.flash || result.listeners !== 0 || result.connected) throw new Error('layout/disposal regression');
    console.log(`[health-bar-a11y] PASS ${viewport.width}x${viewport.height}`);
  } finally {
    await page.close();
  }
}

(async () => {
  const playwright = loadPlaywright();
  if (!playwright) process.exit(2);
  const server = await startStaticServer();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await runViewport(browser, baseUrl, { width: 390, height: 844 });
    await runViewport(browser, baseUrl, { width: 1440, height: 900 });
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => { console.error('[health-bar-a11y] FAIL', error); process.exit(1); });
