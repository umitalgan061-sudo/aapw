const ACTIONS = Object.freeze(['lightAttack','heavyAttack','block','parry','dodge','lockOn']);
const DEFAULTS = Object.freeze({bufferWindowMs:220,maxQueueSize:8,staleAfterMs:450});
const finite = (value, fallback=0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const freezeIntent = (intent) => Object.freeze({...intent});

export function createPlayerCombatIntentBuffer(options={}) {
  const config = Object.freeze({
    bufferWindowMs: clamp(finite(options.bufferWindowMs, DEFAULTS.bufferWindowMs), 0, 1000),
    maxQueueSize: Math.max(1, Math.floor(clamp(finite(options.maxQueueSize, DEFAULTS.maxQueueSize), 1, 32))),
    staleAfterMs: Math.max(0, finite(options.staleAfterMs, DEFAULTS.staleAfterMs)),
  });
  const queue = [];
  let sequence = 0;

  function push(action, nowMs=0, payload={}) {
    if (!ACTIONS.includes(action)) return Object.freeze({accepted:false,reason:'unsupported-action'});
    const now = Math.max(0, finite(nowMs));
    const intent = freezeIntent({
      action,
      pressedAtMs: now,
      expiresAtMs: now + config.bufferWindowMs,
      sequence: ++sequence,
      payload: payload && typeof payload === 'object' ? Object.freeze({...payload}) : Object.freeze({}),
    });
    queue.push(intent);
    while (queue.length > config.maxQueueSize) queue.shift();
    return Object.freeze({accepted:true,intent});
  }

  function consume(nowMs=0, predicate=()=>true) {
    const now = Math.max(0, finite(nowMs));
    for (let index=0; index<queue.length; index += 1) {
      const intent = queue[index];
      if (now > intent.expiresAtMs || now - intent.pressedAtMs > config.staleAfterMs) {
        queue.splice(index,1); index -= 1; continue;
      }
      if (predicate(intent)) {
        queue.splice(index,1);
        return intent;
      }
    }
    return null;
  }

  function peek(nowMs=0) {
    const now = Math.max(0, finite(nowMs));
    while (queue.length && (now > queue[0].expiresAtMs || now - queue[0].pressedAtMs > config.staleAfterMs)) queue.shift();
    return queue[0] ?? null;
  }

  function clear() { queue.length = 0; }
  function snapshot(nowMs=0) {
    const now = Math.max(0, finite(nowMs));
    return Object.freeze({
      nowMs: now,
      size: queue.length,
      queued: Object.freeze(queue.filter((intent) => now <= intent.expiresAtMs && now - intent.pressedAtMs <= config.staleAfterMs).map(freezeIntent)),
      config,
    });
  }
  return Object.freeze({config,push,consume,peek,clear,snapshot});
}

export { ACTIONS as PLAYER_COMBAT_INTENT_ACTIONS };