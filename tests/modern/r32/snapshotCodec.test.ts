import { describe, expect, it } from 'vitest';
import {
  JsonSnapshotCodec,
  SnapshotHistory,
} from '../../../src/3d/modern/r32/snapshotCodec.ts';

describe('R32 snapshot codec', () => {
  it('round trips typed payloads with integrity metadata', () => {
    const codec=new JsonSnapshotCodec();
    const encoded=codec.encode({
      player:{
        health:100,
        position:{x:1,y:2,z:3},
      },
    });

    const decoded=codec.decode<{
      player:{
        health:number;
        position:{x:number;y:number;z:number};
      };
    }>(encoded.encoded);

    expect(decoded.payload).toEqual({
      player:{
        health:100,
        position:{x:1,y:2,z:3},
      },
    });

    expect(decoded.header.checksum).toBe(
      encoded.header.checksum,
    );
  });

  it('rejects corrupted snapshot payloads', () => {
    const codec=new JsonSnapshotCodec();
    const encoded=codec.encode({
      value:42,
    });

    const raw=atob(encoded.encoded);
    const modified=raw.replace('42','43');
    const broken=btoa(modified);

    expect(() => codec.decode(broken)).toThrow(
      /checksum/i,
    );
  });

  it('keeps history bounded and addressable by tick', () => {
    const history=new SnapshotHistory(
      new JsonSnapshotCodec(),
      3,
    );

    history.push(1,{value:1});
    history.push(2,{value:2});
    history.push(3,{value:3});
    history.push(4,{value:4});

    expect(history.values()).toHaveLength(3);
    expect(history.beforeOrAt(2)?.tick).toBe(2);
    expect(history.latest()?.tick).toBe(4);
  });
});
