import fs from 'node:fs';
import path from 'node:path';
import { buildG17RockSnowControlProbe } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow_control_probe.mjs';

const out = process.argv[2] || 'godot/terrain-authoring/.terrain3d-proof/g17-rock-snow-probe.json';
const probe = buildG17RockSnowControlProbe();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(probe)}\n`);
console.log(`SW_G17_ROCK_SNOW_TERRAIN3D_PROBE=${out}`);
