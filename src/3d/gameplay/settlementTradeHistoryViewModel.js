/**
 * Read-only UI view model for settlement trade history.
 * Keeps formatting deterministic and leaves trade/economy authority external.
 */

const LABELS = Object.freeze({
  buy: 'Buy',
  sell: 'Sell',
  successful: 'Successful',
  failed: 'Failed',
});

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const kind = entry.kind === 'buy' || entry.kind === 'sell' ? entry.kind : null;
  const subject = typeof entry.subject === 'string' ? entry.subject.trim() : '';
  if (!kind || !subject) return null;
  return Object.freeze({
    kind,
    subject,
    quantity: Math.max(0, finiteInteger(entry.quantity)),
    copper: Math.max(0, finiteInteger(entry.copper)),
    ok: entry.ok === true,
    reason: typeof entry.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : null,
    message: typeof entry.message === 'string' && entry.message.trim() ? entry.message.trim() : null,
  });
}

function formatEntry(entry) {
  const state = entry.ok ? LABELS.successful : LABELS.failed;
  const amount = entry.ok ? `${entry.copper} copper` : (entry.reason || 'Trade failed');
  return `${LABELS[entry.kind]} · ${entry.subject} ×${entry.quantity} · ${state} · ${amount}`;
}

export function createSettlementTradeHistoryViewModel(history) {
  const source = history && typeof history.list === 'function' ? history.list() : [];
  const entries = Object.freeze(source.map(normalizeEntry).filter(Boolean));
  const successful = entries.filter((entry) => entry.ok);
  const failed = entries.filter((entry) => !entry.ok);
  const view = Object.freeze({
    rows: Object.freeze(entries.map((entry) => Object.freeze({ ...entry, label: formatEntry(entry) }))),
    totals: Object.freeze({
      trades: entries.length,
      successful: successful.length,
      failed: failed.length,
      copper: successful.reduce((sum, entry) => sum + entry.copper, 0),
      quantity: successful.reduce((sum, entry) => sum + entry.quantity, 0),
    }),
    empty: entries.length === 0,
  });
  return view;
}
