import { describe, expect, it } from 'vitest';
import { createWorkerMessage, validateWorkerMessage, WorkerRequestTable } from '../../src/3d/modern/nextgen/workerProtocol.ts';
import { combineInput, neutralInput } from '../../src/3d/modern/nextgen/input.ts';
import { tickValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen worker and input contracts', () => {
  it('creates and validates signed worker envelopes', () => {
    const message = createWorkerMessage('simulation', 'req-1', { tick: 10, op: 'step' });
    expect(validateWorkerMessage(message)).toBe(true);
    expect(validateWorkerMessage({ ...message, checksum: message.checksum + 1 })).toBe(false);
  });

  it('rejects oversized or malformed worker requests', () => {
    expect(() => createWorkerMessage('simulation', 'bad id!', { ok: true })).toThrow(/request id/i);
    const message = createWorkerMessage('asset', 'req-2', { value: 'safe' });
    expect(validateWorkerMessage({ ...message, version: 99 })).toBe(false);
  });

  it('tracks worker request promises and expires stale requests', async () => {
    const table = new WorkerRequestTable<string>(100);
    const message = createWorkerMessage('streaming', 'req-3', { chunk: '0:0' });
    const promise = table.register(message);
    expect(table.size).toBe(1);
    expect(table.resolve('req-3', 'ok')).toBe(true);
    await expect(promise).resolves.toBe('ok');
    expect(table.size).toBe(0);
  });

  it('combines input without exceeding normalized movement bounds', () => {
    const a = { ...neutralInput(tickValue(4)), move: { x: 1, y: 0 } };
    const b = { ...neutralInput(tickValue(4)), move: { x: 1, y: 1 }, buttons: 4 };
    const combined = combineInput(a, b, tickValue(4));
    expect(Math.hypot(combined.move.x, combined.move.y)).toBeCloseTo(1, 5);
    expect(combined.buttons).toBe(4);
  });
});
