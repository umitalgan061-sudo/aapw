#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'run301-editor-fbx-pack-current-main');
function assert(value, message) { if (!value) throw new Error(message); }
function playwrightModule() { for (const id of ['playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function typeOf(file) { const ext = path.extname(file).toLowerCase(); if (ext === '.html') return 'text/html; charset=utf-8'; if (ext === '.js'||ext === '.mjs') return 'text/javascript; charset=utf-8'; if (ext === '.css') return 'text/css; charset=utf-8'; if (ext === '.json'||ext === '.webmanifest') return 'application/json; charset=utf-8'; if (ext === '.png') return 'image/png'; if (ext === '.jpg'||ext === '.jpeg') return 'image/jpeg'; return 'application/octet-stream'; }
function serve() { const server = http.createServer((req,res) => { const clean=decodeURIComponent(req.url.split('?')[0]); if(clean==='/favicon.ico'){res.writeHead(204);res.end();return;} const rel=clean==='/'?'index.html':clean.replace(/^\//,''); const file=path.resolve(ROOT,rel); const index=path.join(file,'index.html'); if(file.startsWith(ROOT+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isDirectory()&&fs.existsSync(index)){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});fs.createReadStream(index).pipe(res);return;} if(!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end('Not found');return;} res.writeHead(200,{'content-type':typeOf(file),'cache-control':'no-store'});fs.createReadStream(file).pipe(res); }); return new Promise((resolve)=>server.listen(0,'127.0.0.1',()=>resolve(server))); }

async function main() {
  const playwright = playwrightModule();
  assert(playwright, 'Playwright unavailable');
  fs.mkdirSync(ARTIFACT_DIR,{recursive:true});
  const server = await serve();
  const browser = await playwright.chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
  const page = await context.newPage();
  const errors=[];
  page.on('console',(m)=>{if(m.type()==='error') errors.push(m.text());});
  page.on('pageerror',(e)=>errors.push(String(e)));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/editor.html`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.__WESTEROS_WORLD_EDITOR__&&window.__WESTEROS_EDITOR_TRANSFORM__&&window.__WESTEROS_EDITOR_FBX_PACKS__,null,{timeout:120000});
    await page.waitForFunction(()=>window.__WESTEROS_WORLD_EDITOR__.editableObjects.length===0,null,{timeout:30000});
    await page.evaluate(async()=>{
      const THREE=await import('./src/3d/vendor/three/three.module.js');
      const api=window.__WESTEROS_WORLD_EDITOR__;
      const root=new THREE.Group(); root.name='Run301 FBX Pack'; root.userData.editorId='run301-fbx-root'; root.userData.editorAssetId='peasant-girl'; root.userData.editorFormat='fbx'; root.position.set(0,5,0);
      for (const [name,x,color] of [['Pack A',-4,0x9a7546],['Pack B',4,0x58779a]]) { const group=new THREE.Group(); group.name=name; group.position.x=x; const mesh=new THREE.Mesh(new THREE.BoxGeometry(3,3,3),new THREE.MeshStandardMaterial({color})); mesh.userData.editorRoot=root; group.add(mesh); root.add(group); }
      api.editableObjects.push(root); api.scene.add(root); api.refreshHierarchy();
    });
    await page.locator('#we-hierarchy .we-hierarchy-item',{hasText:'Run301 FBX Pack'}).click();
    await page.waitForFunction(()=>window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().candidateCount===2);
    await page.locator('#we-fbx-pack-list button',{hasText:'Pack B'}).click();
    await page.waitForFunction(()=>window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().activePackName==='Pack B');
    await page.evaluate(()=>{ const snap=document.getElementById('we-snap-toggle'); snap.checked=false; snap.dispatchEvent(new Event('change',{bubbles:true})); });
    for (const [id,value] of [['#we-pos-x','7.25'],['#we-rot-y','-37.5'],['#we-scale-x','0.007']]) { await page.locator(id).fill(value); await page.locator(id).dispatchEvent('change'); }
    const state=await page.evaluate(()=>{ const root=window.__WESTEROS_WORLD_EDITOR__.getSelectedObject(); return {root:root.position.toArray(),a:root.children[0].position.toArray(),b:root.children[1].position.toArray(),br:root.children[1].rotation.y,bs:root.children[1].scale.x,surface:window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot(),transform:window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot()}; });
    assert(JSON.stringify(state.root)===JSON.stringify([0,5,0]),`Root moved: ${JSON.stringify(state)}`);
    assert(state.a[0]===-4,`Sibling changed: ${JSON.stringify(state)}`);
    assert(Math.abs(state.b[0]-7.25)<1e-9&&Math.abs(state.br-(-37.5*Math.PI/180))<1e-9&&Math.abs(state.bs-0.007)<1e-9,`Pack transform drifted: ${JSON.stringify(state)}`);
    assert(state.surface.transformAttachedToPack===true&&state.surface.overrideCount===1&&state.transform.attachedEditorId===null,`Pack attachment drifted: ${JSON.stringify(state)}`);
    await page.screenshot({path:path.join(ARTIFACT_DIR,'01-independent-pack.png'),fullPage:true});
    const before=await page.evaluate(()=>window.__WESTEROS_WORLD_EDITOR__.editableObjects.length); await page.locator('#we-delete').click(); await page.waitForTimeout(80); const after=await page.evaluate(()=>window.__WESTEROS_WORLD_EDITOR__.editableObjects.length); assert(before===after,'Pack-active delete removed root');
    const downloadPromise=page.waitForEvent('download',{timeout:30000}); await page.locator('#we-save').click(); const download=await downloadPromise; const p=await download.path(); const saved=JSON.parse(fs.readFileSync(p,'utf8')); const record=saved.objects.find((o)=>o.id==='run301-fbx-root'); assert(record?.fbxPacks?.length===1,`fbxPacks missing: ${JSON.stringify(record)}`); assert(Math.abs(record.fbxPacks[0].transform.position[0]-7.25)<1e-9&&Math.abs(record.fbxPacks[0].transform.scale[0]-0.007)<1e-9,'Saved pack transform drifted');
    const restored=await page.evaluate((data)=>{const root=window.__WESTEROS_WORLD_EDITOR__.editableObjects.find((o)=>o.userData.editorId==='run301-fbx-root');root.children[1].position.x=99;return window.__WESTEROS_EDITOR_FBX_PACKS__.applyScenePackOverrides(data);},saved); assert(restored.applied===1&&restored.missing===0,`Restore failed: ${JSON.stringify(restored)}`);
    await page.locator('#we-fbx-pack-root').click(); await page.waitForFunction(()=>window.__WESTEROS_EDITOR_FBX_PACKS__.getSnapshot().activePackPath===null); const rootAttach=await page.evaluate(()=>window.__WESTEROS_EDITOR_TRANSFORM__.getSnapshot().attachedEditorId); assert(rootAttach==='run301-fbx-root',`Root attachment not restored: ${rootAttach}`);
    await page.screenshot({path:path.join(ARTIFACT_DIR,'02-root-selection-restored.png'),fullPage:true});
    assert(errors.length===0,`Browser errors: ${errors.join(' | ')}`);
    console.log('[checkRun301EditorFbxPackCurrentMain] PASS');
  } finally { await context.close(); await browser.close(); await new Promise((r)=>server.close(r)); }
}
main().catch((error)=>{console.error('[checkRun301EditorFbxPackCurrentMain] FAIL:',error?.stack||error);process.exit(1);});
