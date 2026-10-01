
import { describe, expect, it } from 'vitest';
import { InventoryRuntimeR35, QuestRuntimeR35, WorldSimulationR35, stableHash } from '../../../src/3d/modern/r35/index';

describe('R35 world simulation',()=>{
 it('keeps deterministic state stable for identical inputs',()=>{
  const run=()=>{const w=new WorldSimulationR35();w.setPlayerPosition({x:0,y:0,z:0});w.addAgent({id:'wolf',position:{x:4,y:0,z:3},disposition:'hostile',needs:{safety:.7}});w.addAgent({id:'deer',position:{x:10,y:0,z:0}});for(let i=0;i<40;i++)w.step();return w.digest();};
  expect(run()).toBe(run());
 });
 it('indexes radius queries and enforces entity bounds',()=>{
  const w=new WorldSimulationR35({maxEntities:2,cellSize:8});expect(w.addAgent({id:'a',position:{x:0,y:0,z:0}})).toBe(true);expect(w.addAgent({id:'b',position:{x:7,y:0,z:0}})).toBe(true);expect(w.addAgent({id:'c',position:{x:1,y:0,z:0}})).toBe(false);expect(w.queryRadius({x:0,y:0,z:0},8)).toHaveLength(2);
 });
});
describe('R35 quests and inventory',()=>{
 it('progresses counter and ordered objectives',()=>{
  const q=new QuestRuntimeR35();q.register({id:'hunt',version:1,objectives:[{id:'kills',kind:'counter',target:'kills',required:2,order:1},{id:'flag',kind:'flag',target:'returned',required:1,order:2}]});q.addCounter('kills',2);expect(q.state('hunt')?.status).toBe('active');q.setFlag('returned',true);q.addCounter('noop',1);expect(q.state('hunt')?.status).toBe('complete');
 });
 it('respects stack limits and equipment slots',()=>{
  const inv=new InventoryRuntimeR35(2);inv.registerItem({id:'sword',version:1,stackLimit:1,weight:4,value:10,tags:['weapon'],slots:['mainHand']});expect(inv.add('sword',1).ok).toBe(true);expect(inv.add('sword',1).value?.remaining).toBe(1);expect(inv.equip('mainHand','sword').ok).toBe(true);expect(inv.weight()).toBe(4);
 });
});
it('hash is stable for object key order',()=>expect(stableHash({b:2,a:1})).toBe(stableHash({a:1,b:2})));
