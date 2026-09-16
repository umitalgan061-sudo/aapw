import assert from 'node:assert/strict';
import { AdaptiveQualityController } from './adaptiveQuality';
import { FixedStepClock } from './frameScheduler';
import { ModernEntityStore } from './ecs';
import { SpatialHashGrid } from './spatialIndex';
import { CameraFramePolicy } from './cameraFramePolicy';
import { NavigationGrid } from './navigation';
import { RuntimeConfig, defaults, validateConfig } from './runtimeConfig';
import { StateMachine, createRuntimeModeMachine } from './stateMachine';
import { ContentAddressedCache } from './contentCache';
import { WorldStateCodec } from './worldStateCodec';
import { asEntityId } from './types';

export interface StressCase { readonly id:string;readonly run:()=>void|Promise<void>; }
const cases:StressCase[]=[];
const add=(id:string,run:StressCase['run']):void=>cases.push({id,run});

add('stress-config-default',()=>assert.equal(validateConfig(defaults).length,0));
add('stress-config-roundtrip',()=>assert.deepEqual(new RuntimeConfig(defaults).snapshot(),defaults));
add('stress-config-json',()=>assert.equal(new RuntimeConfig(defaults).serialize(),JSON.stringify(defaults)));
add('stress-config-clamp-fps-low',()=>assert.equal(new RuntimeConfig({targetFps:1}).snapshot().targetFps,24));
add('stress-config-clamp-fps-high',()=>assert.equal(new RuntimeConfig({targetFps:999}).snapshot().targetFps,240));
add('stress-config-clamp-budget-low',()=>assert.ok(new RuntimeConfig({schedulerBudgetMs:.1}).snapshot().schedulerBudgetMs>=1));
add('stress-config-clamp-budget-high',()=>assert.ok(new RuntimeConfig({schedulerBudgetMs:99}).snapshot().schedulerBudgetMs<=16));
add('stress-config-entries-low',()=>assert.ok(new RuntimeConfig({assetEntryBudget:1}).snapshot().assetEntryBudget>=16));
add('stress-config-entities-low',()=>assert.ok(new RuntimeConfig({maxEntities:1}).snapshot().maxEntities>=100));
add('stress-config-seed-wrap',()=>assert.equal(new RuntimeConfig({seed:-1}).snapshot().seed,4294967295));

