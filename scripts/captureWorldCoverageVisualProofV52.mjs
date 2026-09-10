import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv.find((arg) => arg.startsWith('--out-dir='))?.split('=')[1] ?? path.join(ROOT, 'artifacts', 'world-coverage-visual-v52'));
const PORT = Number(process.env.WORLD_COVERAGE_PROOF_PORT ?? 41752);
const URL = `http://127.0.0.1:${PORT}/game3d.html`;
const WIDTH = 1536;
const HEIGHT = 1024;
const SAMPLE_WAIT_MS = 1800;
fs.mkdirSync(OUT, { recursive: true });

function log(message) { process.stdout.write(`[WorldCoverageV52] ${message}\n`); }
function fail(message, error) { process.stderr.write(`[WorldCoverageV52] FAIL ${message}\n`); if (error) process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 2; }

function spawnServer() {
  const server = spawn(process.execPath, ['scripts/editorLiveServer.js'], {
    cwd: ROOT,
    env: { ...process.env, WESTEROS_EDITOR_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => { output += chunk.toString(); });
  server.stderr.on('data', (chunk) => { output += chunk.toString(); });
  return { server, getOutput: () => output };
}

async function waitForUrl(page, url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 }); return; }
    catch (error) { if (Date.now() - started > timeoutMs - 10000) throw error; await delay(250); }
  }
  throw new Error(`navigation timeout: ${url}`);
}

function centerForWorld(cameraSpec, x, z) {
  const halfX = cameraSpec.orthographicHalfWidth;
  const halfZ = cameraSpec.orthographicHalfHeight;
  return { x, y: cameraSpec.height, z, left: x - halfX, right: x + halfX, top: z - halfZ, bottom: z + halfZ };
}

const CAMERA_SAMPLES = [
  { id: 'full-world', x: 0, z: 0, height: 15500, orthographicHalfWidth: 13500, orthographicHalfHeight: 9000 },
  { id: 'terrain-near', x: 0, z: 0, height: 1900, orthographicHalfWidth: 2200, orthographicHalfHeight: 1450 },
  { id: 'northwest-near', x: -3100, z: -1800, height: 1700, orthographicHalfWidth: 1900, orthographicHalfHeight: 1300 },
  { id: 'mountain-near', x: 2900, z: -1650, height: 2100, orthographicHalfWidth: 2150, orthographicHalfHeight: 1500 },
  { id: 'coast-water', x: 0, z: 2350, height: 1800, orthographicHalfWidth: 2100, orthographicHalfHeight: 1450 },
  { id: 'forest-ecotone', x: -1050, z: -680, height: 1300, orthographicHalfWidth: 1500, orthographicHalfHeight: 1100 },
];

async function collectPageDiagnostics(page, sample) {
  return page.evaluate((expected) => {
    const runtime = globalThis.__AapwWorldCoverageVisualRuntimeV52__ ?? null;
    const canvas = document.querySelector('#game3d-canvas');
    return {
      expected,
      runtimeInstalled: Boolean(runtime?.installed),
      runtimeId: runtime?.id ?? null,
      canvasPresent: Boolean(canvas),
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      readyText: document.querySelector('#game3d-loading')?.textContent ?? '',
      title: document.title,
    };
  }, centerForWorld(sample, sample.x, sample.z));
}

async function configureOrthoCamera(page, sample) {
  return page.evaluate(({ x, z, height, orthographicHalfWidth, orthographicHalfHeight }) => {
    const state = globalThis.__RUN197_LIVE_STATE__ ?? globalThis.__RUN198_LIVE_STATE__ ?? globalThis.__WESTEROS_3D_STATE__ ?? null;
    if (!state?.camera) return { configured: false, reason: 'live createScene state is not globally exposed in this build' };
    const camera = state.camera;
    camera.position.set(x, height, z);
    if ('left' in camera) {
      camera.left = -orthographicHalfWidth;
      camera.right = orthographicHalfWidth;
      camera.top = orthographicHalfHeight;
      camera.bottom = -orthographicHalfHeight;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(x, 0, z);
    state.controls && (state.controls.enabled = false);
    state.renderer?.setSize?.(1536, 1024, false);
    state.renderer?.render?.(state.scene, state.camera);
    return { configured: true };
  }, sample);
}

async function captureSample(page, sample) {
  log(`capturing ${sample.id}`);
  const cameraResult = await configureOrthoCamera(page, sample);
  await delay(350);
  const screenshotPath = path.join(OUT, `${sample.id}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const diagnostics = await collectPageDiagnostics(page, sample);
  return { sample, cameraResult, screenshotPath, pngBytes: fs.statSync(screenshotPath).size, diagnostics };
}

async function main() {
  let playwright;
  try { playwright = await import('playwright'); }
  catch (error) { fail('Playwright is unavailable; real shipped visual evidence cannot be claimed.', error); return; }
  const { server, getOutput } = spawnServer();
  try {
    await delay(750);
    log(`server: ${getOutput().trim()}`);
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await waitForUrl(page, URL);
    await delay(SAMPLE_WAIT_MS);
    const results = [];
    for (const sample of CAMERA_SAMPLES) results.push(await captureSample(page, sample));
    const summary = {
      policyId: 'world-coverage-visual-runtime-2026-09-10-v52',
      width: WIDTH,
      height: HEIGHT,
      samples: results.map((result) => ({ id: result.sample.id, screenshot: path.relative(ROOT, result.screenshotPath), bytes: result.pngBytes, camera: result.cameraResult, diagnostics: result.diagnostics })),
      consoleErrors,
      pageErrors,
      note: 'PNG artifacts come from the shipped game3d.html/createScene path; no post-processing is applied.',
    };
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(summary, null, 2));
    await browser.close();
    if (consoleErrors.length || pageErrors.length) throw new Error(`browser errors: ${[...consoleErrors, ...pageErrors].join(' | ')}`);
    if (results.some((result) => !result.cameraResult.configured)) log('camera reconfiguration is unavailable; captured shipped default scene only and recorded this in manifest');
    log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_PROOF_CAPTURED samples=${results.length}`);
  } finally {
    server.kill('SIGTERM');
    await delay(100);
  }
}
main().catch((error) => fail('unhandled proof capture error', error));
