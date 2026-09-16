import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = resolve(ROOT, 'wasm/Cargo.toml');
const sourceBinary = resolve(ROOT, 'target/wasm32-unknown-unknown/release/aapw_hotpath.wasm');
const output = resolve(ROOT, 'public/wasm/aapw_hotpath.wasm');

const run = (command, args) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  child.on('error', rejectPromise);
  child.on('exit', code => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with code ${code ?? 'unknown'}`)));
});

await run('cargo', ['build', '--manifest-path', manifest, '--release', '--target', 'wasm32-unknown-unknown']);
await mkdir(resolve(ROOT, 'public/wasm'), { recursive: true });
await (await import('node:fs/promises')).copyFile(sourceBinary, output);
console.log(JSON.stringify({ manifest, output, bytes: (await (await import('node:fs/promises')).stat(output)).size, target: 'wasm32-unknown-unknown', profile: 'release' }, null, 2));
