import assert from 'node:assert/strict';
import { EventBus, XorShift32, stableHashObject } from './eventBus';
import { FixedStepClock, FrameScheduler } from './frameScheduler';
import { ModernEntityStore } from './ecs';
import { AdaptiveQualityController, FramePacingMonitor } from './adaptiveQuality';
import { SpatialHashGrid, sphereInFrustum, selectLod } from './spatialIndex';
import { MemorySaveAdapter, SaveStore } from './saveStore';
import { asAssetId, asEntityId, asSaveId } from './types';

interface Check { readonly name: string; readonly run: () => unknown | Promise<unknown>; }
const checks: Check[] = [];
const add = (name: string, run: Check['run']): void => checks.push({ name, run });

add('deterministic entity ids', () => { const a = new ModernEntityStore({seed:123}); const b = new ModernEntityStore({seed:123}); const idsA=[a.create(),a.create(),a.create()]; const idsB=[b.create(),b.create(),b.create()]; assert.deepEqual(idsA,idsB); });
add('event once semantics', () => { const bus=new EventBus(); let calls=0; bus.once('frame:begin',()=>{calls+=1;}); bus.emit('frame:begin',{frameId:1 as any,timestamp:1 as any,deltaMs:16}); bus.emit('frame:begin',{frameId:2 as any,timestamp:17 as any,deltaMs:16}); assert.equal(calls,1); });
add('deterministic PRNG fork', () => { const a=new XorShift32(99).fork(7); const b=new XorShift32(99).fork(7); assert.deepEqual(Array.from({length:32},()=>a.next()),Array.from({length:32},()=>b.next())); });
add('canonical object hashing', () => { assert.equal(stableHashObject({b:2,a:[1,2]}),stableHashObject({a:[1,2],b:2})); });
add('fixed step bounds catch-up', () => { const clock=new FixedStepClock({stepSeconds:1/60,maxCatchUpSteps:4}); let ticks=0; clock.consume(0,()=>undefined); const result=clock.consume(60_000,()=>{ticks+=1;}); assert.equal(ticks,4); assert.ok(result.droppedSeconds>0); });
add('scheduler preserves critical work', async () => { const scheduler=new FrameScheduler({budgetMs:1}); const calls:string[]=[]; scheduler.enqueue({id:'bg',priority:'background',budgetMs:5,run:()=>{calls.push('bg');}}); scheduler.enqueue({id:'critical',priority:'critical',budgetMs:.1,run:()=>{calls.push('critical');}}); scheduler.beginFrame(); await scheduler.runFrame(); assert.equal(calls[0],'critical'); });
add('adaptive quality hysteresis', () => { const quality=new AdaptiveQualityController('high'); for(let i=0;i<12;i+=1) quality.observe({cpuMs:24,gpuMs:24,timestampMs:i*100}); assert.equal(quality.state().tier,'medium'); });
add('frame pacing tail latency', () => { const monitor=new FramePacingMonitor(120); for(let i=0;i<100;i+=1) monitor.add({timestampMs:i*16.6,deltaMs:16.6}); monitor.add({timestampMs:2000,deltaMs:55}); assert.ok(monitor.stats().p95Ms>=16.6); assert.ok(monitor.stats().jankRatio>0); });
add('spatial grid deterministic nearest', () => { const grid=new SpatialHashGrid(10); grid.insert({id:asEntityId('a'),position:{x:0,y:0,z:0},radius:1}); grid.insert({id:asEntityId('b'),position:{x:3,y:0,z:0},radius:1}); grid.insert({id:asEntityId('c'),position:{x:40,y:0,z:0},radius:1}); assert.deepEqual(grid.nearest({x:2,y:0,z:0},10,2).map(h=>h.id),[asEntityId('a'),asEntityId('b')]); assert.deepEqual(grid.validate(),{valid:true,duplicates:0}); });
add('snapshot component isolation', () => { const store=new ModernEntityStore({seed:4}); const id=store.create({components:{inventory:{items:['iron']}}}); const value=store.getComponent<{items:string[]}>(id,'inventory'); value?.items.push('gold'); assert.deepEqual(store.getComponent<{items:string[]}>(id,'inventory')?.items,['iron']); });
add('frustum and lod helpers', () => { assert.equal(sphereInFrustum({center:{x:0,y:0,z:0},radius:1},[{normal:{x:1,y:0,z:0},constant:1}]),true); assert.equal(selectLod(55,[{maxDistance:25,level:0,updateHz:60},{maxDistance:100,level:1,updateHz:20}])?.level,1); });
add('save integrity envelope', async () => { const adapter=new MemorySaveAdapter(); const store=new SaveStore({namespace:'test',schemaVersion:1,maxBytes:4096,adapter}); const id=asSaveId('slot'); const written=await store.write(id,{hp:100}); assert.equal(written.ok,true); const loaded=await store.read(id); assert.equal(loaded.ok,true); const raw=await adapter.get(store.key(id)); assert.ok(raw); await adapter.set(store.key(id),raw!.replace('100','99')); assert.equal((await store.read(id)).ok,false); });
add('branded asset id boundary', () => { assert.equal(typeof asAssetId('terrain/alpine'),'string'); });

export const runAcceptance = async (): Promise<{passed:number;failed:number;failures:readonly string[]}> => { let passed=0; let failed=0; const failures:string[]=[]; for(const check of checks){try{await check.run();passed+=1;}catch(error){failed+=1;failures.push(`${check.name}: ${error instanceof Error ? error.message : String(error)}`);}} return {passed,failed,failures}; };
if(import.meta.url===`file://${process.argv[1]}`){const report=await runAcceptance(); console.log(JSON.stringify(report,null,2)); if(report.failed) process.exitCode=1;}
