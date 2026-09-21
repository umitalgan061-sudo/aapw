import type { MigrationSurfaceV4 } from './migrationV4';
import type { RuntimeId } from './runtimeContractsV4';
import { TypedMigrationGateV6 } from './typedMigrationGateV6';

export type LegacyModuleKindV6='entry'|'camera'|'input'|'physics'|'scene'|'world'|'gameplay'|'ui'|'audio'|'render'|'storage'|'debug';
export interface LegacySurfaceRecordV6{readonly path:string;readonly kind:LegacyModuleKindV6;readonly surface:MigrationSurfaceV4;readonly priority:'p0'|'p1'|'p2';readonly typedTarget:string;readonly owner:string;readonly notes:string;readonly status:'inventory'|'shadow'|'parity'|'promoted'|'blocked';}
export interface LegacySurfaceMetricsV6{readonly total:number;readonly typedTargets:number;readonly promoted:number;readonly blocked:number;readonly p0Pending:number;readonly shadowed:number;}

const RECORDS:readonly LegacySurfaceRecordV6[] = Object.freeze([
 {path:'src/3d/game3d.js',kind:'entry',surface:'render',priority:'p0',typedTarget:'src/3d/modern/typedRuntimeFacadeV6.ts',owner:'runtime',notes:'Primary browser entry remains legacy until shadow parity is stable.',status:'shadow'},
 {path:'src/3d/camera.js',kind:'camera',surface:'camera',priority:'p0',typedTarget:'src/3d/modern/typedCameraRuntimeV6.ts',owner:'runtime',notes:'Orbit/chase collision policy moves behind a typed camera contract.',status:'shadow'},
 {path:'src/3d/input.js',kind:'input',surface:'input',priority:'p0',typedTarget:'src/3d/modern/typedInputRuntimeV6.ts',owner:'input',notes:'Keyboard and gamepad are normalized into one command model.',status:'shadow'},
 {path:'src/3d/physics.js',kind:'physics',surface:'movement',priority:'p0',typedTarget:'src/3d/modern/typedPlayerRuntimeV6.ts',owner:'simulation',notes:'Ground snap and vertical motion are deterministic in the typed core.',status:'shadow'},
 {path:'src/3d/sceneManager.js',kind:'scene',surface:'world',priority:'p1',typedTarget:'src/3d/modern/typedSceneCoordinatorV6.ts',owner:'world',notes:'Scene bootstrap remains a renderer adapter boundary.',status:'shadow'},
 {path:'src/3d/world/chunkManager.js',kind:'world',surface:'world',priority:'p0',typedTarget:'src/3d/modern/typedWorldRuntimeV6.ts',owner:'streaming',notes:'Chunk interest and resident budgets are typed and bounded.',status:'shadow'},
 {path:'src/3d/mobileSpawnVegetation.js',kind:'world',surface:'world',priority:'p1',typedTarget:'src/3d/modern/typedWorldRuntimeV6.ts',owner:'streaming',notes:'Spawn-anchored vegetation becomes an ordinary world object class.',status:'shadow'},
 {path:'src/3d/gameLoopHelpers.js',kind:'entry',surface:'render',priority:'p0',typedTarget:'src/3d/modern/typedRenderLoopV6.ts',owner:'runtime',notes:'Frame budget and simulation pacing move into a fixed-step loop.',status:'shadow'},
 {path:'src/3d/renderQuality.js',kind:'render',surface:'render',priority:'p1',typedTarget:'src/3d/modern/performanceBudgetV4.ts',owner:'render',notes:'Quality decisions are data-driven instead of renderer-global.',status:'shadow'},
 {path:'src/3d/safeMode.js',kind:'debug',surface:'telemetry',priority:'p1',typedTarget:'src/3d/modern/typedSceneCoordinatorV6.ts',owner:'runtime',notes:'Recovery and bounded error isolation are centralized.',status:'shadow'},
 {path:'src/3d/audio/audioManager.js',kind:'audio',surface:'audio',priority:'p1',typedTarget:'src/3d/audio/audioManager.ts',owner:'audio',notes:'Audio facade is now TypeScript-owned while preserving the established compatibility boundary.',status:'promoted'},
 {path:'src/3d/assetLoader.js',kind:'storage',surface:'assets',priority:'p0',typedTarget:'src/3d/modern/assetStreamingV4.ts',owner:'assets',notes:'Asset loading gains concurrency and residency controls.',status:'shadow'},
 {path:'src/3d/gameplay/player.js',kind:'gameplay',surface:'movement',priority:'p0',typedTarget:'src/3d/modern/typedPlayerRuntimeV6.ts',owner:'simulation',notes:'Player state is pure data and independently testable.',status:'shadow'},
 {path:'src/3d/gameplay/health.js',kind:'gameplay',surface:'movement',priority:'p1',typedTarget:'src/3d/modern/ecsSystemsV4.ts',owner:'simulation',notes:'Health transitions become ECS system data.',status:'inventory'},
 {path:'src/3d/gameplay/npc.js',kind:'gameplay',surface:'world',priority:'p1',typedTarget:'src/3d/modern/ecsSystemsV4.ts',owner:'simulation',notes:'NPC transforms can migrate after spawn parity.',status:'inventory'},
 {path:'src/3d/gameplay/animals.js',kind:'gameplay',surface:'world',priority:'p1',typedTarget:'src/3d/modern/ecsSystemsV4.ts',owner:'simulation',notes:'Fauna movement can migrate through data-only components.',status:'inventory'},
 {path:'src/3d/ui/touchJoystick.js',kind:'ui',surface:'input',priority:'p1',typedTarget:'src/3d/modern/typedInputRuntimeV6.ts',owner:'input',notes:'Touch intent is normalized by the same input runtime.',status:'shadow'},
 {path:'src/3d/ui/pauseMenu.js',kind:'ui',surface:'input',priority:'p2',typedTarget:'src/3d/modern/typedInputRuntimeV6.ts',owner:'ui',notes:'Pause remains a UI concern but dispatches runtime commands.',status:'inventory'},
 {path:'src/3d/world/vegetation.js',kind:'world',surface:'world',priority:'p1',typedTarget:'src/3d/modern/typedWorldRuntimeV6.ts',owner:'world',notes:'Vegetation instances participate in chunk residency.',status:'shadow'},
 {path:'src/3d/world/water.js',kind:'world',surface:'world',priority:'p2',typedTarget:'src/3d/modern/typedSceneCoordinatorV6.ts',owner:'world',notes:'Water becomes presentation-only render state.',status:'inventory'},
 {path:'src/3d/world/rivers.js',kind:'world',surface:'world',priority:'p2',typedTarget:'src/3d/modern/typedWorldRuntimeV6.ts',owner:'world',notes:'River path data can remain deterministic and renderer-agnostic.',status:'inventory'},
 {path:'src/3d/world/roads.js',kind:'world',surface:'world',priority:'p2',typedTarget:'src/3d/modern/typedWorldRuntimeV6.ts',owner:'world',notes:'Road network metadata moves to bounded world chunks.',status:'inventory'},
 {path:'src/3d/lighting.js',kind:'render',surface:'render',priority:'p2',typedTarget:'src/3d/lighting.ts',owner:'render',notes:'Day/night orbit, celestial asset fallback and lighting outputs are TypeScript-owned.',status:'promoted'},
 {path:'src/3d/sky.js',kind:'render',surface:'render',priority:'p2',typedTarget:'src/3d/sky.ts',owner:'render',notes:'Sky is presentation state driven by day/night data.',status:'promoted'},
 {path:'src/3d/stars.js',kind:'render',surface:'render',priority:'p2',typedTarget:'src/3d/stars.ts',owner:'render',notes:'Deterministic star placement and GPU twinkle are TypeScript-owned.',status:'promoted'},
 {path:'src/3d/nightVisualEnhancement.js',kind:'render',surface:'render',priority:'p2',typedTarget:'src/3d/nightVisualEnhancement.ts',owner:'render',notes:'Night readability fill is TypeScript-owned and remains a child of the canonical hemisphere light.',status:'promoted'},
 {path:'src/3d/celestialLightState.js',kind:'render',surface:'render',priority:'p2',typedTarget:'src/3d/celestialLightState.ts',owner:'render',notes:'Shared shader key state is TypeScript-owned and remains read-only at the consumer boundary.',status:'promoted'},
]);

