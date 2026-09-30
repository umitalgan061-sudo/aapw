#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { summarizeHealth, type HealthGate, type HealthGateResult } from '../src/platform/projectHealth.ts';

const GATES: readonly HealthGate[] = Object.freeze([
  { id: 'typescript-source', command: 'npm', args: ['run', 'verify:ts-source'], timeoutMs: 30_000 },
  { id: 'strict-core', command: 'npm', args: ['run', 'check:strict-core'], timeoutMs: 120_000 },
  { id: 'strict-runtime-hardening', command: 'npm', args: ['run', 'check:runtime-hardening-r25'], timeoutMs: 120_000 },
  { id: 'typed-gameplay', command: 'npm', args: ['run', 'check:typed-gameplay-r11'], timeoutMs: 120_000 },
  { id: 'typed-world', command: 'npm', args: ['run', 'check:typed-world-platform-r11'], timeoutMs: 120_000 },
  { id: 'modern-runtime', command: 'npm', args: ['run', 'check:modern:r27'], timeoutMs: 120_000 },
  { id: 'tooling', command: 'npm', args: ['run', 'check:tooling-r24'], timeoutMs: 120_000 },
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
const results: HealthGateResult[] = [];
for (const gate of GATES) {
  const result = await executeGate(gate);
  results.push(result);
  process.stdout.write(`[${result.status}] ${result.id} (${result.durationMs}ms)\n`);
  if (result.status !== 'passed') {
    if (result.stderr) process.stderr.write(result.stderr.slice(-8_000) + '\n');
    break;
  }
}
const summary = summarizeHealth(results, Math.round(performance.now() - started));
process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
if (!summary.ok) process.exitCode = 1;
