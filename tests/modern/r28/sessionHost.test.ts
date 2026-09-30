import { describe, expect, it } from 'vitest';
import { BrowserGameSession } from '../../../src/3d/modern/r28/browserSession.ts';

describe('R28 browser game session', () => {
  it('constructs a complete lifecycle bundle without network coupling', () => {
    const session = new BrowserGameSession({ session: false, qualityLevel: 2 });
    expect(session.state().connected).toBe(false);
    expect(session.state().lifecycle).toBe('created');
    expect(session.resources.stats().count).toBe(0);
    session.dispose();
  });

  it('tracks resources through the session boundary', async () => {
    const session = new BrowserGameSession({ session: false });
    let disposed = false;
    session.resources.register({
      id: 'runtime-buffer',
      kind: 'buffer',
      bytes: 128,
      dispose: () => { disposed = true; },
    });
    expect(session.state().resources.bytes).toBe(128);
    await session.dispose();
    expect(disposed).toBe(true);
  });
});
