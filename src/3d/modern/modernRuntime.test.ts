import assert from 'node:assert/strict';
import { EventBus, XorShift32, stableHashObject } from './eventBus';
import { FixedStepClock, FrameScheduler } from './frameScheduler';
import { ModernEntityStore } from './ecs';
import { AdaptiveQualityController, FramePacingMonitor } from './adaptiveQuality';
import { SpatialHashGrid, sphereInFrustum, selectLod } from './spatialIndex';
import { MemorySaveAdapter, SaveStore } from './saveStore';
import { asAssetId, asEntityId, asSaveId } from './types';

interface Check { readonly name: string; readonly run: () => unknown | Promise<unknown>; }
const tests: Check[]=[];
const test=(name:string,run:Check['run']):void=>tests.push({name,run});
class FakeClock{public nowMs=0;public now=()=>this.nowMs;public advance(ms:number):void{this.nowMs+=ms;}}

test('event delivery is mutation safe',()=>{const bus=new EventBus();const calls:string[]=[];const second=bus.on('phase:change',()=>{calls.push('second');});bus.once('phase:change',()=>{calls.push('once');second.dispose();});bus.on('phase:change',()=>{calls.push('third');});bus.emit('phase:change',{from:'boot',to:'loading'});bus.emit('phase:change',{from:'loading',to:'ready'});assert.deepEqual(calls,['once','second','third','third']);});
test('random streams are deterministic',()=>{const a=new XorShift32(1234);const b=new XorShift32(1234);assert.deepEqual(Array.from({length:64},()=>a.next()),Array.from({length:64},()=>b.next()));assert.equal(stableHashObject({z:1,a:2}),stableHashObject({a:2,z:1}));});
test('fixed-step clock caps catch-up',()=>{const clock=new FixedStepClock({stepSeconds:1/60,maxCatchUpSteps:3});let steps=0;clock.consume(0,()=>undefined);const result=clock.consume(1000,()=>{steps+=1;});assert.equal(steps,3);assert.ok(result.droppedSeconds>0);});
test('scheduler preserves critical work',async()=>{const fake=new FakeClock();const scheduler=new FrameScheduler({budgetMs:1,maxTasksPerFrame:8,now:fake.now});const calls:string[]=[];scheduler.enqueue({id:'bg',priority:'background',budgetMs:5,run:()=>{calls.push('bg');}});scheduler.enqueue({id:'critical',priority:'critical',budgetMs:.1,run:()=>{calls.push('critical');}});scheduler.beginFrame();await scheduler.runFrame();assert.equal(calls[0],'critical');});
test('entity snapshots are sorted and isolated',()=>{const store=new ModernEntityStore({seed:7});const first=store.create({tags:['b','a'],components:{health:{value:100}}});const second=store.create({components:{health:{value:50}}});const snapshot=store.snapshot();assert.equal(snapshot.entities.length,2);assert.ok(snapshot.entities[0]!.id.localeCompare(snapshot.entities[1]!.id)<=0);const value=store.getComponent<{value:number}>(first,'health');assert.equal(value?.value,100);if(value)value.value=1;assert.equal(store.getComponent<{value:number}>(first,'health')?.value,100);assert.equal(store.remove(second),true);});
test('adaptive quality uses hysteresis',()=>{const controller=new AdaptiveQualityController('high');for(let i=0;i<12;i+=1)controller.observe({cpuMs:24,gpuMs:24,timestampMs:i*100});assert.equal(controller.state().tier,'medium');});
test('frame pacing reports tail latency',()=>{const monitor=new FramePacingMonitor(120);for(let i=0;i<100;i+=1)monitor.add({timestampMs:i*16.6,deltaMs:16.6});monitor.add({timestampMs:2000,deltaMs:55});assert.ok(monitor.stats().p95Ms>=16.6);assert.ok(monitor.stats().jankRatio>0);});
test('spatial grid finds nearest deterministically',()=>{const grid=new SpatialHashGrid(10);grid.insert({id:asEntityId('a'),position:{x:0,y:0,z:0},radius:1});grid.insert({id:asEntityId('b'),position:{x:3,y:0,z:0},radius:1});grid.insert({id:asEntityId('c'),position:{x:40,y:0,z:0},radius:1});assert.deepEqual(grid.nearest({x:2,y:0,z:0},10,2).map(hit=>hit.id),[asEntityId('a'),asEntityId('b')]);});
test('frustum and lod helpers',()=>{assert.equal(sphereInFrustum({center:{x:0,y:0,z:0},radius:1},[{normal:{x:1,y:0,z:0},constant:1}]),true);assert.equal(sphereInFrustum({center:{x:-10,y:0,z:0},radius:1},[{normal:{x:1,y:0,z:0},constant:1}]),false);assert.equal(selectLod(55,[{maxDistance:25,level:0,updateHz:60},{maxDistance:100,level:1,updateHz:20}])?.level,1);});
test('save checksum round-trip',async()=>{const adapter=new MemorySaveAdapter();const store=new SaveStore({namespace:'test',schemaVersion:1,maxBytes:4096,adapter});const id=asSaveId('slot-a');assert.equal((await store.write(id,{player:{hp:100}})).ok,true);const loaded=await store.read(id);assert.equal(loaded.ok,true);const raw=await adapter.get(store.key(id));assert.ok(raw);await adapter.set(store.key(id),raw!.replace('100','99'));assert.equal((await store.read(id)).ok,false);});
test('asset id branding boundary',()=>{assert.equal(typeof asAssetId('terrain/alpine'),'string');});
export const runModernRuntimeTests=async():Promise<{passed:number;failed:number;failures:readonly string[]}=>{let passed=0,failed=0;const failures:string[]=[];for(const entry of tests){try{await entry.run();passed+=1;}catch(error){failed+=1;failures.push(`${entry.name}: ${error instanceof Error?error.message:String(error)}`);}}return{passed,failed,failures};};
if(import.meta.url===`file://${process.argv[1]}`){const result=await runModernRuntimeTests();if(result.failed){console.error(JSON.stringify(result,null,2));process.exitCode=1;}else console.log(`modern-runtime-tests: ${result.passed} passed`);}
