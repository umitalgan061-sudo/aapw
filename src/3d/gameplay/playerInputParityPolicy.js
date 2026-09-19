const DEVICE_KINDS = new Set(['keyboard', 'mouse', 'gamepad', 'touch', 'system']);
const ACTIONS = ['light', 'heavy', 'guard', 'parry', 'dodge', 'ranged', 'archery', 'lock-on'];
const DEFAULT_DEADZONE = 0.18;

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const normalizeToken = (value) => String(value ?? '').trim().toLowerCase();

const ALIASES = new Map([
  ['attack', 'light'],
  ['attack-light', 'light'],
  ['attack-heavy', 'heavy'],
  ['block', 'guard'],
  ['perfect-guard', 'parry'],
  ['roll', 'dodge'],
  ['bow', 'archery'],
  ['target-lock', 'lock-on'],
]);

const normalizeAction = (value) => {
  const token = normalizeToken(value);
  const action = ALIASES.get(token) ?? token;
  return ACTIONS.includes(action) ? action : null;
};

const normalizeAxis = (value, deadzone = DEFAULT_DEADZONE) => {
  const numeric = Number.isFinite(value) ? value : 0;
  const magnitude = Math.abs(numeric);
  if (magnitude <= deadzone) return 0;
  const sign = Math.sign(numeric);
  return sign * clamp01((magnitude - deadzone) / (1 - deadzone));
};

const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
};

export const PLAYER_INPUT_PARITY_SCHEMA = 'kizil-ufuk/player-input-parity@1';

export function createPlayerInputParityPolicy(options = {}) {
  const maxHistory = Math.max(1, Math.min(64, Math.trunc(options.maxHistory ?? 24)));
  const deadzone = clamp01(options.deadzone ?? DEFAULT_DEADZONE);
  const history = [];
  let lastSequence = -1;
  let disposed = false;

  const buildReceipt = (input = {}) => {
    if (disposed) return freezeDeep({ accepted: false, reason: 'disposed', schema: PLAYER_INPUT_PARITY_SCHEMA });
    const device = normalizeToken(input.device);
    const action = normalizeAction(input.action);
    const sequence = Number.isInteger(input.sequence) ? input.sequence : null;
    if (!DEVICE_KINDS.has(device)) return freezeDeep({ accepted: false, reason: 'invalid-device', schema: PLAYER_INPUT_PARITY_SCHEMA });
    if (!action) return freezeDeep({ accepted: false, reason: 'invalid-action', schema: PLAYER_INPUT_PARITY_SCHEMA });
    if (sequence === null || sequence <= lastSequence) {
      return freezeDeep({ accepted: false, reason: 'non-monotonic-sequence', schema: PLAYER_INPUT_PARITY_SCHEMA });
    }
    const normalized = {
      x: normalizeAxis(input.axis?.x, deadzone),
      y: normalizeAxis(input.axis?.y, deadzone),
      pressed: Boolean(input.pressed),
      repeat: Boolean(input.repeat),
    };
    lastSequence = sequence;
    const receipt = {
      accepted: true,
      schema: PLAYER_INPUT_PARITY_SCHEMA,
      sequence,
      device,
      action,
      normalized,
      parityKey: `${action}:${normalized.pressed ? 'pressed' : 'released'}:${normalized.repeat ? 'repeat' : 'edge'}`,
    };
    history.push(receipt);
    if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
    return freezeDeep(receipt);
  };

  return {
    ingest(input) { return buildReceipt(input); },
    snapshot() {
      return freezeDeep({ schema: PLAYER_INPUT_PARITY_SCHEMA, lastSequence, history: history.slice() });
    },
    reset(sequence = -1) {
      if (!Number.isInteger(sequence) || sequence < -1) return false;
      lastSequence = sequence;
      history.length = 0;
      return true;
    },
    dispose() {
      disposed = true;
      history.length = 0;
    },
    validate(receipt) {
      return Boolean(receipt?.accepted && receipt.schema === PLAYER_INPUT_PARITY_SCHEMA && ACTIONS.includes(receipt.action) && DEVICE_KINDS.has(receipt.device));
    },
  };
}
