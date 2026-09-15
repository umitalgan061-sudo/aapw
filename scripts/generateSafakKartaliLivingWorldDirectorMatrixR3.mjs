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

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'artifacts', 'safak-kartali-living-world-director-matrix-r3.jsonl');
const bands = Object.freeze([0.05, 0.3, 0.65, 0.92]);
const socialBands = Object.freeze([0.1, 0.35, 0.7, 0.95]);
const scarcityBands = Object.freeze([0.05, 0.4, 0.72, 0.96]);
const dimensions = DIRECTOR_SCENARIO_ROLES.length * DIRECTOR_SCENARIO_CONTEXTS.length * bands.length ** 4;

function round(value) {
  return Number(Number(value).toFixed(6));
}

function makeCase(role, context, u, t, s, c, index) {
  const request = buildScenarioRequest({
    role,
    context,
    urgency: bands[u],
    threat: bands[t],
    socialNeed: socialBands[s],
    scarcity: scarcityBands[c],
    fatigue: round((u * 0.17 + c * 0.11) % 1),
    travelRisk: round((t * 0.19 + s * 0.13) % 1),
    distanceMeters: 40 + ((index * 137) % 4920),
    waitingSeconds: (index * 7) % 96,
    requestId: `r3-${index}-${role}-${context}-${u}${t}${s}${c}`,
  });
  const result = scoreScenarioRequest(request, index);
  return {
    caseId: request.requestId,
    role,
    context,
    inputs: request,
    expected: {
      accepted: result.accepted,
      score: result.score,
      tier: result.accepted ? expectedScenarioTier(result.score) : 'off',
      protected: Boolean(result.protected),
    },
    policyFingerprint: policyFingerprint(),
  };
}

function buildCases() {
  const cases = [];
  let index = 0;
  for (const role of DIRECTOR_SCENARIO_ROLES) {
    for (const context of DIRECTOR_SCENARIO_CONTEXTS) {
      for (let u = 0; u < bands.length; u += 1) {
        for (let t = 0; t < bands.length; t += 1) {
          for (let s = 0; s < bands.length; s += 1) {
            for (let c = 0; c < bands.length; c += 1) {
              cases.push(makeCase(role, context, u, t, s, c, index));
              index += 1;
            }
          }
        }
      }
    }
  }
  return cases;
}

const cases = buildCases();
if (cases.length !== dimensions) throw new Error(`matrix size mismatch ${cases.length} != ${dimensions}`);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
const lines = [
  JSON.stringify({ schema: 'safak-kartali-director-matrix-r3', version: 3, dimensions, cases: cases.length, policyFingerprint: policyFingerprint() }),
  ...cases.map((item) => JSON.stringify(item)),
];
fs.writeFileSync(OUTPUT, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, output: OUTPUT, cases: cases.length, rows: lines.length, policyFingerprint: policyFingerprint() }));
