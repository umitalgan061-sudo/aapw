#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'artifacts/world-environment-acceptance');
const REPORT_PATH = path.join(OUT_DIR, 'world-environment-acceptance-failure.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, 'scripts/checkWorldEnvironmentAcceptanceMatrix.mjs')],
  {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0 || result.error || result.signal) {
  const diagnostic = {
    command: 'node scripts/checkWorldEnvironmentAcceptanceMatrix.mjs',
    exitCode: result.status,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    stdoutTail: (result.stdout ?? '').split('\n').slice(-80).join('\n'),
    stderrTail: (result.stderr ?? '').split('\n').slice(-80).join('\n'),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(diagnostic, null, 2)}\n`);
  console.error(`WORLD_ENVIRONMENT_ACCEPTANCE_DIAGNOSTIC=${REPORT_PATH}`);
  process.exit(result.status ?? 1);
}

if (fs.existsSync(REPORT_PATH)) fs.rmSync(REPORT_PATH);
console.log('WORLD_ENVIRONMENT_ACCEPTANCE_WRAPPER_OK');
