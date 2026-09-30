import { describe,expect,it } from 'vitest';
import { R16CommandBus } from '../../../src/3d/modern/r16/commandBus.js';
import { R16ServiceRegistry } from '../../../src/3d/modern/r16/serviceRegistry.js';

describe('R16 command and service contracts',()=>{
  it('applies commands in priority order',()=>{
    const bus=new R16CommandBus({seed:1,maxCommandsPerTick:2});
    const seen:string[]=[];
    bus.register({topic:'a',apply:()=>{seen.push('a');return{ok:true,value:null};}});
    bus.register({topic:'b',apply:()=>{seen.push('b');return{ok:true,value:null};}});
    bus.enqueue('a',null,1,'ui',1);bus.enqueue('b',null,1,'ui',10);
    const receipts=bus.tick(1);
    expect(receipts.map(r=>r.status)).toEqual(['applied','applied']);
    expect(seen).toEqual(['b','a']);
  });
  it('fails closed on service dependency cycles',()=>{
    const registry=new R16ServiceRegistry();
    registry.register({id:'a',version:1,factory:()=>({}),dependsOn:['b'],critical:true});
    registry.register({id:'b',version:1,factory:()=>({}),dependsOn:['a'],critical:true});
    expect(registry.startAll().ok).toBe(false);
  });
});
