import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = 4177;
const ROOT = process.cwd();
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/__companion_harness.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><main id="app">companion-runtime-qa</main></body></html>');
    return;
  }
  const relative = pathname.replace(/^\//, '');
  const filePath = path.join(ROOT, relative);
  if (relative.startsWith('src/') && !relative.includes('..')) {
    try {
      const file = await fs.readFile(filePath);
      const type = relative.endsWith('.js') || relative.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
      res.end(file);
      return;
    } catch {
      // Fall through to the explicit 404 rather than hiding a missing shipped module.
    }
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
const requestFailures = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('requestfailed', (request) => requestFailures.push(`${request.url()} :: ${request.failure()?.errorText || 'failed'}`));

await page.goto(`http://127.0.0.1:${PORT}/__companion_harness.html`, { waitUntil: 'load' });
const proof = await page.evaluate(async () => {
  const THREE = await import('/src/3d/vendor/three/three.module.js');
  const { createLivingWorldCompanionRuntime, auditLivingWorldCompanionRuntime, LIVING_WORLD_COMPANION_RUNTIME_POLICY } = await import('/src/3d/gameplay/livingWorldCompanionRuntimeAdapter.js');

  const actor = (id, x, z, extra = {}) => {
    const object3D = new THREE.Object3D();
    object3D.position.set(x, 0, z);
    return { id, ...extra, object3D, position: object3D.position };
  };
  const calls = [];
  const services = {
    perception: {
      getSignals(ref) {
        if (ref?.id !== 'guard') return [];
        return [{ id: 'contact', kind: 'enemy', confidence: 1, distanceMeters: 4, visible: true, audible: true, targetId: 'raider', position: { x: 7, z: 0 }, source: 'visual' }];
      },
    },
    factions: { getFactionIdForActor: () => 'watch' },
    reputation: { getReputation: () => 15 },
    diplomacy: { getRelation: () => 'war' },
    law: { getWantedLevel: () => 85, getCrimeSeverity: () => 70, reportCrime: (event) => { calls.push(['law', event?.type]); return { accepted: true }; } },
    navigation: { requestTravel: (ref, request) => { calls.push(['navigation', ref.id, request.kind]); return { accepted: true }; } },
    combat: { requestSupport: (ref, target, request) => { calls.push(['combat', ref.id, target.id, request.kind]); return { accepted: true }; } },
    worldEventsPublisher: { publish: (event) => { calls.push(['event', event?.type]); return { accepted: true }; } },
  };

  const guard = actor('guard', 0, 0);
  const raider = actor('raider', 7, 0, { factionId: 'raiders' });
  const wolf = actor('wolf', 5, 0);
  const collections = { npcs: [guard, raider], animals: [wolf], creatures: [], dragons: [] };
  const runtime = createLivingWorldCompanionRuntime({ services, seed: 'browser-companion', clockSeconds: 0 });
  const first = runtime.tick({ deltaSeconds: 0.25, collections, playerPosition: { x: 0, z: 0 }, companions: [{ id: 'escort-wolf', actorId: 'wolf', targetId: 'guard', mode: 'escort', followDistanceMeters: 5 }] });
  const second = runtime.tick({ deltaSeconds: 0.25, collections, playerPosition: { x: 0, z: 0 }, companions: [{ id: 'escort-wolf', actorId: 'wolf', targetId: 'guard', mode: 'escort', followDistanceMeters: 5 }] });
  const audit = auditLivingWorldCompanionRuntime(second);
  const telemetry = wolf.object3D.userData.livingWorldCompanion;
  return {
    accepted: first.accepted === true && second.accepted === true,
    companionCount: second.companionCount,
    state: second.results[0]?.state,
    navigationObserved: calls.some((entry) => entry[0] === 'navigation'),
    combatObserved: calls.some((entry) => entry[0] === 'combat'),
    eventObserved: calls.some((entry) => entry[0] === 'event'),
    auditOk: audit.ok === true,
    telemetryFinite: Number.isFinite(telemetry?.distanceMeters ?? 0),
    digestLength: typeof second.digest === 'string' ? second.digest.length : 0,
    policyId: LIVING_WORLD_COMPANION_RUNTIME_POLICY.id,
    actorTypes: [guard, wolf, raider].map((entry) => entry.object3D.type),
  };
});

await browser.close();
await new Promise((resolve) => server.close(resolve));

if (pageErrors.length || consoleErrors.length || requestFailures.length) {
  console.error('LIVING_WORLD_COMPANION_BROWSER_FAIL', JSON.stringify({ pageErrors, consoleErrors, requestFailures }));
  process.exit(1);
}
const required = [
  proof.accepted,
  proof.companionCount === 1,
  proof.navigationObserved,
  proof.combatObserved,
  proof.eventObserved,
  proof.auditOk,
  proof.telemetryFinite,
  proof.digestLength === 8,
  proof.actorTypes.every((type) => type === 'Object3D'),
];
if (required.some((value) => !value)) {
  console.error('LIVING_WORLD_COMPANION_BROWSER_FAIL', JSON.stringify(proof));
  process.exit(1);
}
console.log('LIVING_WORLD_COMPANION_BROWSER_PASS', JSON.stringify({ proof, pageErrors, consoleErrors, requestFailures }));
