#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('./checkCurrentLifecycleReinitShadow.ts', import.meta.url));
const child = spawn(process.execPath, ['--experimental-strip-types', target, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) {
    const signals = { SIGINT: 130, SIGTERM: 143 };
    process.exitCode = signals[signal] ?? 1;
    return;
  }
  process.exitCode = code ?? 1;
});
