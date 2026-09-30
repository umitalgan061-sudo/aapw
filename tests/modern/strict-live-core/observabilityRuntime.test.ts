import { describe, expect, it } from 'vitest';
import { StrictRuntimeTelemetry } from '../../../src/3d/strict/runtimeTelemetry.ts';
import { StrictRecoveryRuntime } from '../../../src/3d/strict/recoveryRuntime.ts';

describe('observability runtime', () => {
  it('retains bounded counters, gauges and histograms', () => {
    const telemetry = new StrictRuntimeTelemetry({
      maxSamples: 8, maxAlarms: 4, histogramCapacity: 4, maxTraceDurationMs: 1000, maxTagCount: 12,
    });
    for(let i=0;i<20;i+=1) telemetry.increment('frames');
    telemetry.gauge('memory',42); telemetry.observe('frame',16); telemetry.observe('frame',18); telemetry.trace('render',40);
    const snapshot=telemetry.snapshot();
    expect(snapshot.counters.frames).toBe(20);
    const histogram=snapshot.histograms.frame;
    expect(histogram).toBeDefined();
    if(!histogram)return;
    expect(histogram.count).toBe(2); expect(histogram.p95).toBeGreaterThanOrEqual(16); expect(snapshot.retainedSamples).toBeLessThanOrEqual(8);
  });
  it('raises bounded budget alarms', () => {
    const telemetry=new StrictRuntimeTelemetry({maxSamples:16,maxAlarms:2,histogramCapacity:8,maxTraceDurationMs:1000,maxTagCount:12});
    for(let i=0;i<10;i+=1)telemetry.recordBudget({simulationMs:10,renderMs:20,inputMs:0,assetMs:0,telemetryMs:0},i,{simulationMs:5,renderMs:8,inputMs:1,assetMs:1,telemetryMs:1});
    expect(telemetry.alarms().length).toBe(2);
  });
  it('produces deterministic digests', () => {
    const a=new StrictRuntimeTelemetry(); const b=new StrictRuntimeTelemetry(); a.increment('x',1); b.increment('x',1); expect(a.snapshot().digest).toBe(b.snapshot().digest);
  });
  it('chooses fallback renderer for renderer loss', () => {
    const recovery=new StrictRecoveryRuntime(); const result=recovery.trigger('renderer-device-lost',1); expect(result.ok).toBe(true); if(!result.ok)return; expect(result.value).toBe('fallback-renderer'); expect(recovery.snapshot().phase).toBe('recovering');
  });
  it('uses cooldown to stop recovery storms', () => { const recovery=new StrictRecoveryRuntime(); expect(recovery.trigger('asset-failure',1).ok).toBe(true); expect(recovery.trigger('asset-failure',2).ok).toBe(false); });
  it('returns to healthy after stable ticks', () => { const recovery=new StrictRecoveryRuntime({maxAttempts:5,cooldownTicks:0,resetAfterStableTicks:3,allowRendererFallback:true,allowCacheFlush:true}); recovery.trigger('memory-pressure',1); recovery.complete(true,2); recovery.tick(true); recovery.tick(true); recovery.tick(true); expect(recovery.snapshot().phase).toBe('healthy'); expect(recovery.snapshot().attempts).toBe(0); });
});