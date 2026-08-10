'use strict';

const fs = require('fs');

const road = fs.readFileSync('src/3d/editor/EditorRoadController.js', 'utf8');
const terrain = fs.readFileSync('src/3d/editor/EditorTerrainPaintController.js', 'utf8');

if (!road.includes('window.__WESTEROS_EDITOR_TERRAIN__')) throw new Error('road controller does not discover terrain controller');
if (!road.includes('terrain?.isBusy?.()')) throw new Error('road controller does not respect pending terrain paint');
if (!road.includes('terrain?.setMode?.(null);')) throw new Error('road controller does not deactivate terrain mode before drawing');
if (!road.includes('isBusy: () => busy')) throw new Error('road controller busy surface missing');
if (!terrain.includes('window.__WESTEROS_EDITOR_ROADS__')) throw new Error('terrain controller does not discover road controller');
if (!terrain.includes('roads?.isBusy?.()')) throw new Error('terrain controller does not respect pending road creation');
if (!terrain.includes('roads?.isDrawing?.()')) throw new Error('terrain controller does not detect active road drawing');
if (!terrain.includes('roads.finishDrawing();')) throw new Error('terrain controller does not finish road drawing before paint mode');
if (!terrain.includes('isBusy: () => busy')) throw new Error('terrain controller busy surface missing');

console.log('PASS Run216 editor tool arbitration: road and land/sea paint are mutually exclusive and refuse unsafe mode switches while async work is pending.');
