import {
  DIRECTOR_SCENARIO_ROLES,
  DIRECTOR_SCENARIO_CONTEXTS,
  buildScenarioRequest,
  scoreScenarioRequest,
  expectedScenarioTier,
  policyFingerprint,
} from '../src/3d/gameplay/livingWorldDirectorScenarioPolicy.js';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT = path.join(process.cwd(), 'artifacts', 'safak-kartali-living-world-director-matrix-r3.jsonl');
const signalBands = Object.freeze([0.05, 0.3, 0.65, 0.92]);
const socialBands = Object.freeze([0.1, 0.9]);
const scarcityBands = Object.freeze([0.1, 0.9]);
const expectedRows = DIRECTOR_SCENARIO_ROLES.length * DIRECTOR_SCENARIO_CONTEXTS.length * signalBands.length * signalBands.length * socialBands.length * scarcityBands.length;

const round = (value) => Number(Number(value).toFixed(6));

function buildCase(role, context, urgency, threat, social, scarcity, index) {
  const request = buildScenarioRequest({
    role,
    context,
    urgency: signalBands[urgency],
    threat: signalBands[threat],
    socialNeed: socialBands[social],
    scarcity: scarcityBands[scarcity],
    fatigue: round((index * 7 % 5) / 10),
    travelRisk: round((index * 11 % 6) / 10),
    distanceMeters: 25 + ((index * 173) % 4975),
    waitingSeconds: (index * 13) % 91,
    requestId: `r3b-${index}-${role}-${context}-${urgency}${threat}${social}${scarcity}`,
  });
  const result = scoreScenarioRequest(request, index);
  return {
    caseId: request.requestId,
    index,
    role,
    context,
    inputs: request,
    expected: {
      accepted: result.accepted,
      score: result.score,
      tier: result.accepted ? expectedScenarioTier(result.score) : 'off',
      protected: Boolean(result.protected),
      reasons: result.reasons,
    },
    policyFingerprint: policyFingerprint(),
  };
}

const cases = [];
let index = 0;
for (const role of DIRECTOR_SCENARIO_ROLES) {
  for (const context of DIRECTOR_SCENARIO_CONTEXTS) {
    for (let urgency = 0; urgency < signalBands.length; urgency += 1) {
      for (let threat = 0; threat < signalBands.length; threat += 1) {
        for (let social = 0; social < socialBands.length; social += 1) {
          for (let scarcity = 0; scarcity < scarcityBands.length; scarcity += 1) {
            cases.push(buildCase(role, context, urgency, threat, social, scarcity, index));
            index += 1;
          }
        }
      }
    }
  }
}

if (cases.length !== expectedRows || expectedRows !== 4096) {
  throw new Error(`unexpected matrix size ${cases.length}; expected ${expectedRows} and 4096`);
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
const rows = [
  JSON.stringify({ schema: 'safak-kartali-director-matrix-r3b', version: 3.1, dimensions: expectedRows, cases: cases.length, policyFingerprint: policyFingerprint() }),
  ...cases.map((item) => JSON.stringify(item)),
];
fs.writeFileSync(OUTPUT, `${rows.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, output: OUTPUT, cases: cases.length, rows: rows.length, policyFingerprint: policyFingerprint() }));
