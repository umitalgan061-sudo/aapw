/**
 * Scene bootstrap: builds the renderer/camera/scene and the one-time boot-preview world (terrain,
 * water, sky, stars, lighting, river/waterfalls, settlements, colliders, the F4 debug free-fly
 * camera) around `#game3d-canvas`. Extracted out of `game3d.js` (which owns the tick loop and
 * lifecycle wiring instead) once `game3d.js` hit the project's 600-line-per-file cap — see
 * DECISIONS.md ADR-0052. Only setup-time factories live here; the per-frame `update*`/`dispose*`
 * calls those factories pair with stay in `game3d.js`, next to the tick loop that actually calls
 * them every frame.
 * @module sceneManager
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, WORLD_SCALE, CHUNK_CONFIG, SETTLEMENT_CONFIG } from './config.js';
import { PLAYER_CONFIG } from './gameplay/gameplayConfig.js';
import { ChunkManager } from './world/chunkManager.js';
import { createGroundCollider, createSettlementCollider } from './physics.js';
import { createWater } from './world/water.js';
import { generateRiverPath, createRiverMesh, detectWaterfalls, createWaterfallMesh } from './world/rivers.js';
import { createHeightSampler } from './world/terrain.js';
import { createSettlements, computeSettlementFlattenPads } from './world/settlements.js';
import { buildRoadNetwork } from './world/roads.js';
import { createVegetation } from './world/vegetation.js';
import { createOrbitCamera } from './camera.js';
import { createFreeCameraController } from './debug/freeCamera.js';
import { createAuroraSky } from './sky.js';
import { createStarfield } from './stars.js';
import { createDayNightLighting } from './lighting.js';
import { createFog } from './fog.js';

/**
 * Detects a touch-primary (phone/tablet-class) device via the standard `(pointer: coarse)` media
 * query — more reliable than user-agent sniffing, and the same signal a CSS media query would use.
 * Falls back to `false` (treat as desktop) if `matchMedia` itself is unavailable, so this can never
 * throw and block scene creation.
 * @returns {boolean}
 */
export function isCoarsePointerDevice() {
	try {
		return window.matchMedia('(pointer: coarse)').matches;
	} catch {
		return false;
	}
}

/**
 * Converts a world-space coordinate to the chunk grid coordinate it falls in, matching the
 * `world/README.md` convention (chunk `(cx, cz)` centered at world `(cx * size, 0, cz * size)`).
 * Exported so `gameLoopHelpers.js`'s own per-frame chunk-coordinate lookups
 * (`collectCameraCollidables`, `streamAroundOrbitTarget`) share this single definition instead of
 * a second copy.
 * @param {number} worldCoord
 * @param {number} chunkSizeMeters
 * @returns {number}
 */
export function worldToChunkCoord(worldCoord, chunkSizeMeters) {
	return Math.round(worldCoord / chunkSizeMeters);
}

/**
 * Creates the renderer/scene/camera (with interactive orbit controls) and loads a one-time
 * boot-preview neighborhood of terrain chunks around the origin against `canvas`, via
 * `ChunkManager`. The radius is `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` on desktop-class
 * (fine/no pointer) devices, or the much smaller mobile-budget `STREAM_RADIUS_CHUNKS` on
 * touch-primary devices — see DECISIONS.md ADR-0010 for why this split exists: without it, a
 * phone loaded the same chunk count as desktop and blew the mobile triangle budget several times
 * over. Fixed one-time load, not position-based streaming yet — see 3D_GAME_PROGRESS.md FAZ 1 for
 * what's next.
 * @param {HTMLCanvasElement} canvas
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: import('./camera.js').OrbitControls, freeCamera: {camera: THREE.PerspectiveCamera, active: boolean, update: (delta: number) => void, dispose: () => void}, chunkManager: ChunkManager, groundCollider: {getGroundHeight: (x: number, z: number) => number}, settlementCollider: {resolveXZ: (x: number, z: number) => {x: number, z: number}}, sky: THREE.Mesh, stars: THREE.Points, water: THREE.Mesh, river: THREE.Mesh | null, waterfalls: THREE.Mesh[], settlements: THREE.Group, roads: THREE.Group, roadEdges: {fromId: string, toId: string, points: {x: number, y: number, z: number}[], lengthMeters: number, maxGradeDegrees: number}[], vegetation: THREE.Group, settlementSeats: {id: string, name: string, x: number, z: number, groundY: number}[], lights: {sun: THREE.DirectionalLight, hemisphere: THREE.HemisphereLight}, clock: THREE.Clock, elapsedSeconds: number, lastStreamChunk: {x: number, z: number} | null, cameraCollisionRaycaster: THREE.Raycaster}}
 */
