import { describe, expect, it } from 'vitest';
import {
  WorldRuntime,
  WorldChunkSource,
} from '../../../src/3d/modern/r50/worldRuntime.ts';

describe('R50 world runtime', () => {
  const createSource = (): WorldChunkSource => ({
    load: async (coordinate) => ({
      key:String(coordinate.x)+':'+String(coordinate.z),
      coordinate,
      sizeMeters:256,
      revision:1,
      cells:[
        {
          x:0,
          z:0,
          height:10,
          biome:'temperate',
          water:false,
          loaded:true,
        },
      ],
    }),
  });

  it('normalizes world and chunk coordinates', () => {
    const runtime=new WorldRuntime(
      createSource(),
      {
        chunkSizeMeters:256,
        viewDistance:2,
        maxResidentChunks:16,
      },
    );

    expect(runtime.worldToChunk(255,511)).toEqual({
      x:0,
      z:1,
    });

    expect(runtime.chunkToWorld({
      x:2,
      z:-1,
    })).toEqual({
      x:512,
      z:-256,
    });
  });

  it('deduplicates concurrent chunk loads', async () => {
    let loads=0;

    const runtime=new WorldRuntime(
      {
        load:async (coordinate)=>{
          loads+=1;
          return {
            key:String(coordinate.x)+':'+String(coordinate.z),
            coordinate,
            sizeMeters:256,
            revision:2,
            cells:[],
          };
        },
      },
      {
        chunkSizeMeters:256,
        viewDistance:1,
        maxResidentChunks:8,
      },
    );

    const [a,b]=await Promise.all([
      runtime.ensure({x:0,z:0},1),
      runtime.ensure({x:0,z:0},1),
    ]);

    expect(a).toEqual(b);
    expect(loads).toBe(1);
  });

  it('prefetches nearest chunks first and evicts cold chunks', async () => {
    const runtime=new WorldRuntime(
      createSource(),
      {
        chunkSizeMeters:256,
        viewDistance:1,
        maxResidentChunks:3,
      },
    );

    const chunks=await runtime.prefetchSquare(
      {x:0,z:0},
      1,
    );

    expect(chunks.length).toBe(9);
    expect(runtime.stats().residentChunks).toBe(9);

    const removed=runtime.collect(2);

    expect(removed.length).toBe(6);
    expect(runtime.stats().residentChunks).toBe(3);
  });

  it('produces deterministic manifests', async () => {
    const a=new WorldRuntime(createSource(),{
      chunkSizeMeters:256,
      viewDistance:1,
      maxResidentChunks:16,
    });

    const b=new WorldRuntime(createSource(),{
      chunkSizeMeters:256,
      viewDistance:1,
      maxResidentChunks:16,
    });

    await a.ensure({x:1,z:2},3);
    await b.ensure({x:1,z:2},3);

    expect(a.manifestDigest()).toBe(
      b.manifestDigest(),
    );
  });
});
