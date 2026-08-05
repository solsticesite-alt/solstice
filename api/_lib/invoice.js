// Calcul des totaux d'une facture (source unique, utilisee par le PDF et l'e-mail).
// Reglement en deux temps : un acompte a la commande, le solde a la livraison.
const { toNumber } = require('./util');

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function computeInvoice(lines, depositPct) {
  const items = (Array.isArray(lines) ? lines : [])
    .map((l) => {
      const qty = toNumber(l && l.qty, 1);
      const unit = toNumber(l && l.unit, 0);
      const label = String((l && l.label) || '').slice(0, 200);
      return { label, qty, unit, total: round2(qty * unit) };
    })
    .filter((l) => l.label);
  const subtotal = round2(items.reduce((s, l) => s + l.total, 0));
  const dp = Math.min(100, Math.max(0, toNumber(depositPct, 50)));
  const deposit = round2((subtotal * dp) / 100);
  // Le solde se deduit du total pour eviter tout ecart d'arrondi d'un centime.
  const balance = round2(subtotal - deposit);
  return { items, subtotal, depositPct: dp, deposit, balance };
}

module.exports = { computeInvoice, round2 };
