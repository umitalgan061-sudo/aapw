import { describe, expect, it } from 'vitest';
import {
  createDefaultInputPipeline,
  InputIntentPipeline,
} from '../../../src/3d/modern/r32/inputPipeline.ts';
import { asFrameIndex, asTick } from '../../../src/3d/modern/r32/contracts.ts';

describe('R32 input pipeline', () => {
  it('builds deterministic movement intent from keyboard samples', () => {
    const input=createDefaultInputPipeline();
    const tick=asTick(1);
    const frame=asFrameIndex(1);
    input.beginTick(tick,frame);

    expect(input.consume({
      action:'move',
      device:'keyboard',
      phase:'started',
      value:1,
      tick,
      frame,
      rawCode:'KeyW',
    })).toBe(true);

    expect(input.vector('move')).toEqual({
      x:0,
      y:1,
    });

    expect(input.isPressed('move')).toBe(false);
    expect(input.isHeld('move')).toBe(false);
  });

  it('tracks held and released actions', () => {
    const input=createDefaultInputPipeline();
    input.beginTick(asTick(5),asFrameIndex(5));

    input.consume({
      action:'jump',
      device:'keyboard',
      phase:'started',
      value:1,
      tick:asTick(5),
      frame:asFrameIndex(5),
      rawCode:'Space',
    });

    expect(input.isPressed('jump')).toBe(true);
    expect(input.isHeld('jump')).toBe(true);

    input.beginTick(asTick(6),asFrameIndex(6));

    input.consume({
      action:'jump',
      device:'keyboard',
      phase:'ended',
      value:0,
      tick:asTick(6),
      frame:asFrameIndex(6),
      rawCode:'Space',
    });

    expect(input.isReleased('jump')).toBe(true);
    expect(input.isHeld('jump')).toBe(false);
  });

  it('respects higher priority input contexts', () => {
    const input=new InputIntentPipeline();

    input.registerContext({
      id:'gameplay',
      priority:10,
      enabled:true,
      bindings:[
        {
          action:'move',
          device:'keyboard',
          code:'KeyW',
          scale:1,
        },
      ],
    });

    input.registerContext({
      id:'menu',
      priority:20,
      enabled:true,
      bindings:[
        {
          action:'pause',
          device:'keyboard',
          code:'KeyW',
          scale:1,
        },
      ],
    });

    input.beginTick(asTick(1),asFrameIndex(1));

    expect(input.consume({
      action:'pause',
      device:'keyboard',
      phase:'started',
      value:1,
      tick:asTick(1),
      frame:asFrameIndex(1),
      rawCode:'KeyW',
    })).toBe(true);
  });

  it('keeps a bounded replay buffer', () => {
    const input=new InputIntentPipeline({
      recordingLimit:2,
    });

    input.registerContext({
      id:'test',
      priority:1,
      enabled:true,
      bindings:[
        {
          action:'attack',
          device:'synthetic',
          code:'attack',
          scale:1,
        },
      ],
    });

    for(let i=1;i<=4;i+=1){
      const tick=asTick(i);
      const frame=asFrameIndex(i);
      input.beginTick(tick,frame);
      input.consume({
        action:'attack',
        device:'synthetic',
        phase:'started',
        value:1,
        tick,
        frame,
        rawCode:'attack',
      });
    }

    expect(input.recorded()).toHaveLength(2);
  });
});
