import { describe, expect, it } from 'vitest';
import { R16ServiceRegistry } from '../../../src/3d/modern/r16/serviceRegistry.js';
import { R16RecoveryCoordinator } from '../../../src/3d/modern/r16/recovery.js';

describe('R16 services and recovery', () => {
  it('starts dependency-ordered services', () => {
    const registry=new R16ServiceRegistry();
    const order:string[]=[];
    registry.register({id:'a',version:1,factory:()=>{order.push('a');return{};},dependsOn:[],critical:true});
    registry.register({id:'b',version:1,factory:()=>{order.push('b');return{};},dependsOn:['a'],critical:true});
    expect(registry.startAll().ok).toBe(true);
    expect(order).toEqual(['a','b']);
  });

  it('detects recovery cooldown and phase progression', () => {
    const recovery=new R16RecoveryCoordinator(3);
    expect(recovery.request({domain:'render',reason:'gpu-reset',maxAttempts:3,cooldownTicks:5},10).ok).toBe(true);
    expect(recovery.request({domain:'render',reason:'retry',maxAttempts:3,cooldownTicks:5},12).ok).toBe(false);
    expect(recovery.advance('render',15).ok).toBe(true);
    expect(recovery.status('render').phase).toBe('quiesce');
  });
});
