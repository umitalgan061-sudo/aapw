import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('R22 root application TypeScript migration', () => {
  it('uses the TypeScript module as the production entry and keeps a compatibility bridge', async () => {
    const [index, shim, source] = await Promise.all([
      readFile('index.html', 'utf8'),
      readFile('script.js', 'utf8'),
      readFile('script.ts', 'utf8'),
    ]);
    expect(index).toContain('<script type="module" src="script.ts"></script>');
    expect(shim).toContain("import('./script.ts')");
    expect(source).toContain('WESTEROS_LEGACY_COMMANDS');
    expect(source).toContain("version: 'r10-ts-core'");
  });

  it('keeps a large, explicit inline-command compatibility surface', async () => {
    const source = await readFile('script.ts', 'utf8');
    const names = [...source.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
    const unique = [...new Set(names)];
    expect(unique.length).toBeGreaterThanOrEqual(190);
    const block = source.match(/WESTEROS_LEGACY_COMMANDS = Object\.freeze\(\{([\s\S]*?)\}\);/);
    expect(block).not.toBeNull();
    for (const name of unique) expect(block[1]).toContain(name);
  });
});
