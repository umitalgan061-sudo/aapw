import fs from 'node:fs';
function need(ok,message){if(!ok)throw new Error(`SW G17 LOD evidence: ${message}`);}
function arg(name){return process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);}
function metric(file){need(file&&fs.existsSync(file),`missing ${file||'path'}`);const text=fs.readFileSync(file,'utf8');need(text.includes('SW_G17_TERRAIN3D_RELIEF_LOD_OK'),'LOD success marker missing');const prefix='G17_TERRAIN3D_RELIEF_LOD_METRICS=';const line=text.split(/\r?\n/).find(v=>v.startsWith(prefix));need(line,'LOD metrics missing');return JSON.parse(line.slice(prefix.length));}
const a=metric(arg('log-a')),b=metric(arg('log-b'));
need(JSON.stringify(a)===JSON.stringify(b),`LOD metrics differ\nA=${JSON.stringify(a)}\nB=${JSON.stringify(b)}`);
need(a.terrain3dVersion?.startsWith('1.0.2'),'Terrain3D pin changed');
need(a.regionCount>=4&&a.heightMaps>=4&&a.controlMaps>=4&&a.colorMaps>=4,'Terrain3D region/map evidence regressed');
need(Array.isArray(a.levels)&&a.levels.length===3,'LOD level count changed');
for(let i=0;i<a.levels.length;i+=1){const level=a.levels[i];need(level.lod===i&&level.surfaces>0&&level.vertices>0,'LOD mesh evidence invalid');need(level.maxHeight>level.minHeight,'LOD relief collapsed');need(Number.isInteger(level.checksum),'LOD checksum missing');if(i)need(level.vertices<a.levels[i-1].vertices,'LOD vertex decimation regressed');}
console.log(`SW_G17_RELIEF_LOD_EVIDENCE_METRICS=${JSON.stringify(a)}`);
console.log('SW_G17_RELIEF_TERRAIN3D_LOD_EVIDENCE_OK');
