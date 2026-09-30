import { describe, expect, it } from 'vitest';
import { AapwRuntimeApi, createAapwRuntimeApi } from '../../../src/3d/modern/r28/runtimeApi.ts';

describe('R28 public runtime API', () => {
  it('creates a public runtime facade with centralized manifest', () => {
    const api = createAapwRuntimeApi({ tickRate: 30 });
    expect(api.manifest.version).toBe('r28');
    expect(api.manifest.runtime.tickRate).toBe(30);
    expect(api.host.runtime).toBeDefined();
    api.dispose();
  });

  it('steps through the public health-report boundary', () => {
    const api = new AapwRuntimeApi();
    const report = api.step(1 / 60);
    expect(report.tick).toBeGreaterThanOrEqual(0);
    expect(report.status).toMatch(/healthy|degraded|critical/);
    api.dispose();
  });
});
