import { describe, expect, it } from 'vitest';
import {
  DeterministicRateLimiter,
  PayloadValidator,
  SecurityAuditLog,
  assertSafeUrl,
  createCapabilityAuthority,
  sanitizeIdentifier,
  sanitizeText,
} from '../../../src/3d/modern/r50/securityBoundary.ts';

describe('R50 security boundary', () => {
  it('enforces deterministic token limits', () => {
    const limiter=new DeterministicRateLimiter({
      capacity:2,
      refillPerTick:1,
    });

    expect(limiter.consume('player',1).allowed).toBe(true);
    expect(limiter.consume('player',1).allowed).toBe(true);
    expect(limiter.consume('player',1).allowed).toBe(false);
    expect(limiter.consume('player',2).allowed).toBe(true);
  });

  it('validates bounded hostile payloads', () => {
    const validator=new PayloadValidator([
      {
        path:'name',
        type:'string',
        required:true,
        maxLength:16,
      },
      {
        path:'health',
        type:'number',
        required:true,
        minimum:0,
        maximum:100,
      },
    ]);

    expect(validator.validate({
      name:'hero',
      health:80,
    }).valid).toBe(true);

    expect(validator.validate({
      name:'this-name-is-far-too-long',
      health:101,
    }).valid).toBe(false);
  });

  it('sanitizes text and identifiers', () => {
    expect(sanitizeText('<hello>')).toBe('hello');
    expect(sanitizeIdentifier('hero name/1')).toBe('hero-name-1');
  });

  it('rejects unsafe URL schemes', () => {
    expect(() => assertSafeUrl('javascript:alert(1)')).toThrow();
    expect(assertSafeUrl('/assets/a.glb')).toBe('/assets/a.glb');
    expect(assertSafeUrl('https://example.com/a')).toContain('https://');
  });

  it('issues and verifies bounded capability tokens', () => {
    const authority=createCapabilityAuthority('secret');
    const token=authority.issue('player','inventory',10,5);

    expect(authority.verify(token,'player','inventory',12)).toBe(true);
    expect(authority.verify(token,'other','inventory',12)).toBe(false);
    expect(authority.verify(token,'player','inventory',16)).toBe(false);
  });

  it('keeps a bounded audit log', () => {
    const audit=new SecurityAuditLog(2);

    audit.record({
      tick:1,
      action:'login',
      subject:'player',
      allowed:true,
    });

    audit.record({
      tick:2,
      action:'packet',
      subject:'player',
      allowed:false,
      reason:'size',
    });

    audit.record({
      tick:3,
      action:'command',
      subject:'player',
      allowed:false,
      reason:'rate',
    });

    expect(audit.entries()).toHaveLength(2);
    expect(audit.failures()).toHaveLength(2);
  });
});
