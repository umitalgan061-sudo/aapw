const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value)));

export const LIVING_WORLD_THREAT_DECISION_POLICY = freeze({
  id: 'living-world-threat-decision-policy-2026-09-08-v1',
  deterministic: true,
  bounded: true,
  supportedStates: freeze(['patrol', 'detect', 'investigate', 'chase', 'attack', 'return', 'flee']),
});

const normalizeState = (value) => {
  const state = String(value || 'patrol').toLowerCase();
  return LIVING_WORLD_THREAT_DECISION_POLICY.supportedStates.includes(state) ? state : 'patrol';
};

export function decideLivingWorldThreat({
  currentState = 'patrol',
  visualConfidence = 0,
  hearingConfidence = 0,
  stealth = 0,
  distanceMeters = Infinity,
  attackRangeMeters = 2.5,
  chaseRangeMeters = 24,
  investigateRangeMeters = 60,
  allyCount = 0,
  healthRatio = 1,
  threatRatio = 1,
  hasLineOfSight = false,
  hasRecentContact = false,
} = {}) {
  const state = normalizeState(currentState);
  const visual = clamp(visualConfidence);
  const hearing = clamp(hearingConfidence);
  const stealthFactor = 1 - clamp(stealth);
  const confidence = clamp(Math.max(visual, hearing) * stealthFactor);
  const distance = Math.max(0, finite(distanceMeters, Number.POSITIVE_INFINITY));
  const allies = Math.max(0, Math.floor(finite(allyCount)));
  const health = clamp(healthRatio);
  const threat = clamp(threatRatio);
  const contact = Boolean(hasRecentContact);
  const los = Boolean(hasLineOfSight);
  const canAttack = distance <= Math.max(0, finite(attackRangeMeters, 2.5)) && (los || contact);
  const canChase = distance <= Math.max(0, finite(chaseRangeMeters, 24)) && confidence >= 0.35;
  const canInvestigate = distance <= Math.max(0, finite(investigateRangeMeters, 60)) && confidence >= 0.12;
  const outnumbered = threat > 0 && allies === 0 && health < 0.3 && threat > health + 0.25;

  let nextState = 'return';
  if (outnumbered) nextState = 'flee';
  else if (canAttack) nextState = 'attack';
  else if (canChase) nextState = 'chase';
  else if (canInvestigate) nextState = 'investigate';
  else if (state === 'patrol' || state === 'return') nextState = state;

  const reason = nextState === 'attack' ? 'contact-in-attack-range'
    : nextState === 'chase' ? 'credible-threat-in-chase-range'
      : nextState === 'investigate' ? 'weak-signal-in-investigate-range'
        : nextState === 'flee' ? 'low-health-outnumbered'
          : nextState === 'patrol' ? 'no-active-signal'
            : 'signal-lost-return';

  return freeze({
    policyId: LIVING_WORLD_THREAT_DECISION_POLICY.id,
    currentState: state,
    nextState,
    reason,
    confidence,
    channels: freeze({ visual, hearing, stealth: clamp(stealth), lineOfSight: los, recentContact: contact }),
    distanceMeters: distance,
    bounded: true,
  });
}

export function summarizeLivingWorldThreatDecisions(decisions = [], maxItems = 64) {
  const boundedMax = Math.max(0, Math.min(128, Math.floor(finite(maxItems, 64))));
  const items = Array.from(decisions || []).slice(0, boundedMax).map((decision) => freeze({
    actorId: String(decision?.actorId || ''),
    currentState: normalizeState(decision?.currentState),
    nextState: normalizeState(decision?.nextState),
    reason: String(decision?.reason || 'unknown'),
  }));
  return freeze({ policyId: LIVING_WORLD_THREAT_DECISION_POLICY.id, count: items.length, items: freeze(items) });
}