const SURFACE_BY_PATH=new Map(RECORDS.map(record=>[record.path,record]));

export class LegacySurfaceRegistryV6{
 readonly runtime:RuntimeId;readonly gate:TypedMigrationGateV6;
 #records=new Map(SURFACE_BY_PATH);
 constructor(runtime:RuntimeId,gate?:TypedMigrationGateV6){this.runtime=runtime;this.gate=gate??new TypedMigrationGateV6(runtime);}
 list():readonly LegacySurfaceRecordV6[]{return Object.freeze([...this.#records.values()]);}
 get(path:string):LegacySurfaceRecordV6|null{return this.#records.get(path)??null;}
 byPriority(priority:LegacySurfaceRecordV6['priority']):readonly LegacySurfaceRecordV6[]{return Object.freeze(this.list().filter(record=>record.priority===priority));}
 byKind(kind:LegacyModuleKindV6):readonly LegacySurfaceRecordV6[]{return Object.freeze(this.list().filter(record=>record.kind===kind));}
 pending():readonly LegacySurfaceRecordV6[]{return Object.freeze(this.list().filter(record=>record.status!=='promoted'&&record.status!=='blocked'));}
 promote(path:string):boolean{const record=this.#records.get(path);if(!record)return false;const promoted=this.gate.promote(record.surface);if(!promoted)return false;this.#records.set(path,Object.freeze({...record,status:'promoted'}));return true;}
 block(path:string):void{const record=this.#records.get(path);if(!record)return;this.gate.block(record.surface);this.#records.set(path,Object.freeze({...record,status:'blocked'}));}
 observe(path:string,legacy:unknown,modern:unknown,tick:number,latency=0):void{const record=this.#records.get(path);if(!record)return;const evidence=this.gate.observe(record.surface,legacy,modern,tick,latency);const phase=evidence.matched?'shadow':'blocked';this.#records.set(path,Object.freeze({...record,status:this.gate.status(record.surface)==='promoted'?'promoted':phase}));}
 metrics():LegacySurfaceMetricsV6{const records=this.list();return Object.freeze({total:records.length,typedTargets:new Set(records.map(r=>r.typedTarget)).size,promoted:records.filter(r=>r.status==='promoted').length,blocked:records.filter(r=>r.status==='blocked').length,p0Pending:records.filter(r=>r.priority==='p0'&&r.status!=='promoted').length,shadowed:records.filter(r=>r.status==='shadow').length});}
 report():Readonly<Record<string,unknown>>{const metrics=this.metrics();return Object.freeze({runtime:String(this.runtime),metrics,priority0:this.byPriority('p0'),pending:this.pending(),migration:this.gate.report()});}
}

export function createLegacySurfaceRegistryV6(runtime:RuntimeId):LegacySurfaceRegistryV6{return new LegacySurfaceRegistryV6(runtime);}
export function legacySurfaceDigestV6(record:LegacySurfaceRecordV6):string{return `${record.path}|${record.surface}|${record.typedTarget}|${record.priority}`;}
export function verifyLegacySurfaceCatalogV6(registry:LegacySurfaceRegistryV6):readonly string[]{const errors:string[]=[];for(const record of registry.list()){if(!record.path.endsWith('.js'))errors.push(`${record.path}: legacy path should point to js`);if(!record.typedTarget.endsWith('.ts'))errors.push(`${record.path}: typed target must be ts`);if(record.priority==='p0'&&record.status==='inventory')errors.push(`${record.path}: p0 surface has no shadow target`);}return Object.freeze(errors);}
