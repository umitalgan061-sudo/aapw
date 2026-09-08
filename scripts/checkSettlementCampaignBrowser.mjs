import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SETTLEMENT_BROWSER_PORT || 4179);
const mime = (file) => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' }[path.extname(file).toLowerCase()] || 'application/octet-stream');
const server = http.createServer((request, response) => {
  const raw = decodeURIComponent((request.url || '/').split('?')[0]);
  const requested = raw === '/' ? '/game3d.html' : raw;
  const file = path.resolve(ROOT, `.${requested}`);
  if (!file.startsWith(`${ROOT}${path.sep}`)) { response.writeHead(403); response.end(); return; }
  try { const stat = fs.statSync(file); if (!stat.isFile()) throw new Error('not-file'); response.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(response); }
  catch { response.writeHead(404); response.end('not found'); }
});
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = []; const pageErrors = []; const requestFailures = [];
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', error => pageErrors.push(String(error?.message || error)));
page.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));
let checks = 0;
try {
  await page.goto(`http://127.0.0.1:${PORT}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 45000 }); checks += 1;
  await page.evaluate(async () => {
    const { createSettlementCampaignRuntime } = await import('/src/3d/gameplay/settlementCampaignRuntime.js?browser-proof=1');
    const state = { version: 1, copper: 140, fatigue: 12, reputation: 6, locationId: 'north-settlement', settlementId: 'north-settlement', inventory: { iron_ore: 9, coal: 6, bread: 5, stew: 2, herb: 2, leather: 3, linen: 2 }, quests: {}, skills: { smithing: 4, dialogue: 3, travel: 3, commerce: 3, survival: 2 }, perks: ['merchant_road', 'market_eye', 'roadwise'], flags: { 'settlement.flag.0': true } };
    const calls = [];
    const handlers = Object.fromEntries(['enterSettlement','talk','trade','craft','acceptQuest','advanceQuest','travel','save'].map(name => [name, async payload => { calls.push([name, payload.action, payload.node?.id]); return { ok: true, action: payload.action, nodeId: payload.node?.id }; }]));
    const runtime = createSettlementCampaignRuntime({
      initialState: state, handlers,
      definition: { id: 'shipped-browser-slice', settlementId: 'north-settlement', entryNodeId: 'settlement', nodes: [
        { id: 'settlement', kind: 'settlement', actions: ['enter', 'back'], capabilities: { door: true } },
        { id: 'blacksmith', kind: 'crafting', actions: ['talk', 'trade', 'craft', 'back'], capabilities: { dialogue: true, trade: true, crafting: true } },
        { id: 'tavern', kind: 'npc', actions: ['talk', 'acceptQuest', 'advanceQuest', 'rest', 'back'], capabilities: { dialogue: true, quest: true } },
        { id: 'gate', kind: 'door', actions: ['enter', 'travel', 'back'], capabilities: { door: true, travel: true } },
      ] },
    });
    window.__AapwSettlementCampaignBrowserProof = { calls, runtime, events: [] };
    runtime.open('blacksmith', 'craft');
    await runtime.execute('craft', { recipeId: 'iron_sword', requestId: 'browser-craft-1' });
    await runtime.execute('trade', { itemId: 'iron_ore', quantity: 2, direction: 'sell', requestId: 'browser-trade-1' });
    runtime.open('tavern', 'quests');
    await runtime.execute('acceptQuest', { questId: 'settlement-supply', requestId: 'browser-quest-1' });
    await runtime.execute('advanceQuest', { questId: 'settlement-supply', requestId: 'browser-quest-2' });
    runtime.open('gate', 'travel');
    await runtime.execute('travel', { routeId: 'north_gate', requestId: 'browser-travel-1' });
    await runtime.save({ requestId: 'browser-save-1', slot: 'proof' });
    window.__AapwSettlementCampaignBrowserProof.view = runtime.getViewModel();
    window.__AapwSettlementCampaignBrowserProof.manifest = runtime.manifest();
  });
  const proof = await page.evaluate(() => ({ calls: window.__AapwSettlementCampaignBrowserProof.calls, view: window.__AapwSettlementCampaignBrowserProof.view, manifest: window.__AapwSettlementCampaignBrowserProof.manifest }));
  assert.ok(proof.view.activeService); checks += 1;
  assert.equal(proof.view.contentVersion, 2); checks += 1;
  for (const name of ['craft','trade','acceptQuest','advanceQuest','travel','save']) { assert.ok(proof.calls.some(call => call[0] === name), `missing ${name}`); checks += 1; }
  assert.ok(proof.manifest.digest); checks += 1;
  assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`); checks += 1;
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`); checks += 1;
  assert.equal(requestFailures.length, 0, `request failures: ${JSON.stringify(requestFailures.slice(0, 10))}`); checks += 1;
  console.log(JSON.stringify({ status: 'PASS', checks, calls: proof.calls.length, digest: proof.manifest.digest, consoleErrors: consoleErrors.length, pageErrors: pageErrors.length, requestFailures: requestFailures.length }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
