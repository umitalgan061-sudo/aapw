#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { summarizeHealth, evaluateTypeScriptOwnership, type HealthGate, type HealthGateResult } from '../src/platform/projectHealth.ts';

async function collectSourceFiles(root = 'src'): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'vendor' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = root + '/' + entry.name;
    if (entry.isDirectory()) files.push(...await collectSourceFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const GATES: readonly HealthGate[] = Object.freeze([
  { id: 'typescript-source', command: 'npm', args: ['run', 'verify:ts-source'], timeoutMs: 30_000 },
  { id: 'strict-core', command: 'npm', args: ['run', 'check:strict-core'], timeoutMs: 120_000 },
  { id: 'strict-runtime-hardening', command: 'npm', args: ['run', 'check:runtime-hardening-r25'], timeoutMs: 120_000 },
  { id: 'typed-gameplay', command: 'npm', args: ['run', 'check:typed-gameplay-r11'], timeoutMs: 120_000 },
  { id: 'typed-world', command: 'npm', args: ['run', 'check:typed-world-platform-r11'], timeoutMs: 120_000 },
  { id: 'modern-runtime', command: 'npm', args: ['run', 'check:modern:r27'], timeoutMs: 120_000 },
  { id: 'tooling', command: 'npm', args: ['run', 'check:tooling-r24'], timeoutMs: 120_000 },
  { id: 'active-typescript-ownership-r30', command: 'npm', args: ['run', 'verify:active-typescript-r30'], timeoutMs: 60_000 },
  { id: 'strict-world-r30', command: 'npm', args: ['run', 'check:strict-world-r30'], timeoutMs: 120_000 },
  { id: 'typescript-tooling-r32', command: 'npm', args: ['run', 'check:tooling-r32'], timeoutMs: 180_000 },
  { id: 'strict-runtime-r33', command: 'npm', args: ['run', 'check:strict-runtime-r33'], timeoutMs: 120_000 },
  { id: 'world-payload-r34', command: 'npm', args: ['run', 'check:world-payload-r34'], timeoutMs: 120_000 },
]);

function executeGate(gate: HealthGate): Promise<HealthGateResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(gate.command, gate.args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, gate.timeoutMs);
    child.stdout.on('data', (chunk: Buffer | string) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve(Object.freeze({ id: gate.id, status: 'failed', exitCode: null, durationMs: Math.round(performance.now() - started), stdout, stderr: stderr + String(error) }));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve(Object.freeze({ id: gate.id, status: timedOut ? 'timed-out' : exitCode === 0 ? 'passed' : 'failed', exitCode, durationMs: Math.round(performance.now() - started), stdout, stderr }));
    });
  });
}

const started = performance.now();
const sourceFiles = await collectSourceFiles();
const ownership = evaluateTypeScriptOwnership(sourceFiles);

const results: HealthGateResult[] = [Object.freeze({
  id: 'typescript-source-ownership',
  status: ownership.violations.length === 0 ? 'passed' : 'failed',
  exitCode: ownership.violations.length === 0 ? 0 : 1,
  durationMs: 0,
  stdout: `${ownership.scannedJavaScriptFiles} source JS files scanned`,
  stderr: ownership.violations.length === 0
    ? ''
    : `Missing TypeScript owners: ${ownership.violations.join(', ')}`,
})];

process.stdout.write(
  `[${results[0]!.status}] typescript-source-ownership: ${ownership.scannedJavaScriptFiles} source JS files scanned\\n`,
);

if (results[0]!.status === 'passed') {
  for (const gate of GATES) {
    const result = await executeGate(gate);
    results.push(result);
    process.stdout.write(`[${result.status}] ${result.id} (${result.durationMs}ms)\\n`);
    if (result.status !== 'passed') {
      if (result.stderr) process.stderr.write(result.stderr.slice(-8_000) + '\\n');
      break;
    }
  }
}
const summary = summarizeHealth(results, Math.round(performance.now() - started));
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
if (!summary.ok) process.exitCode = 1;
