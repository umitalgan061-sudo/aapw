import { describe, expect, it } from 'vitest';
import {
  RenderPipelineR50,
  createMinimalRenderPipeline,
} from '../../../src/3d/modern/r50/renderPipeline.ts';

describe('R50 render pipeline', () => {
  it('topologically sorts render dependencies', () => {
    const pipeline=new RenderPipelineR50({
      clock:()=>0,
    });

    pipeline.registerPass({
      id:'final',
      phase:'composite',
      kind:'postprocess',
      priority:'normal',
      after:['lighting'],
      estimatedMilliseconds:1,
      execute:()=>({
        submitted:true,
        commands:1,
        milliseconds:1,
        bytesWritten:0,
      }),
    });

    pipeline.registerPass({
      id:'lighting',
      phase:'lighting',
      kind:'compute',
      priority:'high',
      after:['geometry'],
      estimatedMilliseconds:1,
      execute:()=>({
        submitted:true,
        commands:1,
        milliseconds:1,
        bytesWritten:0,
      }),
    });

    pipeline.registerPass({
      id:'geometry',
      phase:'geometry',
      kind:'opaque',
      priority:'high',
      estimatedMilliseconds:1,
      execute:()=>({
        submitted:true,
        commands:1,
        milliseconds:1,
        bytesWritten:0,
      }),
    });

    expect(pipeline.compile()).toEqual([
      'geometry',
      'lighting',
      'final',
    ]);
  });

  it('executes a minimal production graph', () => {
    const pipeline=createMinimalRenderPipeline();
    pipeline.resize(1280,720,.8);

    const report=pipeline.execute(1/60);

    expect(report.executedPasses).toBe(4);
    expect(report.executionOrder).toEqual([
      'prepare',
      'geometry',
      'lighting',
      'composite',
    ]);
  });

  it('rejects graph cycles', () => {
    const pipeline=new RenderPipelineR50({
      clock:()=>0,
    });

    pipeline.registerPass({
      id:'a',
      phase:'geometry',
      kind:'opaque',
      priority:'normal',
      after:['b'],
      estimatedMilliseconds:1,
      execute:()=>({
        submitted:true,
        commands:1,
        milliseconds:1,
        bytesWritten:0,
      }),
    });

    pipeline.registerPass({
      id:'b',
      phase:'geometry',
      kind:'opaque',
      priority:'normal',
      after:['a'],
      estimatedMilliseconds:1,
      execute:()=>({
        submitted:true,
        commands:1,
        milliseconds:1,
        bytesWritten:0,
      }),
    });

    expect(() => pipeline.compile()).toThrow(
      /cycle/i,
    );
  });
});
