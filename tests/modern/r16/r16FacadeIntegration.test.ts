import { describe,expect,it } from 'vitest';
import { R16RuntimeFacade } from '../../../src/3d/modern/r16/runtimeFacade.js';

describe('R16 facade integration',()=>{
  it('exposes a single deterministic production composition root',()=>{
    const facade=new R16RuntimeFacade({runtime:{seed:99}});
    facade.start();
    const state=facade.runtime.transact('ui','boot',(tx)=>{tx.set('player.health',100);});
    expect(state.ok).toBe(true);
    expect(facade.step(20)).toBeInstanceOf(Array);
    const diagnostics=facade.diagnostics();
    expect(diagnostics.runtime).toBeTruthy();
    expect(facade.started).toBe(true);
  });
  it('resets all subordinate services together',()=>{
    const facade=new R16RuntimeFacade();
    facade.start();
    facade.runtime.transact('engine','state',(tx)=>{tx.set('world.ready',true);});
    facade.reset();
    expect(facade.tick).toBe(0);
    expect(facade.started).toBe(false);
    expect(facade.interest.count()).toBe(0);
    expect(facade.migrations.audit().surfaces).toHaveLength(0);
  });
});
