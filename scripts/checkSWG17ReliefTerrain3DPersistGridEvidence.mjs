import fs from 'node:fs';
function need(ok,message){if(!ok)throw new Error(`SW G17 persisted-grid evidence: ${message}`);}
function arg(name){return process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);}
function metric(file){need(file&&fs.existsSync(file),`missing ${file||'path'}`);const text=fs.readFileSync(file,'utf8');need(text.includes('SW_G17_TERRAIN3D_RELIEF_PERSIST_GRID_OK'),'persist-grid success marker missing');const prefix='G17_TERRAIN3D_RELIEF_PERSIST_GRID_METRICS=';const line=text.split(/\r?\n/).find(v=>v.startsWith(prefix));need(line,'persist-grid metrics missing');return JSON.parse(line.slice(prefix.length));}
const a=metric(arg('log-a')),b=metric(arg('log-b'));
need(JSON.stringify(a)===JSON.stringify(b),`persist-grid metrics differ\nA=${JSON.stringify(a)}\nB=${JSON.stringify(b)}`);
need(a.samples===257*257,'full persisted grid sample count changed');
need(a.regionCount>=4,'persisted region count regressed');
need(a.maxHeightError<=0.012,'persisted full-grid height error exceeds contract');
need(a.maxHeight<-2.5&&a.maxHeight>a.minHeight,'persisted marine relief range invalid');
need(Number.isInteger(a.checksum)&&a.bakedVertices>0,'persisted checksum or LOD0 bake evidence missing');
console.log(`SW_G17_RELIEF_PERSIST_GRID_EVIDENCE_METRICS=${JSON.stringify(a)}`);
console.log('SW_G17_RELIEF_TERRAIN3D_PERSIST_GRID_EVIDENCE_OK');
