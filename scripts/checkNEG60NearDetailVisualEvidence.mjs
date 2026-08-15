#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { buildG60Terrain3DNearDetailProbe, measureG60Terrain3DNearDetail } from '../godot/terrain-authoring/geocells/ne/g60_near_detail.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=process.argv.find((value)=>value.startsWith('--out-dir='));
const OUT=path.resolve(ROOT,arg?arg.slice(10):'artifacts/ne-g60-near-detail-visual');
const requireOk=(ok,message)=>{if(!ok)throw new Error(message);};
const sha256=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
const probe=buildG60Terrain3DNearDetailProbe(),metrics=measureG60Terrain3DNearDetail();
requireOk(metrics.canonicalWaterCells===96&&metrics.canonicalLandCells===0,'G60 visual proof requires 96/96 open sea');
requireOk(metrics.maxHeightDelta===0&&metrics.maxControlDelta===0&&metrics.maxRoadPathDelta===0&&metrics.maxFoliageDensity===0,'Near Detail changed prior layers');

const playwright=devServerHelper.loadPlaywright();requireOk(Boolean(playwright),'Playwright is required');
fs.mkdirSync(OUT,{recursive:true});
const server=await devServerHelper.startStaticServer();const {port}=server.address();
const browser=await playwright.chromium.launch({headless:true});const hashes={};
try{
  const page=await browser.newPage({viewport:{width:960,height:640}});
  const pageErrors=[],consoleErrors=[];
  page.on('pageerror',(error)=>pageErrors.push(String(error)));
  page.on('console',(message)=>{if(message.type()==='error')consoleErrors.push(message.text());});
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded',timeout:20000});
  const perspective=await page.evaluate(async({source})=>{
    const THREE=await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML='<canvas id="proof" width="960" height="640"></canvas>';document.body.style.margin='0';
    const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#proof'),antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(960,640,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x071722);
    const camera=new THREE.PerspectiveCamera(48,1.5,1,5000),positions=[],colors=[],indices=[];let minTint=1,maxTint=0,minRoughness=1,maxRoughness=0;
    const size=source.sourceGridSize;
    for(let y=0;y<size;y+=1)for(let x=0;x<size;x+=1){
      const s=source.rows[y][x];positions.push((x/(size-1)-0.5)*1200,s[0]*8,(y/(size-1)-0.5)*760);
      colors.push(s[2],s[3],s[4]);minTint=Math.min(minTint,s[2],s[3],s[4]);maxTint=Math.max(maxTint,s[2],s[3],s[4]);
      minRoughness=Math.min(minRoughness,s[5]);maxRoughness=Math.max(maxRoughness,s[5]);
    }
    for(let y=0;y<size-1;y+=1)for(let x=0;x<size-1;x+=1){const a=y*size+x,b=a+1,c=a+size,d=c+1;indices.push(a,c,b,b,c,d);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.87,metalness:0,side:THREE.DoubleSide});
    scene.add(new THREE.Mesh(geometry,material));scene.add(new THREE.HemisphereLight(0xd8efff,0x10222a,2));
    const sun=new THREE.DirectionalLight(0xffefd4,2.2);sun.position.set(-420,720,-360);scene.add(sun);
    window.__proof={render(kind){camera.position.set(kind==='near'?-330:0,kind==='near'?220:930,kind==='near'?470:1280);camera.lookAt(0,-40,0);renderer.render(scene,camera);},dispose(){geometry.dispose();material.dispose();renderer.dispose();}};
    window.__proof.render('near');return{vertices:positions.length/3,triangles:indices.length/3,minTint,maxTint,minRoughness,maxRoughness};
  },{source:probe});
  requireOk(perspective.maxTint-perspective.minTint>=0.018&&perspective.maxRoughness-perspective.minRoughness>=0.06,'near/far proof lost microvariation');
  for(const kind of ['near','far']){
    await page.evaluate((k)=>window.__proof.render(k),kind);const png=await page.locator('#proof').screenshot();
    requireOk(png.length>1024,`${kind} PNG unexpectedly small`);fs.writeFileSync(path.join(OUT,`g60-near-detail-${kind}.png`),png);hashes[kind]=sha256(png);
  }
  requireOk(hashes.near!==hashes.far,'near/far frames unexpectedly identical');await page.evaluate(()=>window.__proof.dispose());

  await page.setViewportSize({width:1200,height:800});
  const topdown=await page.evaluate(async()=>{
    const {sampleReferencePindexQualityV2}=await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    document.body.innerHTML='<canvas id="world" width="1200" height="800"></canvas>';
    const canvas=document.querySelector('#world'),ctx=canvas.getContext('2d',{alpha:false}),low=document.createElement('canvas');low.width=600;low.height=400;
    const lctx=low.getContext('2d',{alpha:false}),image=lctx.createImageData(600,400),palette={sea:[41,77,93],lake:[79,127,134],soil:[125,135,88],rock:[117,108,96],snow:[216,223,220]};
    let transitionEdges=0,maxAdjacentChannelDelta=0,previousSurface=null,previousRgb=null;
    for(let y=0;y<400;y+=1){const surfaceRow=[],rgbRow=[];
      for(let x=0;x<600;x+=1){const s=sampleReferencePindexQualityV2((x+0.5)/600,(y+0.5)/400);surfaceRow.push(s.dominantSurface);
        if(x&&surfaceRow[x-1]!==surfaceRow[x])transitionEdges+=1;if(previousSurface&&previousSurface[x]!==surfaceRow[x])transitionEdges+=1;
        let r=0,g=0,b=0;for(const [name,color] of Object.entries(palette)){const w=s.surfaceWeights[name];r+=color[0]*w;g+=color[1]*w;b+=color[2]*w;}
        const rgb=[Math.round(r),Math.round(g),Math.round(b)];rgbRow.push(rgb);image.data.set([...rgb,255],(y*600+x)*4);
        for(const other of [x?rgbRow[x-1]:null,previousRgb?.[x]])if(other)maxAdjacentChannelDelta=Math.max(maxAdjacentChannelDelta,...rgb.map((v,i)=>Math.abs(v-other[i])));
      }previousSurface=surfaceRow;previousRgb=rgbRow;
    }
    lctx.putImageData(image,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(low,0,0,1200,800);
    return{mode:'continuous-semantic-world-context',transitionEdges,maxAdjacentChannelDelta,g60PatchApplied:false,g60PatchAlpha:0,gridOverlay:false};
  });
  requireOk(topdown.transitionEdges>100,'full-world geography transitions disappeared');
  requireOk(!topdown.g60PatchApplied&&topdown.g60PatchAlpha===0&&!topdown.gridOverlay,'Near Detail created a G60 square/grid patch');
  requireOk(topdown.maxAdjacentChannelDelta<=16,`full-world semantic context became blocky: ${topdown.maxAdjacentChannelDelta}`);
  const worldPng=await page.locator('#world').screenshot();requireOk(worldPng.length>4096,'full-world PNG unexpectedly small');
  fs.writeFileSync(path.join(OUT,'g60-near-detail-full-world.png'),worldPng);hashes.fullWorld=sha256(worldPng);
  requireOk(pageErrors.length===0&&consoleErrors.length===0,`browser errors: ${[...pageErrors,...consoleErrors].join(' | ')}`);
  const out={sourceMapSha256:probe.sourceMapSha256,metrics,perspective,topdown,sha256:hashes};
  fs.writeFileSync(path.join(OUT,'g60-near-detail-visual-metrics.json'),`${JSON.stringify(out,null,2)}\n`);
  console.log(`G60_NEAR_DETAIL_VISUAL_METRICS=${JSON.stringify(out)}`);console.log('NE_G60_NEAR_DETAIL_VISUAL_EVIDENCE_OK');
}finally{await browser.close();await new Promise((resolve)=>server.close(resolve));}
