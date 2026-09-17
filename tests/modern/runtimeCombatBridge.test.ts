import { describe, expect, it } from 'vitest';
import { RuntimeIntegrationV2 } from '../../src/3d/modern/runtimeIntegrationV2.ts';
import { makeCombatTarget } from '../../src/3d/modern/combatAuthority.ts';

describe('RuntimeIntegrationV2 combat bridge', () => {
  it('accepts a semantic combat action without removing legacy input support', () => {
    const runtime = new RuntimeIntegrationV2({ now: () => 0 });
    runtime.registerWorldActor(
      { id: 'target', x: 0, y: 1, radius: 1, value: { kind: 'npc', team: 'enemy' } },
      Object.freeze({ ...makeCombatTarget('target', 'enemy'), x: 0, z: 1 }),
    );
    const result = runtime.tick({ deltaMs: 200, combatAction: 'light' });
    expect(result.combatDecision?.action).toBe('light');
    expect(result.combatDecision?.checksum).toMatch(/^[0-9a-f]+$/);
    runtime.dispose();
  });

  it('produces identical digests for equivalent semantic combat commands', () => {
    const a = new RuntimeIntegrationV2({ now: () => 0 });
    const b = new RuntimeIntegrationV2({ now: () => 0 });
    const first = a.tick({ deltaMs: 200, combatAction: 'heavy' });
    const second = b.tick({ deltaMs: 200, combatAction: 'heavy' });
    expect(first.digest).toBe(second.digest);
    expect(first.combatDecision?.action).toBe('heavy');
    a.dispose();
    b.dispose();
  });
});
