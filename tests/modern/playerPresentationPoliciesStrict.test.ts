import { describe, expect, it } from 'vitest';
import {
  createPlayerAnimationOneShotController,
  resolvePlayerAnimationOneShotFingerprint,
} from '../../src/3d/gameplay/playerAnimationOneShotPolicy.ts';
import {
  createPlayerCombatActionRouter,
  PLAYER_COMBAT_INPUT_EVENT,
} from '../../src/3d/gameplay/playerCombatActionRouter.ts';
import {
  auditAnimationBlendContract,
  buildAnimationBlendDiagnostics,
  resolveAnimationTransitionWindow,
} from '../../src/3d/gameplay/playerAnimationBlendDiagnostics.ts';

describe('Kızıl Ufuk strict presentation policies', () => {
  it('keeps one-shot requests deterministic and bounded', () => {
    const a = resolvePlayerAnimationOneShotFingerprint({ action: 'heavy-attack', windowSeconds: 0.7, priority: 8 });
    const b = resolvePlayerAnimationOneShotFingerprint({ priority: 8, windowSeconds: 0.7, action: 'heavy-attack' });
    expect(a).toBe(b);

    const controller = createPlayerAnimationOneShotController({ historyLimit: 4 });
    const started = controller.update(0, { action: 'heavy-attack', windowSeconds: 0.7, priority: 8 });
    expect(started.started).toBe(true);
    expect(started.snapshot.state.phase).toBe('holding');
    expect(started.snapshot.state.remainingSeconds).toBeLessThanOrEqual(0.7);
    controller.update(0.7);
    expect(controller.snapshot().state.phase).toBe('cooldown');
    controller.update(0.08);
    expect(controller.snapshot().state.phase).toBe('ready');
  });

  it('keeps combat action routing bounded and event-driven', () => {
    const target = new EventTarget() as EventTarget & { readonly CustomEvent?: typeof CustomEvent };
    let received: unknown = null;
    target.addEventListener(PLAYER_COMBAT_INPUT_EVENT, (event) => {
      received = (event as CustomEvent).detail;
    });
    const router = createPlayerCombatActionRouter({ target, maxQueue: 2, ttlMs: 750, now: () => 1000 });
    expect(router.enqueue('lightAttack', 'keyboard', 1000)).toBe(true);
    expect(router.enqueue('heavy', 'gamepad', 1001)).toBe(true);
    expect(router.enqueue('invalid', 'keyboard', 1002)).toBe(false);
    expect(router.drain({ currentTime: 1002, max: 2 })).toHaveLength(2);
    expect(router.emit('heavyAttack', 'touch', 1003)).toBe(true);
    expect(received).toMatchObject({ kind: 'heavy', source: 'touch' });
    router.reset();
  });

  it('protects combat transitions and normalizes blend weights', () => {
    const protectedWindow = resolveAnimationTransitionWindow({
      fromState: 'heavy-attack',
      toState: 'guard',
      normalizedTime: 0.1,
      canInterrupt: true,
      environmentConfidence: 0.5,
    });
    expect(protectedWindow.permitted).toBe(false);
    expect(protectedWindow.protectedWindow).toBe(true);

    const diagnostics = buildAnimationBlendDiagnostics({
      semanticState: 'locomotion',
      primaryState: 'locomotion',
      primaryWeight: 0.8,
      secondaryState: 'guard',
      secondaryWeight: 0.2,
      planarSpeedMps: 3.2,
      runIntent: false,
    });
    expect(diagnostics.audit.ok).toBe(true);
    expect(auditAnimationBlendContract(diagnostics.contract).ok).toBe(true);
    expect(diagnostics.contract.locomotionWeights).toBeTruthy();
  });
});
