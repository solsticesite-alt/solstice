// Calcul des totaux d'un devis (source unique, utilisee par le PDF et l'e-mail).
const { toNumber } = require('./util');

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function computeQuote(lines, depositPct) {
  const items = (Array.isArray(lines) ? lines : [])
    .map((l) => {
      const qty = toNumber(l && l.qty, 1);
      const unit = toNumber(l && l.unit, 0);
      const label = String((l && l.label) || '').slice(0, 200);
      return { label, qty, unit, total: round2(qty * unit) };
    })
    .filter((l) => l.label);
  const subtotal = round2(items.reduce((s, l) => s + l.total, 0));
  const dp = toNumber(depositPct, 30);
  const deposit = round2((subtotal * dp) / 100);
  return { items, subtotal, depositPct: dp, deposit };
}

module.exports = { computeQuote, round2 };
