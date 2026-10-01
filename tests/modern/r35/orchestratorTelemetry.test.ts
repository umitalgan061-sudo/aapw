
import { describe, expect, it } from 'vitest';
import { RuntimeOrchestratorR35, TelemetryRuntimeR35 } from '../../../src/3d/modern/r35/index';
describe('R35 orchestrator',()=>{
 it('advances world and reports health',()=>{
  const r=new RuntimeOrchestratorR35({inventoryCapacity:8});r.addAgent({id:'a',position:{x:0,y:0,z:0}});r.addAgent({id:'b',position:{x:20,y:0,z:0}});r.step(12);const h=r.health();expect(h.tick).toBe(12);expect(h.entities).toBe(2);expect(h.digest.length).toBe(16);
 });
 it('pause blocks simulation until resumed',()=>{
  const r=new RuntimeOrchestratorR35();r.addAgent({id:'a',position:{x:0,y:0,z:0}});r.pause();r.step(5);expect(r.health().tick).toBe(0);r.start();r.step(5);expect(r.health().tick).toBe(5);
 });
});
describe('R35 telemetry',()=>{
 it('detects a sustained outlier',()=>{
  const t=new TelemetryRuntimeR35();for(let i=0;i<12;i++)t.record('frame.ms',10,i);t.record('frame.ms',100,12);expect(t.anomalies(12).some(a=>a.metric==='frame.ms')).toBe(true);
 });
});
