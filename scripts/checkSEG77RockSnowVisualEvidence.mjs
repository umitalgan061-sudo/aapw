#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import { G77_ROCK_SNOW_POLICY } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper, W=960, H=640, arg=process.argv.find((a)=>a.startsWith('--out-dir='));
const OUT=path.resolve(arg?arg.slice(10):'artifacts/se-g77-rock-snow-r9'), need=(ok,m)=>{if(!ok)throw new Error(`[checkSEG77RockSnowVisualEvidence] ${m}`);}, sha=(b)=>crypto.createHash('sha256').update(b).digest('hex');
const runtimeSourceSha256=sha(Buffer.concat(['src/3d/config.js','src/3d/sceneManager.js','src/3d/world/terrain.js','src/3d/world/worldReferenceSurfaceTerrainVisual.js'].map((f)=>fs.readFileSync(f))));
const playwright=loadPlaywright(); need(playwright,'Playwright required'); fs.mkdirSync(OUT,{recursive:true});
const server=await startStaticServer(), {port}=server.address(), browser=await playwright.chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1}), errors=[]; page.on('pageerror',(e)=>errors.push(String(e))); page.on('console',(m)=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`,{waitUntil:'load',timeout:20000});
  const proof=await page.evaluate(async ({w,h,g77})=>{
    const im=document.createElement('script'); im.type='importmap'; im.textContent=JSON.stringify({imports:{three:'/src/3d/vendor/three/three.module.js','three/addons/':'/src/3d/vendor/three/addons/'}}); document.head.append(im);
    const [THREE,sceneModule,config,surface,waterModule]=await Promise.all([import('/src/3d/vendor/three/three.module.js'),import('/src/3d/sceneManager.js'),import('/src/3d/config.js'),import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js'),import('/src/3d/world/water.js')]);
    const installation=surface.installRuntimePindexTerrainPolish(), {WORLD_SCALE,CHUNK_CONFIG}=config, coverage={xMin:WORLD_SCALE.MAP_BOUNDS.minX/9000,xMax:WORLD_SCALE.MAP_BOUNDS.maxX/9000,yMin:WORLD_SCALE.MAP_BOUNDS.minY/7000,yMax:WORLD_SCALE.MAP_BOUNDS.maxY/7000};
    const centerN={x:(g77.xMin+g77.xMax)/2,y:(g77.yMin+g77.yMax)/2}, target={x:(centerN.x*9000-(WORLD_SCALE.MAP_BOUNDS.minX+WORLD_SCALE.MAP_BOUNDS.maxX)/2)*WORLD_SCALE.METERS_PER_MAP_UNIT,z:(centerN.y*7000-(WORLD_SCALE.MAP_BOUNDS.minY+WORLD_SCALE.MAP_BOUNDS.maxY)/2)*WORLD_SCALE.METERS_PER_MAP_UNIT};
    const runtimeCovered=g77.xMin>=coverage.xMin&&g77.xMax<=coverage.xMax&&g77.yMin>=coverage.yMin&&g77.yMax<=coverage.yMax; if(!runtimeCovered)return{runtimeCovered,coverage,target,policyId:installation.policyId};
    document.body.innerHTML=`<canvas id="runtime" width="${w}" height="${h}"></canvas>`; const state=sceneModule.createScene(document.getElementById('runtime')); state.controls.enabled=false; state.scene.fog=null; state.sky.visible=false; state.stars.visible=false; state.renderer.setPixelRatio(1); state.renderer.setSize(w,h,false);
    const cx=Math.round(target.x/CHUNK_CONFIG.CHUNK_SIZE_METERS),cz=Math.round(target.z/CHUNK_CONFIG.CHUNK_SIZE_METERS); state.chunkManager.loadSquare(cx,cz,2); state.scene.updateMatrixWorld(true); const local=[...state.chunkManager.loaded.values()].filter((m)=>Math.abs(m.userData.chunkCoord.x-cx)<=2&&Math.abs(m.userData.chunkCoord.z-cz)<=2);
    const colliderY=state.groundCollider.getGroundHeight(target.x,target.z), ray=new THREE.Raycaster(new THREE.Vector3(target.x,10000,target.z),new THREE.Vector3(0,-1,0),0,20000), hit=ray.intersectObjects(local,false)[0], physicsParityError=hit?Math.abs(hit.point.y-colliderY):Infinity;
    const span=CHUNK_CONFIG.CHUNK_SIZE_METERS*3.4, localTop=new THREE.OrthographicCamera(-span/2,span/2,span*h/w/2,-span*h/w/2,1,5000); localTop.up.set(0,0,-1); localTop.position.set(target.x,2000,target.z); localTop.lookAt(target.x,0,target.z);
    window.__g77Runtime={render(kind){const c=kind==='top'?localTop:state.camera;if(kind==='near')c.position.set(target.x-320,colliderY+210,target.z+390);if(kind==='far')c.position.set(target.x-40,colliderY+720,target.z+900);if(kind!=='top')c.lookAt(target.x,colliderY,target.z);waterModule.updateWater(state.water,c.position,0);state.renderer.render(state.scene,c);return{calls:state.renderer.info.render.calls,triangles:state.renderer.info.render.triangles,cameraType:c.type};}};
    return{runtimeCovered,coverage,target,policyId:installation.policyId,localMeshes:local.length,pbrMeshes:local.filter((m)=>m.material?.isMeshStandardMaterial&&m.userData.runtimePindexTerrainQualityV2?.shaderDetail===true).length,colliderY,raycastY:hit?.point.y??null,physicsParityError,waterMaterial:state.water.material.type,visibleGeoCellOverlay:local.some((m)=>m.isGridHelper||m.userData?.visibleGeoCellOverlay===true)};
  },{w:W,h:H,g77:G77_ROCK_SNOW_POLICY.normalizedBounds});
  need(proof.runtimeCovered,`G77 is outside live runtime coverage ${JSON.stringify(proof.coverage)}; fake local geometry is forbidden`); need(proof.localMeshes>=9&&proof.pbrMeshes===proof.localMeshes,'production Terrain/PBR chunks missing'); need(proof.waterMaterial==='ShaderMaterial'&&!proof.visibleGeoCellOverlay,'production water/grid contract failed'); need(Number.isFinite(proof.physicsParityError)&&proof.physicsParityError<=0.75,`render/collider height mismatch ${proof.physicsParityError}m`);
  const hashes={}, stats={}; for(const [kind,name] of [['near','g77-rock-snow-near.png'],['far','g77-rock-snow-far.png'],['top','g77-rock-snow-topdown.png']]){stats[kind]=await page.evaluate((k)=>window.__g77Runtime.render(k),kind);need(stats[kind].calls>0&&stats[kind].triangles>0,`${kind} runtime render empty`);const png=await page.locator('#runtime').screenshot();need(png.length>4096,`${kind} PNG too small`);fs.writeFileSync(path.join(OUT,name),png);hashes[kind]=sha(png);}
  need(new Set(Object.values(hashes)).size===3,'real runtime frames are not distinct'); need(errors.length===0,`runtime errors: ${errors.join(' | ')}`);
  const metrics={schema:'se-g77-rock-snow-real-runtime-visual-r10',sourceMapSha256:G77_ROCK_SNOW_POLICY.sourceMapSha256,sourceMapSize:G77_ROCK_SNOW_POLICY.sourceMapSize,sourceMapVersion:G77_ROCK_SNOW_POLICY.sourceMapVersion,runtimeSourceSha256,visibleGeoCellOverlay:false,evidenceSha256:hashes,stats,...proof}; fs.writeFileSync(path.join(OUT,'g77-rock-snow-visual-metrics.json'),`${JSON.stringify(metrics,null,2)}\n`);
  console.log(`SE_G77_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(metrics)}`); console.log('SE_G77_ROCK_SNOW_VISUAL_OK');
} finally {await browser.close();await new Promise((r)=>server.close(r));}
