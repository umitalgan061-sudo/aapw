#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import { buildRuntimeGateDecision } from '../src/3d/gameplay/playerRuntimeEnvironmentGate.js';
import { createRuntimeProbeTranscript } from '../src/3d/gameplay/playerRuntimeTelemetry.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const outputPath = path.resolve(outArg ? outArg.slice('--out='.length) : 'artifacts/player-runtime-preflight/runtime-preflight.json');
const sampleTarget = Math.max(4, Math.min(32, Number(process.env.AAPW_RUNTIME_PREFLIGHT_SAMPLES) || 8));
const loadTimeoutMs = Math.max(30000, Math.min(180000, Number(process.env.AAPW_RUNTIME_PREFLIGHT_LOAD_TIMEOUT_MS) || 120000));
const probeTimeoutMs = Math.max(5000, Math.min(180000, Number(process.env.AAPW_RUNTIME_PREFLIGHT_PROBE_TIMEOUT_MS) || 60000));
const assertOrThrow = (condition, message) => { if (!condition) throw new Error(`[player-runtime-preflight] ${message}`); };

assertOrThrow(Boolean(loadPlaywright), 'Playwright unavailable');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const server = await startStaticServer();
const browser = await loadPlaywright().chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (error) => pageErrors.push(error?.message || String(error)));
page.on('console', (message) => {
  if (message.type() === 'error' && !/asset error|failed, using placeholder box/i.test(message.text())) {
    consoleErrors.push(message.text());
  }
});

const startedAt = Date.now();
try {
  await page.addInitScript(({ target }) => {
    const state = { frames: [], last: null, rafCount: 0 };
    window.__aapwRuntimePreflight = state;
    const capture = (timestamp) => {
      state.rafCount += 1;
      if (state.last !== null) state.frames.push(timestamp - state.last);
      state.last = timestamp;
      if (state.frames.length < target) requestAnimationFrame(capture);
    };
    requestAnimationFrame(capture);
  }, { target: sampleTarget });

  await page.goto(`http://127.0.0.1:${server.address().port}/game3d.html`, {
    waitUntil: 'commit',
    timeout: 30000,
  });

  const enteredAt = Date.now();
  const enterButton = page.locator('#run266-entry-enter');
  if (await enterButton.count()) await enterButton.click();

  await page.waitForFunction(
    () => document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden'),
    null,
    { timeout: loadTimeoutMs },
  );

  await page.waitForFunction(
    (target) => (window.__aapwRuntimePreflight?.frames?.length ?? 0) >= target,
    sampleTarget,
    { timeout: probeTimeoutMs },
  );

  const browserEvidence = await page.evaluate(() => ({
    frames: [...(window.__aapwRuntimePreflight?.frames ?? [])],
    rafCount: Number(window.__aapwRuntimePreflight?.rafCount ?? 0),
    devicePixelRatio: Number(window.devicePixelRatio || 1),
    hardwareConcurrency: Number(navigator.hardwareConcurrency || 0),
    userAgent: navigator.userAgent,
    readyState: document.readyState,
    loadingHidden: Boolean(document.querySelector('#game3d-loading')?.classList.contains('g3d-loading-hidden')),
  }));

  const transcript = createRuntimeProbeTranscript(browserEvidence.frames, {
    minimumSamples: sampleTarget,
    windowSize: sampleTarget,
    maxSamples: 32,
  });
  const gate = buildRuntimeGateDecision(browserEvidence.frames, {
    action: 'headless-preflight',
    simulationSeconds: 1,
    minimumFps: 0.5,
    requiredSamples: sampleTarget,
    minimumSamples: sampleTarget,
    windowSize: sampleTarget,
    maxSamples: 32,
  });

  const payload = Object.freeze({
    version: '2026-09-15-v1',
    generatedAtMs: Date.now() - startedAt,
    loadingElapsedMs: Date.now() - enteredAt,
    sampleTarget,
    browserEvidence,
    transcript,
    gate,
    pageErrors: [...pageErrors],
    consoleErrors: [...consoleErrors],
  });

  assertOrThrow(browserEvidence.frames.length >= sampleTarget, `expected ${sampleTarget} frame deltas, got ${browserEvidence.frames.length}`);
  assertOrThrow(gate.transcript.stable.ready, 'stable probe window not ready');
  assertOrThrow(Number.isFinite(gate.timeoutMs), 'derived timeout is not finite');
  assertOrThrow(gate.timeoutMs >= 5000 && gate.timeoutMs <= 900000, `derived timeout out of bounds: ${gate.timeoutMs}`);
  assertOrThrow(['inconclusive', 'runnable', 'runnable-constrained'].includes(gate.status), `unknown gate status: ${gate.status}`);

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    status: gate.status,
    classification: gate.classification,
    sampleCount: browserEvidence.frames.length,
    fps: gate.budget.summary.fps,
    meanFrameSeconds: gate.budget.summary.meanSeconds,
    p95FrameSeconds: gate.budget.summary.p95Seconds,
    maxFrameSeconds: gate.budget.summary.maxSeconds,
    timeoutMs: gate.timeoutMs,
    pollIntervalMs: gate.pollIntervalMs,
    loadingElapsedMs: payload.loadingElapsedMs,
    outputPath,
    pageErrors: pageErrors.length,
    consoleErrors: consoleErrors.length,
  }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
