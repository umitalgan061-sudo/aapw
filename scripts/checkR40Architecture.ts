import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const R40 = join(SRC, '3d', 'modern', 'r40');
const REQUIRED = ['types.ts', 'deterministic.ts', 'scheduler.ts', 'world.ts', 'render.ts', 'streaming.ts', 'network.ts', 'ai.ts', 'audio.ts', 'save.ts', 'observability.ts', 'security.ts', 'ecs.ts', 'runtime.ts', 'capabilities.ts', 'input.ts'];

async function exists(path: string): Promise<boolean> {
  try { await readFile(path, 'utf8'); return true; } catch { return false; }
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }

async function main(): Promise<void> {
  for (const name of REQUIRED) assert(await exists(join(R40, name)), 'missing R40 module: ' + name);
  const files = await walk(R40);
  const tsFiles = files.filter((file) => file.endsWith('.ts'));
  assert(tsFiles.length >= REQUIRED.length, 'R40 source registry unexpectedly shrank');
  for (const file of tsFiles) {
    const source = await readFile(file, 'utf8');
    assert(!source.includes('@ts-nocheck'), 'R40 must not use @ts-nocheck: ' + relative(ROOT, file));
    assert(!source.includes('@ts-ignore'), 'R40 must not use @ts-ignore: ' + relative(ROOT, file));
    assert(!source.includes('eval('), 'R40 must not use eval(): ' + relative(ROOT, file));
    assert(!source.includes('new Function('), 'R40 must not use dynamic Function(): ' + relative(ROOT, file));
  }
  process.stdout.write(JSON.stringify({ ok: true, modules: tsFiles.length, policy: 'R40-typed-runtime' }) + '\\n');
}

void main();
