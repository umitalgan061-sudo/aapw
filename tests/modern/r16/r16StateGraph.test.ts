import { describe,expect,it } from 'vitest';
import { R16StateGraph } from '../../../src/3d/modern/r16/stateGraph.js';

describe('R16 state graph',()=>{
  it('sorts mutations deterministically',()=>{
    const graph=new R16StateGraph({maxStateNodes:128});const tx=graph.begin(9,'network','remote-sync');
    tx.set('player.z',2);tx.set('player.x',1);tx.set('player.health',80);const result=tx.commit();expect(result.ok).toBe(true);if(!result.ok)return;
    expect(result.value.mutations.map(m=>m.path)).toEqual(['player.health','player.x','player.z']);expect(graph.get('player.health')).toBe(80);
  });
  it('closes transactions after commit',()=>{
    const graph=new R16StateGraph({maxStateNodes:128});const tx=graph.begin(1,'ui','close');tx.set('a',1);expect(tx.commit().ok).toBe(true);expect(tx.set('b',2).ok).toBe(false);
  });
  it('rejects pathological depth',()=>{
    const graph=new R16StateGraph({maxStateNodes:128});const tx=graph.begin(1,'network','depth');const result=tx.set('a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y',1);expect(result.ok).toBe(false);
  });
});
