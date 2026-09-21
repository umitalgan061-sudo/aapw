import { describe, expect, it } from 'vitest';
import type { ReplayRecording } from '../../src/3d/modern/runtimeContracts';
import { checksum } from '../../src/3d/modern/deterministic';
import { decodeReplay, encodeReplay, mergeReplay, replayReport, splitReplay } from '../../src/3d/modern/replayCodec';

function recording(): ReplayRecording {
  const header = { schema: 'aapw.replay' as const, version: 2, seed: 9, fixedStepMs: 16.666, createdAt: 100 as never, runtimeVersion: 'test' };
  const frames = Array.from({ length: 4 }, (_, index) => ({
    frame: (index + 1) as never,
    timestamp: (100 + index * 16) as never,
    actions: [{ action: 'move.forward' as const, source: 'keyboard' as const, phase: 'value' as const, value: 0.5, timestamp: (100 + index * 16) as never, frame: (index + 1) as never, repeat: false }],
  }));
  const base = { header, frames };
  return { ...base, checksum: checksum(base) };
}

describe('replayCodec', () => {
  it('round-trips replay frames without trailing bytes', () => {
    const source = recording();
    const bytes = encodeReplay(source);
    const decoded = decodeReplay(bytes, { runtimeVersion: 'test' });
    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.value.frames.length).toBe(4);
    expect(decoded.ok && decoded.value.frames[2]?.actions[0]?.value).toBeCloseTo(0.5, 2);
  });

  it('reports a compact binary size and validation status', () => {
    const report = replayReport(recording());
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.actions).toBe(4);
    expect(report.valid).toBe(true);
  });

  it('splits and merges ordered segments with checksums', () => {
    const source = recording();
    const segments = splitReplay(source, 2);
    expect(segments).toHaveLength(2);
    const merged = mergeReplay(source.header, segments);
    expect(merged.ok).toBe(true);
    expect(merged.ok && merged.value.frames.map((frame) => Number(frame.frame))).toEqual([1, 2, 3, 4]);
  });

  it('rejects tampered segments', () => {
    const source = recording();
    const segment = splitReplay(source, 2)[0]!;
    const tampered = { ...segment, checksum: 'tampered' };
    const result = mergeReplay(source.header, [tampered]);
    expect(result.ok).toBe(false);
  });
});
