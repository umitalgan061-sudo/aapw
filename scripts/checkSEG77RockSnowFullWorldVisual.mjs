#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import { G77_ROCK_SNOW_POLICY } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper;
const W = 1536, H = 1024, OUT_ARG = process.argv.find((a) => a.startsWith('--out-dir='));
const OUT = path.resolve(OUT_ARG ? OUT_ARG.slice(10) : 'artifacts/se-g77-rock-snow-r9');
const PNG = path.join(OUT, 'g77-rock-snow-full-world-topdown.png'), META = path.join(OUT, 'g77-rock-snow-full-world-metrics.json');
const need = (ok, m) => { if (!ok) throw new Error(`[checkSEG77RockSnowFullWorldVisual] ${m}`); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const runtimeSourceSha256 = sha(Buffer.concat(['src/3d/config.js','src/3d/sceneManager.js','src/3d/world/terrain.js','src/3d/world/worldReferenceSurfaceTerrainVisual.js'].map((f) => fs.readFileSync(f))));
const playwright = loadPlaywright(); need(playwright, 'Playwright required'); fs.mkdirSync(OUT, { recursive: true });
const server = await startStaticServer(), { port } = server.address(), browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }), consoleErrors = [], pageErrors = [], requestFailures = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); }); page.on('pageerror', (e) => pageErrors.push(String(e))); page.on('requestfailed', (r) => requestFailures.push(`${r.method()} ${r.url()}`));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
  const frame = await page.evaluate(async ({ w, h, g77 }) => {
    const im = document.createElement('script'); im.type = 'importmap'; im.textContent = JSON.stringify({ imports:{ three:'/src/3d/vendor/three/three.module.js', 'three/addons/':'/src/3d/vendor/three/addons/' } }); document.head.append(im);
    const [THREE, sceneModule, config, surface] = await Promise.all([import('/src/3d/vendor/three/three.module.js'), import('/src/3d/sceneManager.js'), import('/src/3d/config.js'), import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js')]);
    const installation = surface.installRuntimePindexTerrainPolish(), { WORLD_SCALE, CHUNK_CONFIG } = config;
    document.body.innerHTML = `<canvas id="runtime" width="${w}" height="${h}"></canvas><canvas id="proof" width="${w}" height="${h}"></canvas>`;
    const state = sceneModule.createScene(document.getElementById('runtime')); state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false; state.renderer.setPixelRatio(1); state.renderer.setSize(w,h,false);
    const worldBounds = { minX:-WORLD_SCALE.WORLD_WIDTH_METERS/2, maxX:WORLD_SCALE.WORLD_WIDTH_METERS/2, minZ:-WORLD_SCALE.WORLD_DEPTH_METERS/2, maxZ:WORLD_SCALE.WORLD_DEPTH_METERS/2 }, s = CHUNK_CONFIG.CHUNK_SIZE_METERS;
    const minX = Math.ceil(worldBounds.minX/s-.5), maxX = Math.floor(worldBounds.maxX/s+.5), minZ = Math.ceil(worldBounds.minZ/s-.5), maxZ = Math.floor(worldBounds.maxZ/s+.5);
    for (let z=minZ; z<=maxZ; z++) for (let x=minX; x<=maxX; x++) state.chunkManager.loadChunk(x,z);
    const terrain = [...state.chunkManager.loaded.values()].filter((m) => { const c=m.userData.chunkCoord; return c.x>=minX&&c.x<=maxX&&c.z>=minZ&&c.z<=maxZ; });
    const aspect=w/h, ww=worldBounds.maxX-worldBounds.minX, wd=worldBounds.maxZ-worldBounds.minZ, halfW=Math.max(ww/2,wd*aspect/2)*1.025, halfH=halfW/aspect, camera=new THREE.OrthographicCamera(-halfW,halfW,halfH,-halfH,1,Math.max(ww,wd)*2);
    camera.up.set(0,0,-1); camera.position.set(0,Math.max(ww,wd)*0.8,0); camera.lookAt(0,0,0); state.renderer.render(state.scene,camera);
    const p=document.getElementById('proof'), ctx=p.getContext('2d',{willReadFrequently:true}); ctx.drawImage(state.renderer.domElement,0,0,w,h); const px=ctx.getImageData(0,0,w,h).data;
    let sum=0,sum2=0,n=0; for(let y=0;y<h;y+=16) for(let x=0;x<w;x+=16){const o=(y*w+x)*4,l=.2126*px[o]+.7152*px[o+1]+.0722*px[o+2];sum+=l;sum2+=l*l;n++;}
    let vegetationInstances=0; state.vegetation.traverse((o)=>{if(o.isInstancedMesh) vegetationInstances+=o.count;}); const overlays=[]; state.scene.traverse((o)=>{if(o.visible&&(o.isGridHelper||o.userData?.visibleGeoCellOverlay===true||/(geo.?cell|pindex).*(grid|overlay)|(grid|overlay).*(geo.?cell|pindex)/i.test(`${o.type} ${o.name}`))) overlays.push(o.name||o.type);});
    const coverage={xMin:WORLD_SCALE.MAP_BOUNDS.minX/9000,xMax:WORLD_SCALE.MAP_BOUNDS.maxX/9000,yMin:WORLD_SCALE.MAP_BOUNDS.minY/7000,yMax:WORLD_SCALE.MAP_BOUNDS.maxY/7000}, g77RuntimeCovered=g77.xMin>=coverage.xMin&&g77.xMax<=coverage.xMax&&g77.yMin>=coverage.yMin&&g77.yMax<=coverage.yMax;
    return { cameraType:camera.type, topDownDegrees:90, downDot:camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(0,-1,0)), worldBounds, runtimeNormalizedCoverage:coverage, g77RuntimeCovered, terrainMeshes:terrain.length, terrainVertices:terrain.reduce((a,m)=>a+m.geometry.attributes.position.count,0), pbrMeshes:terrain.filter((m)=>m.material?.isMeshStandardMaterial&&m.userData.runtimePindexTerrainQualityV2?.shaderDetail===true).length, waterMaterial:state.water.material.type, vegetationInstances, renderCalls:state.renderer.info.render.calls, renderTriangles:state.renderer.info.render.triangles, visibleGeoCellOverlay:overlays.length>0, overlayObjects:overlays, luminanceStdDev:Math.sqrt(Math.max(0,sum2/n-(sum/n)**2)), runtimePolicyId:installation.policyId };
  }, { w:W, h:H, g77:G77_ROCK_SNOW_POLICY.normalizedBounds });
  const png=await page.locator('#proof').screenshot({type:'png'}), metadata={schema:'se-g77-rock-snow-full-world-3d-r10',sourceMapSha256:G77_ROCK_SNOW_POLICY.sourceMapSha256,sourceMapSize:G77_ROCK_SNOW_POLICY.sourceMapSize,sourceMapVersion:G77_ROCK_SNOW_POLICY.sourceMapVersion,runtimeSourceSha256,renderSha256:sha(png),dimensions:[W,H],consoleErrors,pageErrors,requestFailures,...frame};
  fs.writeFileSync(PNG,png); fs.writeFileSync(META,`${JSON.stringify(metadata,null,2)}\n`);
  need(png.length>40000&&frame.cameraType==='OrthographicCamera'&&frame.downDot>.999999,'invalid real 90-degree orthographic frame'); need(frame.terrainMeshes>=550&&frame.pbrMeshes===frame.terrainMeshes&&frame.renderTriangles>1_000_000,'incomplete production terrain/PBR render'); need(frame.waterMaterial==='ShaderMaterial'&&frame.vegetationInstances>0,'production water/vegetation missing'); need(!frame.visibleGeoCellOverlay&&frame.luminanceStdDev>5,'blank/grid-contaminated frame'); need(consoleErrors.length===0&&pageErrors.length===0&&requestFailures.length===0,'runtime console/page/request errors');
  need(frame.g77RuntimeCovered, `G77 is outside live runtime coverage ${JSON.stringify(frame.runtimeNormalizedCoverage)}; semantic reconstruction cannot qualify Rock/Snow`);
  console.log(`SE_G77_ROCK_SNOW_FULL_WORLD_3D=${JSON.stringify(metadata)}`); console.log('SE_G77_ROCK_SNOW_FULL_WORLD_VISUAL_OK');
} finally { await browser.close(); await new Promise((r)=>server.close(r)); }
