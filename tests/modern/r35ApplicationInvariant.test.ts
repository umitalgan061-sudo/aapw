import { describe, expect, it } from 'vitest';
import { R35CommandBus } from '../../src/3d/nextgen/r35/commandBus';
import { R35SaveCodec } from '../../src/3d/nextgen/r35/saveCodec';
import { R35ResourceBudget, createDefaultR35ResourceBudget } from '../../src/3d/nextgen/r35/resourceBudget';
import { R35EventJournal } from '../../src/3d/nextgen/r35/eventJournal';

describe('R35 application invariants', () => {
  it('rejects duplicate command registrations and preserves handler ownership', () => {
    const bus = new R35CommandBus();
    const handler = { type: 'ping', handle: async () => undefined };
    bus.register(handler);
    expect(() => bus.register(handler)).toThrow();
  });

  it('clears command dedupe state deliberately', () => {
    const bus = new R35CommandBus();
    bus.enqueue({ sequence: 1, tick: 1, entityId: 1, type: 'ping', payload: null });
    expect(bus.enqueue({ sequence: 1, tick: 1, entityId: 1, type: 'ping', payload: null })).toBe(false);
    bus.clear();
    expect(bus.pending()).toHaveLength(0);
  });

  it('keeps save envelopes framed and detects truncation', () => {
    const codec = new R35SaveCodec();
    const encoded = codec.encode({ state: 'ok' }, 4);
    expect(codec.validate(encoded).valid).toBe(true);
    const truncated = encoded.slice(0, encoded.length - 1);
    expect(codec.validate(truncated).valid).toBe(false);
  });

  it('releases resource reservations without affecting unrelated phases', () => {
    const budget: R35ResourceBudget = createDefaultR35ResourceBudget();
    const first = budget.reserve('simulation', {
      priority: 'high',
      cpuMs: 1,
      memoryBytes: 1024,
      workItems: 1,
      tick: 1,
    });
    const second = budget.reserve('render', {
      priority: 'normal',
      cpuMs: 1,
      memoryBytes: 2048,
      workItems: 1,
      tick: 1,
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(budget.release(first!.id)).toBe(true);
    expect(budget.reservationsFor('render')).toHaveLength(1);
  });

  it('compacts event history only before the selected sequence', () => {
    const journal = new R35EventJournal(8);
    const make = (tick: number) => ({
      type: 'runtime.mode' as const,
      from: 'running' as const,
      to: 'paused' as const,
      reason: 'test',
      tick,
      sequence: tick,
      timestampMs: tick,
    });
    journal.append(make(1));
    journal.append(make(2));
    journal.append(make(3));
    expect(journal.compact(3)).toBe(2);
    expect(journal.fromSequence(1)).toHaveLength(1);
  });
});
