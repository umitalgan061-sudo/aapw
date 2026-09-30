import { describe, expect, it } from 'vitest';
import { R16NetworkCoordinator } from '../../../src/3d/modern/r16/networkCoordinator.js';

describe('R16 network coordinator',()=>{
  it('connects, sends and receives typed envelopes',()=>{
    const coordinator=new R16NetworkCoordinator();
    expect(coordinator.connect('peer',1).ok).toBe(true);
    const sent=coordinator.send('peer','command','move',{x:1},2,'network',{now:()=>100,send:()=>({ok:true,value:undefined})});
    expect(sent.ok).toBe(true);
    if(!sent.ok)return;
    expect(coordinator.receive(sent.value,2).ok).toBe(true);
    expect(coordinator.sessions()[0]?.received).toBe(1);
  });
  it('rejects receives from disconnected peers',()=>{
    const coordinator=new R16NetworkCoordinator();coordinator.connect('peer',1);coordinator.disconnect('peer',2);
    const envelope=new R16NetworkCoordinator().security.createEnvelope('event','peer',1,2,'network','x',{},20);
    expect(coordinator.receive(envelope,2).ok).toBe(false);
  });
});
