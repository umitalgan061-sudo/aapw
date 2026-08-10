#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run229-editor-combined-transform-history');
const POS = [-6.25, 2.5, 9.75];
const DEG = -45.5;
const RAD = DEG * Math.PI / 180;
const RAD6 = Number(RAD.toFixed(6));
const SCALE = [0.5, 1.75, 2.25];
const assert = (v, m) => { if (!v) throw new Error(m); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const vecNear = (a, b, e = 1e-9) => a.every((v, i) => near(v, b[i], e));
function playwright() { for (const id of ['playwright','/opt/node22/lib/node_modules/playwright']) { try { return require(id); } catch {} } return null; }
function type(file) { const e=path.extname(file); if(e==='.html')return'text/html'; if(e==='.js'||e==='.mjs')return'text/javascript'; if(e==='.css')return'text/css'; if(e==='.json'||e==='.webmanifest')return'application/json'; if(e==='.png')return'image/png'; if(e==='.glb')return'model/gltf-binary'; return'application/octet-stream'; }
function serve() { const s=http.createServer((req,res)=>{ const rel=decodeURIComponent(req.url.split('?')[0])==='/'?'index.html':decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''); const f=path.resolve(ROOT,rel); const idx=path.join(f,'index.html'); if(f.startsWith(ROOT+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isDirectory()&&fs.existsSync(idx)){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});fs.createReadStream(idx).pipe(res);return;} if(!f.startsWith(ROOT+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;} res.writeHead(200,{'content-type':type(f),'cache-control':'no-store'});fs.createReadStream(f).pipe(res); }); return new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s))); }
async function main(){
  const pw=playwright(); assert(pw,'Playwright unavailable');
  const server=await serve(); const browser=await pw.chromium.launch({headless:true}); const context=await browser.newContext({viewport:{width:1440,height:900}}); const page=await context.newPage(); const errors=[];
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());}); page.on('pageerror',e=>errors.push(String(e)));
  const read=()=>page.evaluate(()=>{const o=window.__WESTEROS_WORLD_EDITOR__.editableObjects[0];return {id:o.userData.editorId,asset:o.userData.editorAssetId,p:o.position.toArray(),r:[o.rotation.x,o.rotation.y,o.rotation.z],s:o.scale.toArray()};});
  const capture=async()=>{await page.waitForTimeout(240);await page.evaluate(()=>window.__WESTEROS_EDITOR_HISTORY__.captureNow());};
  try{
    await page.goto(`http://127.0.0.1:${server.address().port}/editor.html`,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.__WESTEROS_WORLD_EDITOR__&&window.__WESTEROS_EDITOR_HISTORY__&&window.__WESTEROS_WORLD_EDITOR__.editableObjects.length===0,null,{timeout:120000});
    await page.waitForFunction(()=>window.__WESTEROS_EDITOR_HISTORY__.getSnapshot().observersStarted===true,null,{timeout:30000});
    const snap=page.locator('#we-snap-toggle'); if(await snap.isChecked())await snap.uncheck();
    await page.locator('#we-assets .we-asset',{hasText:'Ağaç İşaretçisi'}).first().dblclick();
    await page.waitForFunction(()=>window.__WESTEROS_WORLD_EDITOR__.editableObjects.length===1); await capture();
    const original=await read(); assert(original.asset==='marker-tree'&&original.id,'bad baseline'); fs.mkdirSync(OUT,{recursive:true}); await page.screenshot({path:path.join(OUT,'01-original.png'),fullPage:true});

    await page.evaluate(v=>{['we-pos-x','we-pos-y','we-pos-z'].forEach((id,i)=>document.getElementById(id).value=String(v[i]));document.getElementById('we-pos-x').dispatchEvent(new Event('change',{bubbles:true}));},POS);
    await page.waitForFunction(v=>window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.toArray().every((x,i)=>Math.abs(x-v[i])<1e-9),POS); await capture(); const positioned=await read();

    const ry=page.locator('#we-rot-y'); await ry.fill(String(DEG)); await ry.dispatchEvent('change');
    await page.waitForFunction(v=>Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].rotation.y-v)<1e-12,RAD); await capture(); const rotated=await read();

    await page.evaluate(v=>{['we-scale-x','we-scale-y','we-scale-z'].forEach((id,i)=>{const el=document.getElementById(id);el.value=String(v[i]);el.dispatchEvent(new Event('change',{bubbles:true}));});},SCALE);
    await page.waitForFunction(v=>window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.toArray().every((x,i)=>Math.abs(x-v[i])<1e-9),SCALE); await capture(); const final=await read();
    assert(final.id===original.id&&vecNear(final.p,POS)&&near(final.r[1],RAD,1e-12)&&vecNear(final.s,SCALE),'combined transform drift'); await page.screenshot({path:path.join(OUT,'02-combined.png'),fullPage:true});

    await page.click('#we-undo'); await page.waitForFunction(v=>window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.toArray().every((x,i)=>Math.abs(x-v[i])<1e-9),rotated.s,{timeout:120000}); const u1=await read(); assert(near(u1.r[1],RAD6,1e-12)&&vecNear(u1.p,POS),'undo scale broke prior transforms');
    await page.click('#we-undo'); await page.waitForFunction(()=>Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].rotation.y)<1e-12,null,{timeout:120000}); const u2=await read(); assert(vecNear(u2.p,POS),'undo rotation broke position');
    await page.click('#we-undo'); await page.waitForFunction(v=>window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.toArray().every((x,i)=>Math.abs(x-v[i])<1e-9),original.p,{timeout:120000}); const u3=await read(); assert(JSON.stringify(u3)===JSON.stringify(original),'three undos did not restore baseline');

    await page.click('#we-redo'); await page.waitForFunction(v=>window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].position.toArray().every((x,i)=>Math.abs(x-v[i])<1e-9),POS,{timeout:120000});
    await page.click('#we-redo'); await page.waitForFunction(v=>Math.abs(window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].rotation.y-v)<1e-12,RAD6,{timeout:120000});
    await page.click('#we-redo'); await page.waitForFunction(v=>window.__WESTEROS_WORLD_EDITOR__.editableObjects[0].scale.toArray().every((x,i)=>Math.abs(x-v[i])<1e-9),SCALE,{timeout:120000}); const redone=await read(); assert(redone.id===original.id&&vecNear(redone.p,POS)&&near(redone.r[1],RAD6,1e-12)&&vecNear(redone.s,SCALE),'redo chain drift');
    const status=await page.locator('#we-selection-status').textContent(); assert(status?.includes('yok'),'restore selection contract changed'); await page.locator('#we-hierarchy .we-hierarchy-item').first().click();
    const inspector=await page.evaluate(()=>({p:['we-pos-x','we-pos-y','we-pos-z'].map(id=>Number(document.getElementById(id).value)),r:Number(document.getElementById('we-rot-y').value),s:['we-scale-x','we-scale-y','we-scale-z'].map(id=>Number(document.getElementById(id).value))}));
    assert(vecNear(inspector.p,POS)&&near(inspector.r,DEG,0.0001)&&vecNear(inspector.s,SCALE),'Inspector mismatch after redo/reselect'); await page.screenshot({path:path.join(OUT,'03-redo-reselected.png'),fullPage:true}); assert(errors.length===0,`Browser errors: ${errors.join(' | ')}`);
    console.log(`[checkRun229EditorCombinedTransformHistory] PASS ${JSON.stringify({original,positioned,rotated,final,u1,u2,u3,redone,inspector,screenshots:3})}`);
  }finally{await context.close();await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(`[checkRun229EditorCombinedTransformHistory] FAIL: ${e.stack||e}`);process.exitCode=1;});
