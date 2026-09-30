import { describe, expect, it } from 'vitest';
import { R16ServiceRegistry } from '../../../src/3d/modern/r16/serviceRegistry.js';

describe('R16 service registry',()=>{
  it('propagates non-critical dependency failures without crashing the whole registry',()=>{
    const registry=new R16ServiceRegistry();
    registry.register({id:'optional',version:1,factory:()=>{throw new Error('optional fail');},dependsOn:[],critical:false});
    registry.register({id:'consumer',version:1,factory:()=>({ready:true}),dependsOn:['optional'],critical:false});
    const result=registry.startAll();
    expect(result.ok).toBe(true);
    expect(registry.state('optional')?.healthy).toBe(false);
  });
  it('starts all critical dependencies before the dependent',()=>{
    const registry=new R16ServiceRegistry();const started:string[]=[];
    registry.register({id:'world',version:1,factory:()=>{started.push('world');return{};},dependsOn:[],critical:true});
    registry.register({id:'render',version:1,factory:()=>{started.push('render');return{};},dependsOn:['world'],critical:true});
    expect(registry.startAll().ok).toBe(true);
    expect(started).toEqual(['world','render']);
  });
});
