import { describe, expect, it } from 'vitest';
import { RuntimeVirtualConsole } from '../../../src/3d/modern/r28/virtualConsole.ts';

describe('R28 virtual console', () => {
  it('keeps bounded, ordered operational entries', () => {
    const consoleBuffer = new RuntimeVirtualConsole(3);
    consoleBuffer.info('a', 1);
    consoleBuffer.warn('b', 2);
    consoleBuffer.error('c', 3);
    consoleBuffer.debug('d', 4);
    expect(consoleBuffer.recent()).toHaveLength(3);
    expect(consoleBuffer.recent()[0]?.sequence).toBe(2);
    expect(consoleBuffer.recent('error')[0]?.message).toBe('c');
    consoleBuffer.clear();
    expect(consoleBuffer.recent()).toEqual([]);
  });
});
