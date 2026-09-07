import fs from 'node:fs';

const source = fs.readFileSync('src/3d/gameplay/npc.js', 'utf8');
const requiredStates = ['patrol', 'investigate', 'chase', 'attack', 'return', 'flee'];
const missingStates = requiredStates.filter((state) => !new RegExp(`\\b${state}\\b`, 'i').test(source));
const boundedTick = /(?:tick|update)[^(]*\([^)]*delta|delta[^;]*(?:Math\.min|Math\.max|0\.1|0\.25)/i.test(source);
const deterministicSeed = /(seed|determin|hash|stable)/i.test(source);
if (missingStates.length || !boundedTick || !deterministicSeed) {
  console.error(JSON.stringify({ missingStates, boundedTick, deterministicSeed }));
  process.exit(1);
}
console.log(JSON.stringify({ NPC_STATE_TRANSITION_CONTRACT: 'PASS', states: requiredStates, boundedTick, deterministicSeed }));
