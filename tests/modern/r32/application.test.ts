import { describe, expect, it } from 'vitest';
import {
  R32Application,
} from '../../../src/3d/modern/r32/application.ts';
import {
  R32_DEFAULT_CONFIG,
  asTick,
} from '../../../src/3d/modern/r32/contracts.ts';

describe('R32 application runtime', () => {
  it('starts and advances fixed simulation time', () => {
    const app=new R32Application({
      now:()=>{
        return 1;
      },
    });

    expect(app.running).toBe(false);

    app.start();

    expect(app.running).toBe(true);
    expect(app.state.state.mode).toBe('running');

    const before=app.diagnostics().clock.tick;

    app.tick(R32_DEFAULT_CONFIG.fixedStepSeconds);

    expect(
      app.diagnostics().clock.tick,
    ).toBeGreaterThan(before);

    app.shutdown();

    expect(app.running).toBe(false);
  });

  it('executes built-in transform command through the typed bus', async () => {
    const app=new R32Application();

    app.start();

    const command=app.commandBus.create(
      'player:set-transform',
      {
        x:10,
        y:20,
        z:-30,
      },
      asTick(1),
      'test',
    );

    const receipt=await app.commandBus.dispatch(
      command,
      asTick(1),
    );

    expect(receipt.accepted).toBe(true);

    expect(
      app.state.state.player.position,
    ).toEqual({
      x:10,
      y:20,
      z:-30,
    });

    app.shutdown();
  });

  it('provides health telemetry without browser globals', () => {
    const app=new R32Application({
      browser:undefined,
    });

    app.start();

    app.tick(1/60);

    const diagnostics=app.diagnostics();

    expect(
      diagnostics.health.score,
    ).toBeGreaterThanOrEqual(0);

    expect(
      diagnostics.health.score,
    ).toBeLessThanOrEqual(100);

    expect(
      diagnostics.clock.frame,
    ).toBeGreaterThan(0);

    app.shutdown();
  });
});
