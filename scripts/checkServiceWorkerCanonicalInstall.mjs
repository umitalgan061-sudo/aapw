#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../service-worker.js', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');
const installListeners = [];
const addAllCalls = [];
const addCalls = [];
const waits = [];

const cache = {
  add: async (entry) => { addCalls.push(entry); },
  addAll: async (entries) => { addAllCalls.push([...entries]); },
  match: async () => null,
  put: async () => {},
};

const context = vm.createContext({
  URL,
  Promise,
  Response,
  console,
  fetch: async () => ({ ok: true, status: 200, clone() { return this; } }),
  caches: {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
  },
  self: {
    location: {
      href: 'https://example.test/westeros/service-worker.js',
      origin: 'https://example.test',
    },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
    addEventListener(type, listener) {
      if (type === 'install') installListeners.push(listener);
    },
  },
});

const instrumented = `${source}\n;globalThis.__PWA_TEST_GAME3D = GAME3D_SHELL_FILES;`;
vm.runInContext(instrumented, context, { filename: 'service-worker.js' });

assert(installListeners.length > 1, 'service worker should register install-time shell extensions plus the main installer');
for (const listener of installListeners) {
  const event = {
    waitUntil(promise) {
      waits.push(Promise.resolve(promise));
    },
  };
  listener(event);
}
await Promise.all(waits);

const rawGame3d = context.__PWA_TEST_GAME3D;
assert(Array.isArray(rawGame3d) && rawGame3d.length > 150, 'instrumented GAME3D shell should expose the shipped 3D cache graph');

const base = context.self.location.href;
const canonical = (entry) => new URL(entry, base).href;
const rawCanonical = rawGame3d.map(canonical);
const rawCanonicalSet = new Set(rawCanonical);
assert(rawCanonicalSet.size < rawCanonical.length, 'fixture should retain at least one raw spelling collision that install-time canonicalization must resolve');

const moonSpace = './assets/models/Ay/Moon 2K.fbx';
const moonEncoded = './assets/models/Ay/Moon%202K.fbx';
assert(rawGame3d.includes(moonSpace), 'space-spelled Moon reference must remain represented for static source coverage');
assert(rawGame3d.includes(moonEncoded), 'encoded Moon reference must remain represented for static source coverage');
assert.equal(canonical(moonSpace), canonical(moonEncoded), 'Moon spellings must resolve to the same request URL');

assert.equal(addAllCalls.length, 2, 'main install contract should issue one 2D and one 3D addAll call');
const game3dAddAll = addAllCalls.find((entries) => entries.some((entry) => String(entry).includes('/src/3d/')));
assert(game3dAddAll, '3D addAll call was not observed');
const installedCanonical = game3dAddAll.map(canonical);
assert.equal(new Set(installedCanonical).size, installedCanonical.length, '3D cache.addAll must receive canonically unique request URLs');
assert.equal(installedCanonical.length, rawCanonicalSet.size, '3D install list must preserve every unique canonical shell request exactly once');
assert(installedCanonical.includes(canonical(moonSpace)), 'canonical Moon request disappeared from the 3D install set');
assert.equal(installedCanonical.filter((href) => href === canonical(moonSpace)).length, 1, 'canonical Moon request must be installed exactly once');

console.log('[checkServiceWorkerCanonicalInstall] PASS', JSON.stringify({
  installListeners: installListeners.length,
  rawGame3dEntries: rawGame3d.length,
  canonicalGame3dEntries: installedCanonical.length,
  canonicalCollisionsRemoved: rawGame3d.length - installedCanonical.length,
  moonCanonicalUrl: canonical(moonSpace),
  addCalls: addCalls.length,
}));
