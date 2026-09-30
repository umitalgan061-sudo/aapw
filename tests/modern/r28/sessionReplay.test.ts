import { describe, expect, it } from 'vitest';
import { InputReplayPlayer, InputReplayRecorder } from '../../../src/3d/modern/r28/inputReplay.ts';
import { LocalLoopbackTransport, RuntimeSession } from '../../../src/3d/modern/r28/session.ts';
import { zeroInputFrame } from '../../../src/3d/modern/r27/contracts.ts';

describe('R28 session and input replay', () => {
  it('records and verifies deterministic input clips', () => {
    const recorder = new InputReplayRecorder(60, 0);
    recorder.start();
    recorder.push({
      ...zeroInputFrame(1),
      move: { x: 1, y: 0 },
      buttons: ['sprint'],
      analog: { throttle: 0.5 },
    });
    recorder.push({
      ...zeroInputFrame(2),
      move: { x: 0, y: -1 },
      buttons: ['jump'],
    });
    const clip = recorder.stop();
    expect(clip.frames).toHaveLength(2);

    const player = new InputReplayPlayer(clip);
    expect(player.next()?.tick).toBe(1);
    player.seek(2);
    expect(player.next()?.buttons).toEqual(['jump']);
    expect(player.remaining()).toBe(0);
  });

  it('rejects mutated replay frames', () => {
    const recorder = new InputReplayRecorder();
    recorder.start();
    recorder.push(zeroInputFrame(1));
    const clip = recorder.stop();
    const bad = {
      ...clip,
      checksum: '00000000',
    };
    expect(() => new InputReplayPlayer(bad)).toThrow(/checksum/i);
  });

  it('connects a runtime session to a loopback transport', async () => {
    const transport = new LocalLoopbackTransport();
    const session = new RuntimeSession();
    const state = await session.connect(transport, 'test-session');
    expect(state.connected).toBe(true);
    expect(state.sessionId).toBe('test-session');

    expect(session.sendInput({ ...zeroInputFrame(0), buttons: ['jump'] })).toBe(true);
    session.receiveEvent({
      type: 'incident',
      code: 'TEST',
      severity: 'info',
      detail: 'ok',
    });
    expect(session.state().error).toBeNull();
    session.disconnect();
    expect(session.state().connected).toBe(false);
  });
});
