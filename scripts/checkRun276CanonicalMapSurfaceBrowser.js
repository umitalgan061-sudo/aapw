#!/usr/bin/env node
/** Run273: Chromium proof for owner-map semantic terrain + 10 west-to-east pindexes. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'run273-canonical-map-surface');
const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const EXPECTED_COUNTS = Object.freeze({ sea: 4046, lake: 6, soil: 1638, rock: 323, snow: 131 });
const assert = (value, message) => { if (!value) throw new Error(message); };
function playwrightModule() { for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function contentType(file) { const ext=path.extname(file).toLowerCase(); if(ext==='.html') return 'text/html; charset=utf-8'; if(ext==='.js'||ext==='.mjs') return 'text/javascript; charset=utf-8'; if(ext==='.json') return 'application/json; charset=utf-8'; if(ext==='.css') return 'text/css; charset=utf-8'; if(ext==='.png') return 'image/png'; if(ext==='.glb') return 'model/gltf-binary'; return 'application/octet-stream'; }
function server() { const s=http.createServer((req,res)=>{ const clean=decodeURIComponent(req.url.split('?')[0]); const file=path.join(ROOT, clean==='/'?'index.html':clean.replace(/^\//,'')); if(!file.startsWith(ROOT)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'content-type':contentType(file)}); fs.createReadStream(file).pipe(res); }); return new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s))); }
async function waitForSurface(page){ await page.waitForFunction(()=>document.body?.dataset?.run273SurfaceReady==='true',null,{timeout:30000}); }
async function snapshot(page){ return page.evaluate(()=>({
  requested: document.body.dataset.run201RequestedSource,
  active: document.body.dataset.run201ActiveSource,
  surfaceReady: document.body.dataset.run273SurfaceReady,
  sourceSha: document.body.dataset.run273SurfaceSourceSha,
  counts: JSON.parse(document.body.dataset.run273SurfaceCounts || '{}'),
  pindexes: JSON.parse(document.body.dataset.run273SurfacePindexes || '[]'),
  meshCount: Number(document.body.dataset.run273SurfaceMeshCount || 0),
  vertexCount: Number(document.body.dataset.run273SurfaceVertexCount || 0),
  canvasCount: document.querySelectorAll('canvas').length,
})); }
async function fullMaskVisualProof(page){
  return page.evaluate(async () => {
    const THREE = await import('three');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const { WORLD_REFERENCE_BASE_SURFACE_MASK, WORLD_REFERENCE_PINDEXES } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const { applyReferenceSurfaceToTerrainMesh, WORLD_REFERENCE_SURFACE_VISUAL_POLICY } = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
    const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
    const positions = new Float32Array(mask.width * mask.height * 3);
    let cursor = 0;
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        const normalizedX = (x + 0.5) / mask.width;
        const normalizedY = (y + 0.5) / mask.height;
        const map = normalizedReferenceToMapCanvas(normalizedX, normalizedY);
        const world = mapCanvasToPlannedWorldXZ(map.x, map.y);
        positions[cursor++] = world.x; positions[cursor++] = 0; positions[cursor++] = world.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.MeshStandardMaterial({ color: 0x516a49, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    const summary = applyReferenceSurfaceToTerrainMesh(mesh);
    const expectedPindexes = WORLD_REFERENCE_PINDEXES.map((entry) => Object.values(entry.baseCellCounts).reduce((sum,value)=>sum+value,0));
    const result = {
      sourceSha: WORLD_REFERENCE_SURFACE_VISUAL_POLICY.sourceMapSha256,
      vertexCount: summary.vertexCount,
      counts: summary.counts,
      pindexes: summary.pindexVertexCounts,
      expectedPindexes,
      colorCount: geometry.getAttribute('color').count,
      vertexColors: material.vertexColors,
      materialHex: material.color.getHex(),
    };
    geometry.dispose(); material.dispose();
    return result;
  });
}
async function main(){
  const playwright=playwrightModule(); if(!playwright) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT,{recursive:true}); const s=await server(); const browser=await playwright.chromium.launch({headless:true}); const errors=[];
  try{
    const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1440,height:900}}); const page=await context.newPage();
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());}); page.on('pageerror',e=>errors.push(String(e)));
    const url=`http://127.0.0.1:${s.address().port}/canonical-dev.html?worldSource=canonical-dev`;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000}); await waitForSurface(page);
    const fullMask = await fullMaskVisualProof(page);
    assert(fullMask.sourceSha===EXPECTED_SHA,'full-mask visual source SHA drifted');
    assert(fullMask.vertexCount===6144&&fullMask.colorCount===6144,'full-mask visual vertex coverage drifted');
    assert(JSON.stringify(fullMask.counts)===JSON.stringify(EXPECTED_COUNTS),'full-mask semantic counts drifted');
    assert(JSON.stringify(fullMask.pindexes)===JSON.stringify(fullMask.expectedPindexes),'full-mask pindex visual coverage drifted');
    assert(fullMask.vertexColors===true&&fullMask.materialHex===0xffffff,'semantic vertex material state not active');

    const online=await snapshot(page);
    assert(online.requested==='canonical'&&online.active==='canonical','canonical source not active');
    assert(online.surfaceReady==='true','Run273 surface visual not ready');
    assert(online.sourceSha===EXPECTED_SHA,'owner map SHA drifted');
    assert(online.meshCount>0&&online.vertexCount>0,'canonical terrain visual has no geometry');
    assert(online.pindexes.length===10,'pindex coverage vector must contain 10 entries');
    assert(online.pindexes.reduce((sum,value)=>sum+value,0)===online.vertexCount,'pindex coverage must equal rendered vertex count');
    assert(Object.keys(online.counts).sort().join(',')==='lake,rock,sea,snow,soil','rendered surface classes drifted');
    assert(Object.values(online.counts).reduce((sum,value)=>sum+value,0)===online.vertexCount,'surface coverage must equal rendered vertex count');
    assert(online.canvasCount===1,'canonical developer canvas mismatch');
    await page.screenshot({path:path.join(OUT,'canonical-map-surface-online.png'),fullPage:true});

    await page.waitForFunction(()=>document.body?.dataset?.run201CacheReady==='true',null,{timeout:30000});
    await context.setOffline(true); await page.reload({waitUntil:'domcontentloaded',timeout:30000}); await waitForSurface(page);
    const offline=await snapshot(page);
    assert(offline.active==='canonical','offline canonical source not active');
    assert(offline.sourceSha===online.sourceSha,'offline owner map SHA drifted');
    assert(JSON.stringify(offline.counts)===JSON.stringify(online.counts),'offline semantic surface counts drifted');
    assert(JSON.stringify(offline.pindexes)===JSON.stringify(online.pindexes),'offline pindex coverage drifted');
    assert(errors.length===0,`console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({path:path.join(OUT,'canonical-map-surface-offline.png'),fullPage:true});
    const proof={fullMask,online,offline,consoleErrors:errors.length};
    fs.writeFileSync(path.join(OUT,'proof.json'),JSON.stringify(proof,null,2)+'\n');
    console.log(`[Run273] canonical map surface browser PASS ${JSON.stringify(proof)}`);
    await context.close();
  } finally { await browser.close(); await new Promise(resolve=>s.close(resolve)); }
}
main().catch(error=>{console.error(`[Run273] canonical map surface browser FAIL: ${error.stack||error}`);process.exitCode=1;});