add('stress-mode-initial',()=>assert.equal(createRuntimeModeMachine().state(),'loading'));
add('stress-mode-load',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');assert.equal(m.state(),'gameplay');});
add('stress-mode-menu',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-menu');assert.equal(m.state(),'menu');});
add('stress-mode-menu-close',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-menu');m.transition('close-menu');assert.equal(m.state(),'gameplay');});
add('stress-mode-photo',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-photo');assert.equal(m.state(),'photo');});
add('stress-mode-photo-close',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-photo');m.transition('close-photo');assert.equal(m.state(),'gameplay');});
add('stress-mode-editor',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-editor');assert.equal(m.state(),'editor');});
add('stress-mode-editor-close',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-editor');m.transition('close-editor');assert.equal(m.state(),'gameplay');});
add('stress-mode-history',()=>{const m=createRuntimeModeMachine();m.transition('finish-load');m.transition('open-menu');assert.equal(m.historySnapshot().length,2);});
add('stress-mode-can-valid',()=>{const m=createRuntimeModeMachine();assert.equal(m.can('finish-load'),true);});
add('stress-mode-can-invalid',()=>{const m=createRuntimeModeMachine();assert.equal(m.can('open-menu'),false);});

add('stress-camera-scale-min',()=>{const c=new CameraFramePolicy({limits:{minResolutionScale:.6}});assert.equal(c.setResolutionScale(0),.6);});
add('stress-camera-scale-max',()=>{const c=new CameraFramePolicy({limits:{maxResolutionScale:1.2}});assert.equal(c.setResolutionScale(2),1.2);});
add('stress-camera-scale-nan',()=>{const c=new CameraFramePolicy();assert.equal(c.setResolutionScale(Number.NaN),1);});
add('stress-camera-clip-near',()=>{const c=new CameraFramePolicy();assert.ok(c.recommendedClipPlanes({distance:5,radius:1}).near>0);});
add('stress-camera-clip-far',()=>{const c=new CameraFramePolicy();const p=c.recommendedClipPlanes({distance:50,radius:5});assert.ok(p.far>p.near);});
add('stress-camera-frame-small',()=>{const c=new CameraFramePolicy();const s=c.beginFrame(1 as any,{position:{x:0,y:0,z:2},target:{x:0,y:0,z:0},up:{x:0,y:1,z:0}},{width:320,height:240},{tier:'safe',resolutionScale:.65,shadowDistance:40,foliageDensity:.3,effectsLevel:.3,reason:'test'});assert.equal(s.near>0,true);});
add('stress-camera-frame-large',()=>{const c=new CameraFramePolicy();const s=c.beginFrame(2 as any,{position:{x:10,y:10,z:10},target:{x:0,y:0,z:0},up:{x:0,y:1,z:0}},{width:3840,height:2160},{tier:'ultra',resolutionScale:1,shadowDistance:200,foliageDensity:1,effectsLevel:1,reason:'test'});assert.ok(s.dpr>=.5);});
add('stress-camera-jitter-1',()=>{const c=new CameraFramePolicy();const a=c.beginFrame(1 as any,{position:{x:0,y:0,z:1},target:{x:0,y:0,z:0},up:{x:0,y:1,z:0}},{width:1,height:1},{tier:'high',resolutionScale:1,shadowDistance:100,foliageDensity:1,effectsLevel:1,reason:'x'});assert.ok(Math.abs(a.jitter.x)<=.5);});
add('stress-camera-jitter-2',()=>{const c=new CameraFramePolicy();const a=c.beginFrame(2 as any,{position:{x:0,y:0,z:1},target:{x:0,y:0,z:0},up:{x:0,y:1,z:0}},{width:1,height:1},{tier:'high',resolutionScale:1,shadowDistance:100,foliageDensity:1,effectsLevel:1,reason:'x'});assert.ok(Math.abs(a.jitter.y)<=.5);});
add('stress-camera-projection-diff',()=>{const c=new CameraFramePolicy();const a=c.beginFrame(1 as any,{position:{x:0,y:0,z:1},target:{x:0,y:0,z:0},up:{x:0,y:1,z:0}},{width:1,height:1},{tier:'high',resolutionScale:1,shadowDistance:100,foliageDensity:1,effectsLevel:1,reason:'x'});const b=c.beginFrame(2 as any,a.pose,{width:2,height:1},{tier:'high',resolutionScale:1,shadowDistance:100,foliageDensity:1,effectsLevel:1,reason:'x'});assert.equal(c.shouldUpdateProjection(a,b),true);});

const q=(tier:'safe'|'low'|'medium'|'high'|'ultra'):AdaptiveQualityController=>new AdaptiveQualityController(tier);
add('stress-quality-safe',()=>assert.equal(q('safe').state().tier,'safe'));
add('stress-quality-low',()=>assert.equal(q('low').state().tier,'low'));
add('stress-quality-medium',()=>assert.equal(q('medium').state().tier,'medium'));
add('stress-quality-high',()=>assert.equal(q('high').state().tier,'high'));
add('stress-quality-ultra',()=>assert.equal(q('ultra').state().tier,'ultra'));
add('stress-quality-low-pressure',()=>{const c=q('high');for(let i=0;i<20;i+=1)c.observe({cpuMs:30,gpuMs:30,timestampMs:i*100});assert.ok(c.state().resolutionScale<1);});
add('stress-quality-high-headroom',()=>{const c=q('medium');for(let i=0;i<120;i+=1)c.observe({cpuMs:4,gpuMs:4,timestampMs:i*100});assert.ok(c.state().tier>='medium');});
add('stress-quality-min-bound',()=>{const c=q('high');for(let i=0;i<500;i+=1)c.observe({cpuMs:100,gpuMs:100,timestampMs:i*100});assert.ok(c.state().resolutionScale>=.55);});

const clock=(elapsed:number,max:number):number=>{const c=new FixedStepClock({stepSeconds:1/60,maxCatchUpSteps:max});let n=0;c.consume(0,()=>undefined);c.consume(elapsed,()=>{n+=1;});return n;};
add('stress-clock-16',()=>assert.equal(clock(16,5),0));
add('stress-clock-17',()=>assert.ok(clock(17,5)>=1));
add('stress-clock-33',()=>assert.ok(clock(33,5)>=1));
add('stress-clock-50',()=>assert.ok(clock(50,5)>=2));
add('stress-clock-66',()=>assert.ok(clock(66,5)>=3));
add('stress-clock-100',()=>assert.ok(clock(100,5)>=4));
add('stress-clock-max-1',()=>assert.ok(clock(1000,1)<=1));
add('stress-clock-max-2',()=>assert.ok(clock(1000,2)<=2));
add('stress-clock-max-3',()=>assert.ok(clock(1000,3)<=3));
add('stress-clock-max-4',()=>assert.ok(clock(1000,4)<=4));
add('stress-clock-max-5',()=>assert.ok(clock(1000,5)<=5));

const store=(count:number):ModernEntityStore=>{const s=new ModernEntityStore({seed:77});for(let i=0;i<count;i+=1)s.create({tags:[`t-${i%3}`]});return s;};
add('stress-ecs-0',()=>assert.equal(store(0).entityCount(),0));
add('stress-ecs-1',()=>assert.equal(store(1).entityCount(),1));
add('stress-ecs-2',()=>assert.equal(store(2).entityCount(),2));
add('stress-ecs-4',()=>assert.equal(store(4).entityCount(),4));
add('stress-ecs-8',()=>assert.equal(store(8).entityCount(),8));
add('stress-ecs-16',()=>assert.equal(store(16).entityCount(),16));
add('stress-ecs-32',()=>assert.equal(store(32).entityCount(),32));
add('stress-ecs-64',()=>assert.equal(store(64).entityCount(),64));
add('stress-ecs-query-t0',()=>assert.equal(store(30).query({tag:'t-0'}).count,10));
add('stress-ecs-query-t1',()=>assert.equal(store(31).query({tag:'t-1'}).count,10));
add('stress-ecs-query-t2',()=>assert.equal(store(32).query({tag:'t-2'}).count,10));
add('stress-ecs-snapshot-10',()=>assert.equal(store(10).snapshot().entities.length,10));
add('stress-ecs-snapshot-20',()=>assert.equal(store(20).snapshot().entities.length,20));
add('stress-ecs-snapshot-40',()=>assert.equal(store(40).snapshot().entities.length,40));
add('stress-ecs-remove',()=>{const s=store(5);const id=s.snapshot().entities[0]!.id;assert.equal(s.remove(id),true);assert.equal(s.entityCount(),4);});
add('stress-ecs-update-active',()=>{const s=store(3);const id=s.snapshot().entities[0]!.id;s.update(id,{active:false});assert.equal(s.query({activeOnly:true}).count,2);});
add('stress-ecs-component',()=>{const s=store(2);const id=s.snapshot().entities[0]!.id;s.setComponent(id,'hp',100);assert.equal(s.query({with:['hp']}).count,1);});
add('stress-ecs-component-remove',()=>{const s=store(2);const id=s.snapshot().entities[0]!.id;s.setComponent(id,'hp',100);assert.equal(s.removeComponent(id,'hp'),true);});

const grid=(count:number):SpatialHashGrid=>{const g=new SpatialHashGrid(8);for(let i=0;i<count;i+=1)g.insert({id:asEntityId(`s-${i}`),position:{x:i*2,y:0,z:i%5},radius:.5});return g;};
add('stress-spatial-1',()=>assert.equal(grid(1).size(),1));
add('stress-spatial-4',()=>assert.equal(grid(4).size(),4));
add('stress-spatial-16',()=>assert.equal(grid(16).size(),16));
add('stress-spatial-64',()=>assert.equal(grid(64).size(),64));
add('stress-spatial-128',()=>assert.equal(grid(128).size(),128));
add('stress-spatial-valid',()=>assert.deepEqual(grid(128).validate(),{valid:true,duplicates:0}));
add('stress-spatial-near',()=>assert.ok(grid(32).nearest({x:0,y:0,z:0},4,4).length>0));
add('stress-spatial-far',()=>assert.equal(grid(32).nearest({x:1000,y:0,z:1000},4,4).length,0));
add('stress-spatial-remove',()=>{const g=grid(9);assert.equal(g.remove(asEntityId('s-1')),true);assert.equal(g.size(),8);});
add('stress-spatial-move',()=>{const g=grid(9);g.update({id:asEntityId('s-1'),position:{x:100,y:0,z:100},radius:1});assert.equal(g.size(),9);});

const nav=new NavigationGrid({width:20,height:20,cellSize:1,diagonal:true});
add('stress-nav-size',()=>assert.equal(nav.size(),400));
add('stress-nav-cell',()=>assert.deepEqual(nav.worldToCell({x:.1,y:0,z:.1}),{x:0,y:0}));
add('stress-nav-world',()=>assert.deepEqual(nav.cellToWorld(2,3),{x:2.5,y:0,z:3.5}));
add('stress-nav-path',()=>assert.equal(nav.findPath({x:.1,y:0,z:.1},{x:8,y:0,z:8}).complete,true));
add('stress-nav-block',()=>{nav.setWalkable(4,4,false);assert.equal(nav.findPath({x:.1,y:0,z:.1},{x:8,y:0,z:8}).complete,true);nav.setWalkable(4,4,true);});
add('stress-nav-nearest',()=>assert.ok(nav.nearestWalkable({x:4.1,y:0,z:4.1},3)));
add('stress-nav-ratio',()=>assert.ok(nav.blockedRatio()>=0));

const cache=new ContentAddressedCache({byteBudget:4096,entryBudget:8});
add('stress-cache-empty',()=>assert.equal(cache.stats().entries,0));
add('stress-cache-set',()=>{cache.set('a',asEntityId('asset-a'),'hello',5);assert.equal(cache.get('a'),'hello');});
add('stress-cache-hit',()=>{cache.get('a');assert.ok(cache.stats().hits>=1);});
add('stress-cache-miss',()=>{cache.get('missing');assert.ok(cache.stats().misses>=1);});
add('stress-cache-verify',()=>assert.equal(cache.verify('a'),true));
add('stress-cache-delete',()=>{assert.equal(cache.delete('a'),true);assert.equal(cache.has('a'),false);});

const codecStress=new WorldStateCodec({maxBytes:64*1024,maxEntities:1024,expectedSchemaVersion:1});
add('stress-codec-small',()=>{const s=store(1).snapshot();assert.ok(codecStress.verify(s).valid);});
add('stress-codec-medium',()=>{const s=store(25).snapshot();const encoded=codecStress.encode(s);assert.equal(codecStress.decode(encoded.bytes).ok,true);});
add('stress-codec-large',()=>{const s=store(100).snapshot();const encoded=codecStress.encode(s);assert.ok(encoded.bytes.byteLength>0);});

export const runStressMatrix=async():Promise<{total:number;passed:number;failed:number;failures:readonly string[]}>=>{let passed=0,failed=0;const failures:string[]=[];for(const entry of cases){try{await entry.run();passed+=1;}catch(error){failed+=1;failures.push(`${entry.id}:${error instanceof Error?error.message:String(error)}`);}}return{total:cases.length,passed,failed,failures};};
if(import.meta.url===`file://${process.argv[1]}`){const report=await runStressMatrix();console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;}
