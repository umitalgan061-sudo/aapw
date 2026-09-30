import { describe,expect,it } from 'vitest';
import { createR16Runtime } from '../../../src/3d/modern/r16/index.js';

describe('R16 runtime platform',()=>{
  it('boots and commits transactional state',()=>{
    const runtime=createR16Runtime({seed:42});runtime.start();
    const result=runtime.transact('ui','initial player state',tx=>{tx.set('player.health',100);tx.set('player.position.x',10);tx.set('player.position.z',-4);});
    expect(result.ok).toBe(true);expect(runtime.state.get('player.health')).toBe(100);
    const frame=runtime.frame();expect(frame.tick).toBe(1);expect(frame.deltaMs).toBeCloseTo(16.6666666667,9);expect(runtime.diagnostics().version).toBe(16);
  });
  it('produces deterministic replay digests',()=>{const result=createR16Runtime({seed:7}).verifyDeterministicReplay(64);expect(result.ok).toBe(true);});
  it('does not leak mutable diagnostics',()=>{const runtime=createR16Runtime();runtime.start();const d=runtime.diagnostics();expect(Object.isFrozen(d)).toBe(true);});
});
