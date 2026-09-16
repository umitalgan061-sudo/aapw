import { describe, expect, it } from 'vitest';
import { InputCommandBufferV3 } from '../../src/3d/nextgen/inputCommandBufferV3';
import { RuntimeCommandJournalV3 } from '../../src/3d/nextgen/runtimeCommandJournalV3';

describe('input command buffer', () => {
  it('orders commands and rejects duplicates', () => {
    const buffer = new InputCommandBufferV3(8);
    expect(buffer.push({ tick: 2, sequence: 2, action: 'jump', valueX: 0, valueY: 0, pressed: true })).toBe(true);
    expect(buffer.push({ tick: 1, sequence: 1, action: 'move', valueX: 2, valueY: -2, pressed: true })).toBe(true);
    expect(buffer.push({ tick: 1, sequence: 1, action: 'move', valueX: 0, valueY: 0, pressed: false })).toBe(false);
    expect(buffer.drainThrough(1)[0]?.valueX).toBe(1);
  });
});

describe('runtime command journal', () => {
  it('creates stable cursors and checkpoints', () => {
    const journal = new RuntimeCommandJournalV3(64);
    journal.append({ tick: 1, entityId: 3, type: 'move', payload: { z: 2, x: 1 } });
    journal.append({ tick: 1, entityId: 3, type: 'jump', payload: { height: 3 } });
    const checkpoint = journal.checkpoint(1);
    expect(checkpoint.commandOffset).toBe(2);
    const cursor = journal.cursorAt(1, 1);
    expect(journal.commandsFrom(cursor)).toHaveLength(1);
    expect(journal.nearestCheckpoint(2)?.tick).toBe(1);
  });
});