export function createScene(canvas) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(window.innerWidth, window.innerHeight);

	const scene = new THREE.Scene();
	// Fallback only — the aurora sky sphere (added below) fully covers the viewport every frame.
	scene.background = new THREE.Color(0x0c0805);
	scene.fog = createFog(); // color/density synced to day/night every frame — see updateFog() in the tick loop below.

	const camera = new THREE.PerspectiveCamera(
		WORLD_DEFAULTS.FOV_DEGREES,
		window.innerWidth / window.innerHeight,
		WORLD_DEFAULTS.NEAR_PLANE,
		WORLD_DEFAULTS.FAR_PLANE,
	);
	// Starting position; overwritten once the player loads (see initGame3D) with a proper
	// third-person framing. OrbitControls (created below) takes over from here on user input.
	camera.position.set(0, 700, 1200);
	const controls = createOrbitCamera(camera, canvas, {
		minDistance: PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS,
		maxDistance: PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS,
	});
	// F4 debug free-fly camera (debug/README.md, ADR-0049) — self-contained, never touches `controls`.
	const freeCamera = createFreeCameraController({ sourceCamera: camera, domElement: canvas });

	const sky = createAuroraSky();
	scene.add(sky);
	const stars = createStarfield(WORLD_DEFAULTS.WORLD_SEED);
	scene.add(stars);
	const water = createWater(WORLD_DEFAULTS.WATER_LEVEL_METERS);
	scene.add(water);
	const clock = new THREE.Clock();

	const lights = createDayNightLighting(scene);

	// Ground-flatten pads (DECISIONS.md ADR-0118) — computed once, up front, from a throwaway *base*
	// (unflattened) sampler, then threaded into both the chunk manager (so the rendered ground mesh
	// is flat under every castle) and the ground collider below (so every gameplay height query —
	// settlements/roads/rivers/NPCs/animals/dragons/the player — agrees with what's actually drawn).
	// See `world/settlements.js`'s `computeSettlementFlattenPads` doc comment for why the anchor
	// height must come from this clamped formula, not the raw terrain sample.
	const baseSampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
	const flattenPads = computeSettlementFlattenPads({
		sampleHeightMeters: baseSampleHeightMeters,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
		mapBounds: WORLD_SCALE.MAP_BOUNDS,
		metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
	});

	const chunkManager = new ChunkManager({
		scene,
		chunkSizeMeters: CHUNK_CONFIG.CHUNK_SIZE_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		flattenPads,
	});
	// Touch-primary devices get the mobile-budget STREAM_RADIUS_CHUNKS instead of the desktop-only
	// PHASE1_PREVIEW_RADIUS_CHUNKS boot preview — see this function's own doc comment / ADR-0010.
	const isMobileClass = isCoarsePointerDevice();
	const previewRadiusChunks = isMobileClass ? CHUNK_CONFIG.STREAM_RADIUS_CHUNKS : CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS;
	const generationStart = performance.now();
	chunkManager.loadSquare(0, 0, previewRadiusChunks);
	const generationMs = performance.now() - generationStart;
	console.info(
		`[sceneManager] Loaded ${chunkManager.loadedCount} terrain chunks ` +
			`(~${chunkManager.getCoveredAreaKm2().toFixed(2)} km²) in ${generationMs.toFixed(0)}ms ` +
			`(${isMobileClass ? 'touch/mobile-class device — mobile-budget radius' : 'desktop-class device — full preview radius'}).`,
	);

	// Single ground-height source for the whole scene (physics.js — also what FAZ 4's player
	// snaps to). Static, generated once — see world/rivers.js module doc for why the river itself
	// doesn't stream/update per frame yet. Same `flattenPads` as `chunkManager` above (ADR-0118) so
	// this never disagrees with the rendered ground mesh under a castle.
	const groundCollider = createGroundCollider(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
	const { points: riverPoints, endReason: riverEndReason } = generateRiverPath({
		seed: WORLD_DEFAULTS.WORLD_SEED,
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	});
	const river = createRiverMesh(riverPoints);
	if (river) scene.add(river);
	console.info(
		`[sceneManager] River path traced: ${riverPoints.length} points, ended via "${riverEndReason}".`,
	);

	// Waterfall "curtains" mark the river's steepest segments — see world/rivers.js module doc /
	// DECISIONS.md ADR-0011 for why the visual is schematic rather than a physically-carved cliff.
	const waterfalls = detectWaterfalls(riverPoints).map((waterfall) => createWaterfallMesh(waterfall));
	waterfalls.forEach((mesh) => scene.add(mesh));
	console.info(`[sceneManager] Detected ${waterfalls.length} waterfall-grade drop(s) along the river.`);

	// One procedural castle per kingdom seat (FAZ 3) — see world/settlements.js and DECISIONS.md ADR-0013.
	const settlementsResult = createSettlements({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		mapBounds: WORLD_SCALE.MAP_BOUNDS,
		metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
		settlementConfig: SETTLEMENT_CONFIG,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	scene.add(settlementsResult.group);
	// Most seats sit outside both the boot-preview and mobile streaming radii (measured — see
	// DECISIONS.md ADR-0013). Force-loading a neighborhood under each one is desktop-only: doing
	// it unconditionally was measured to add ~92 extra chunks (~753K triangles) on the mobile path
	// alone — 1.9x the *entire* mobile triangle budget by itself, on top of the terrain already
	// loaded. Caught by this run's own smoke test before commit, not shipped and fixed later — see
	// DECISIONS.md ADR-0013's Consequence. Mobile-class devices place settlements at their correct
	// sampled height regardless (still uses the real terrain height, just may render without a
	// visible ground mesh directly beneath until the player-streaming system reaches that chunk).
	if (!isMobileClass) {
		for (const seat of settlementsResult.seats) {
			const seatChunkX = worldToChunkCoord(seat.x, CHUNK_CONFIG.CHUNK_SIZE_METERS);
			const seatChunkZ = worldToChunkCoord(seat.z, CHUNK_CONFIG.CHUNK_SIZE_METERS);
			chunkManager.loadSquare(seatChunkX, seatChunkZ, 1);
		}
	}
	console.info(
		`[sceneManager] Placed ${settlementsResult.seats.length} kingdom-seat settlements; ` +
			`${chunkManager.loadedCount} terrain chunks resident ` +
			`(~${chunkManager.getCoveredAreaKm2().toFixed(2)} km²)${isMobileClass ? ' (mobile — grounding skipped, see ADR-0013)' : ' after grounding them'}.`,
	);

	// FAZ 3's "Basit ... collider": keeps the player from walking through a castle's keep/towers —
	// see physics.js's createSettlementCollider doc comment for the box+circle shape this uses.
	const settlementCollider = createSettlementCollider(settlementsResult.seats, SETTLEMENT_CONFIG);

	// GOVERNANCE.md §18 priority #2: a road network (minimum spanning tree, 13 edges) connecting all
	// 14 kingdom seats, each edge routed by world/roads.js's slope-aware A* over the same real,
	// combined (fine-FBM + macro-relief) height field every other world system already reads through
	// `groundCollider.getGroundHeight` — see DECISIONS.md ADR-0076.
	const roadsResult = buildRoadNetwork({
		seats: settlementsResult.seats,
		sampleHeightMeters: groundCollider.getGroundHeight,
	});
	scene.add(roadsResult.group);
	console.info(
		`[sceneManager] Built road network: ${roadsResult.edges.length} segment(s) connecting ` +
			`${settlementsResult.seats.length} kingdom seats, ${(roadsResult.totalLengthMeters / 1000).toFixed(2)} km total, ` +
			`steepest actual segment grade ${roadsResult.maxGradeDegrees.toFixed(1)}°.`,
	);

	// Procedural vegetation (GOVERNANCE.md §3's long-named-but-never-built "Vegetation" world
	// system — see world/vegetation.js's own module doc). Scatter radius matches whatever terrain
	// radius this device class actually loaded above (`previewRadiusChunks`), so trees never render
	// over a chunk that was never generated and density naturally scales down on the mobile-budget
	// path with no separate device-specific knob — see DECISIONS.md's newest ADR. Also layers in
	// run 113/ADR-0140's seat-local clustering ring for whichever seats qualify (see
	// `createVegetation`'s own doc comment) — `clusterSeatCount` reports how many, so this log line
	// stays honest about mobile's expected 0.
	const vegetationResult = createVegetation({
		sampleHeightMeters: groundCollider.getGroundHeight,
		seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
		seed: WORLD_DEFAULTS.WORLD_SEED,
		seats: settlementsResult.seats,
		roadEdges: roadsResult.edges,
		radiusMeters: previewRadiusChunks * CHUNK_CONFIG.CHUNK_SIZE_METERS,
	});
	scene.add(vegetationResult.group);
	console.info(
		`[sceneManager] Scattered vegetation: ${vegetationResult.placedCount}/${vegetationResult.targetCount} tree(s) placed ` +
			`(${vegetationResult.clusterSeatCount} seat(s) with a local cluster ring).`,
	);

	return {
		renderer, scene, camera, controls, freeCamera, chunkManager, groundCollider, settlementCollider, sky, stars, water, river, waterfalls,
		settlements: settlementsResult.group,
		roads: roadsResult.group,
		roadEdges: roadsResult.edges,
		vegetation: vegetationResult.group,
		// Exposed (not just the settlements.group mesh) so initGame3D can place FAZ 5 NPCs relative to
		// a named kingdom seat's real world position/ground height without re-deriving mapToWorldXZ.
		settlementSeats: settlementsResult.seats,
		lights, clock, elapsedSeconds: 0, lastStreamChunk: null,
		// Reused every frame by resolveCameraCollision() — a fresh Raycaster per frame would be
		// needless garbage for a purely synchronous, single-frame query.
		cameraCollisionRaycaster: new THREE.Raycaster(),
	};
}


// Run 179 / ADR-0200 — owner-approved bounded grass field with GPU wind sway.
const RUN179_WIND_GRASS_CONFIG = Object.freeze({ desktop: Object.freeze({ radiusMeters: 350, maxPatches: 4000 }), mobile: Object.freeze({ radiusMeters: 260, maxPatches: 1200 }), cellMeters: 120, bladesPerPatch: 10, patchRadiusMeters: 4.5, roadClearanceMeters: 10, seatClearanceMeters: 100, shoreMarginMeters: 1.5, maxSlopeDegrees: 38 });
function run179Rng(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function run179SegmentDistance(px,pz,a,b){const x=b.x-a.x,z=b.z-a.z,l=x*x+z*z;if(!l)return Math.hypot(px-a.x,pz-a.z);const t=Math.max(0,Math.min(1,((px-a.x)*x+(pz-a.z)*z)/l));return Math.hypot(px-(a.x+x*t),pz-(a.z+z*t));}
function run179GrassAllowed(x,z,{sampleHeightMeters,seaLevelMeters,seats,roadEdges}){
	for(const seat of seats) if(Math.hypot(x-seat.x,z-seat.z)<RUN179_WIND_GRASS_CONFIG.seatClearanceMeters)return false;
	for(const edge of roadEdges) for(let i=1;i<edge.points.length;i++) if(run179SegmentDistance(x,z,edge.points[i-1],edge.points[i])<RUN179_WIND_GRASS_CONFIG.roadClearanceMeters)return false;
	const y=sampleHeightMeters(x,z);if(y<=seaLevelMeters+RUN179_WIND_GRASS_CONFIG.shoreMarginMeters)return false;
	const d=4,dx=sampleHeightMeters(x+d,z)-y,dz=sampleHeightMeters(x,z+d)-y;return Math.atan2(Math.max(Math.abs(dx),Math.abs(dz)),d)*180/Math.PI<=RUN179_WIND_GRASS_CONFIG.maxSlopeDegrees;
}
function run179GrassGeometry(){
	const p=[],idx=[],flex=[],phase=[],n=RUN179_WIND_GRASS_CONFIG.bladesPerPatch,r=RUN179_WIND_GRASS_CONFIG.patchRadiusMeters;
	for(let i=0;i<n;i++){const a=i*2.3999632297,rr=r*Math.sqrt((i+.35)/n),cx=Math.cos(a)*rr,cz=Math.sin(a)*rr,h=.58+.42*((i*37%101)/100),w=.11+.07*((i*53%97)/96),sx=Math.cos(a+Math.PI/2)*w,sz=Math.sin(a+Math.PI/2)*w,b=p.length/3;p.push(cx-sx,0,cz-sz,cx+sx,0,cz+sz,cx-sx,h,cz-sz,cx+sx,h,cz+sz);idx.push(b,b+1,b+2,b+1,b+3,b+2);flex.push(0,0,1,1);phase.push(i/n,i/n,i/n,i/n);}
	const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('run179Flex',new THREE.Float32BufferAttribute(flex,1));g.setAttribute('run179Phase',new THREE.Float32BufferAttribute(phase,1));g.setIndex(idx);g.computeVertexNormals();return g;
}
function run179Populate(mesh,params,cellX,cellZ){
	const cfg=params.isMobileClass?RUN179_WIND_GRASS_CONFIG.mobile:RUN179_WIND_GRASS_CONFIG.desktop,seed=(params.seed^Math.imul(cellX,73856093)^Math.imul(cellZ,19349663)^0x47524153)>>>0,rng=run179Rng(seed),m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),pos=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),cx=cellX*RUN179_WIND_GRASS_CONFIG.cellMeters,cz=cellZ*RUN179_WIND_GRASS_CONFIG.cellMeters;let placed=0;
	for(let i=0;i<cfg.maxPatches;i++)for(let attempt=0;attempt<8;attempt++){const a=rng()*Math.PI*2,r=cfg.radiusMeters*Math.sqrt(rng()),x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;if(!run179GrassAllowed(x,z,params))continue;pos.set(x,params.sampleHeightMeters(x,z)+.03,z);q.setFromAxisAngle(up,rng()*Math.PI*2);const scale=.78+rng()*.47;s.set(scale,scale,scale);m.compose(pos,q,s);mesh.setMatrixAt(placed++,m);break;}
	mesh.count=placed;mesh.instanceMatrix.needsUpdate=true;if(typeof mesh.computeBoundingSphere==='function')mesh.computeBoundingSphere();mesh.userData.run179Cell={x:cellX,z:cellZ};return placed;
}
export function createWindGrassRun179({sampleHeightMeters,seaLevelMeters,seed,seats,roadEdges,isMobileClass=false,centerX=0,centerZ=0}){
	const cfg=isMobileClass?RUN179_WIND_GRASS_CONFIG.mobile:RUN179_WIND_GRASS_CONFIG.desktop,g=run179GrassGeometry(),mat=new THREE.MeshStandardMaterial({color:0x4f7f36,roughness:1,metalness:0,side:THREE.DoubleSide}),mesh=new THREE.InstancedMesh(g,mat,cfg.maxPatches),group=new THREE.Group(),params={sampleHeightMeters,seaLevelMeters,seed,seats,roadEdges,isMobileClass};mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mat.userData.run179WindGrass=Object.freeze({key:'run179-wind-grass-v1',radiusMeters:cfg.radiusMeters,maxPatches:cfg.maxPatches,bladesPerPatch:RUN179_WIND_GRASS_CONFIG.bladesPerPatch});mat.onBeforeCompile=(shader)=>{shader.uniforms.uRun179WindTime={value:0};shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float uRun179WindTime;\nattribute float run179Flex;\nattribute float run179Phase;\nvarying float vRun179GrassVariation;').replace('#include <begin_vertex>',`#include <begin_vertex>
vec2 run179XZ=instanceMatrix[3].xz;
float run179P=dot(run179XZ,vec2(0.021,0.017))+run179Phase*6.2831853;
float run179Wave=sin(uRun179WindTime*1.05+run179P)+0.35*sin(uRun179WindTime*2.15+run179P*1.73);
transformed.xz+=vec2(0.78,0.62)*run179Wave*run179Flex*run179Flex*0.24;
vRun179GrassVariation=fract(sin(dot(run179XZ,vec2(12.9898,78.233)))*43758.5453);`);shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vRun179GrassVariation;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=mix(0.84,1.10,vRun179GrassVariation);');mat.userData.run179Shader=shader;};mat.customProgramCacheKey=()=> 'run179-wind-grass-v1';
	const initialX=Math.round(centerX/RUN179_WIND_GRASS_CONFIG.cellMeters),initialZ=Math.round(centerZ/RUN179_WIND_GRASS_CONFIG.cellMeters);let placed=run179Populate(mesh,params,initialX,initialZ);mesh.onBeforeRender=(_r,_s,camera)=>{const shader=mat.userData.run179Shader;if(shader)shader.uniforms.uRun179WindTime.value=performance.now()*.001;const x=Math.round(camera.position.x/RUN179_WIND_GRASS_CONFIG.cellMeters),z=Math.round(camera.position.z/RUN179_WIND_GRASS_CONFIG.cellMeters);if(x!==mesh.userData.run179Cell.x||z!==mesh.userData.run179Cell.z){placed=run179Populate(mesh,params,x,z);group.userData.run179WindGrass.placedCount=placed;group.userData.run179WindGrass.centerCell={x,z};}};group.add(mesh);group.userData.run179WindGrass={active:true,isMobileClass,placedCount:placed,maxPatches:cfg.maxPatches,radiusMeters:cfg.radiusMeters,centerCell:{x:initialX,z:initialZ}};return {group,mesh};
}
const _createSceneBeforeWindGrassRun179=createScene;createScene=function createSceneWithWindGrassRun179(canvas){const state=_createSceneBeforeWindGrassRun179(canvas),mobile=isCoarsePointerDevice(),grass=createWindGrassRun179({sampleHeightMeters:state.groundCollider.getGroundHeight,seaLevelMeters:WORLD_DEFAULTS.WATER_LEVEL_METERS,seed:WORLD_DEFAULTS.WORLD_SEED,seats:state.settlementSeats,roadEdges:state.roadEdges,isMobileClass:mobile,centerX:state.camera.position.x,centerZ:state.camera.position.z});state.scene.add(grass.group);state.vegetation.userData.run179GrassGroup=grass.group;state.grass=grass.group;state.grassStats=grass.group.userData.run179WindGrass;return state;};
