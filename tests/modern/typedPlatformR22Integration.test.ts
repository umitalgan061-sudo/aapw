import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('R22 platform migration', () => {
  it('keeps application, PWA and smoke-check sources TypeScript-owned', async () => {
    const files = [
      'script.ts',
      'service-worker.ts',
      'src/app/rootApplicationRuntime.ts',
      'scripts/game3dSmokeChecks.ts',
      'scripts/game3dSmokeChecksMovement.ts',
      'scripts/game3dSmokeChecksDragonDive.ts',
      'scripts/game3dSmokeChecksDragonFlight.ts',
      'scripts/game3dSmokeChecksDragonPursuit.ts',
      'scripts/game3dSmokeChecksPauseMenu.ts',
      'scripts/game3dSmokeChecksScene.ts',
    ];
    for (const file of files) expect((await readFile(file, 'utf8')).length).toBeGreaterThan(100);
  });

  it('keeps the primary HTML entry and offline shell aligned', async () => {
    const [index, sw] = await Promise.all([
      readFile('index.html', 'utf8'),
      readFile('service-worker.js', 'utf8'),
    ]);
    expect(index).toContain('<script type="module" src="script.ts"></script>');
    expect(sw).toContain("'./script.ts'");
    expect(sw).toContain("westeros-shell-v22");
  });
});
