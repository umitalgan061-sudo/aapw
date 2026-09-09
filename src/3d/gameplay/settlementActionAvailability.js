/**
 * Settlement action availability contract.
 * Read-only preflight for the existing settlementCampaignRuntime authority.
 */
const ACTIONS = Object.freeze(['enter','exit','interact','talk','trade','buy','sell','craft','equip','acceptQuest','advanceQuest','travel','rest','train','save']);
const SERVICE_BY_ACTION = Object.freeze({enter:'gate',exit:'gate',travel:'gate',trade:'market',buy:'market',sell:'market',craft:'blacksmith',equip:'blacksmith',talk:'tavern',rest:'tavern',acceptQuest:'tavern',advanceQuest:'tavern',train:'barracks',interact:'house',save:'house'});
const text = (v, fallback='') => { const s = String(v ?? '').trim(); return s ? s.slice(0,160) : fallback; };
const num = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min, max, fallback=min) => Math.max(min, Math.min(max, num(v, fallback)));
const stable = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().map((k)=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
const digest = (v) => { let h = 2166136261; for (const c of stable(v)) { h ^= c.charCodeAt(0); h = Math.imul(h,16777619); } return (h>>>0).toString(16).padStart(8,'0'); };
const deepFreeze = (value) => { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; };
const normalize = (raw={}) => { const s = raw && typeof raw === 'object' ? raw : {}; return { inside: Boolean(s.inside ?? s.inSettlement), defeated: Boolean(s.defeated ?? s.playerDefeated), saveEnabled: s.saveEnabled !== false, copper: clamp(s.copper,0,999999), fatigue: clamp(s.fatigue,0,100), health: clamp(s.health,0,100), activeService: text(s.activeService), services: new Set(Array.isArray(s.services) ? s.services.map(text) : []), capabilities: new Set(Array.isArray(s.capabilities) ? s.capabilities.map(text) : []) }; };
function reasonFor(action, snapshot) {
  if (!ACTIONS.includes(action)) return 'unknown-action';
  if (snapshot.defeated && !['save','exit'].includes(action)) return 'player-defeated';
  if (!snapshot.inside && !['enter','save'].includes(action)) return 'outside-settlement';
  if (action === 'save' && !snapshot.saveEnabled) return 'save-disabled';
  if (snapshot.health <= 0 && action !== 'save') return 'health-empty';
  const service = SERVICE_BY_ACTION[action];
  if (service && snapshot.services.size && !snapshot.services.has(service)) return 'service-unavailable';
  if (action !== 'enter' && snapshot.capabilities.size && !snapshot.capabilities.has(action)) return 'capability-missing';
  return '';
}
export function buildSettlementActionAvailability(rawSnapshot = {}, requestedActions = ACTIONS) {
  const snapshot = normalize(rawSnapshot);
  const actions = [...new Set((Array.isArray(requestedActions) ? requestedActions : ACTIONS).map(text).filter(Boolean))].slice(0, 24);
  const rows = actions.map((action) => { const reason = reasonFor(action, snapshot); return { action, service: text(SERVICE_BY_ACTION[action]), available: !reason, reason }; });
  const payload = { version: 1, context: { inside: snapshot.inside, defeated: snapshot.defeated, saveEnabled: snapshot.saveEnabled, copper: snapshot.copper, fatigue: snapshot.fatigue, health: snapshot.health, activeService: snapshot.activeService }, rows, available: rows.filter((r)=>r.available).map((r)=>r.action), blocked: rows.filter((r)=>!r.available).map((r)=>({ action:r.action, reason:r.reason })), digest: '' };
  payload.digest = digest(payload); return deepFreeze(payload);
}
export function serializeSettlementActionAvailability(value) { return stable(value); }
