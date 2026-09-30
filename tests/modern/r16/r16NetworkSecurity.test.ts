import { describe, expect, it } from 'vitest';
import { R16NetworkSecurityBoundary } from '../../../src/3d/modern/r16/networkSecurity.js';

describe('R16 network security', () => {
  it('accepts a correctly checksummed envelope', () => {
    const security=new R16NetworkSecurityBoundary();
    const envelope=security.createEnvelope('command','peer-1',1,4,'network','move',{x:1},1000);
    expect(security.validate(envelope,4).ok).toBe(true);
    expect(security.stats().accepted).toBe(1);
  });

  it('rejects tampering and replay', () => {
    const security=new R16NetworkSecurityBoundary();
    const envelope=security.createEnvelope('command','peer-1',1,4,'network','move',{x:1},1000);
    expect(security.validate({...envelope,payload:{x:99}},4).ok).toBe(false);
    expect(security.validate(envelope,4).ok).toBe(true);
    expect(security.validate(envelope,4).ok).toBe(false);
    expect(security.stats().replayRejected).toBeGreaterThan(0);
  });

  it('enforces per-peer message budgets', () => {
    security.registerPolicy({peerId:'p',maxBytesPerTick:50000,maxMessagesPerTick:1,maxPayloadBytes:4096,maxFutureTicks:1,replayWindowTicks:10,allowKinds:['command']});
    const first=security.createEnvelope('command','p',1,2,'network','a',{x:1},10);
    const second=security.createEnvelope('command','p',2,2,'network','b',{x:2},11);
    expect(security.validate(first,2).ok).toBe(true);
    expect(security.validate(second,2).ok).toBe(false);
  });
});
