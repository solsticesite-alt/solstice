// POST admin : compose + envoie la facture (PDF + e-mail) au client.
const { readJson, send, clean, cleanMultiline, toNumber } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');
const mail = require('../_lib/mail');
const { buildFacturePdf } = require('../_lib/pdf');
const { computeInvoice } = require('../_lib/invoice');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  if (!auth.requireAdmin(req, res)) return;
  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });
  if (!mail.mailReady()) return send(res, 503, { ok: false, error: 'mail_not_configured' });

  let b;
  try { b = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }

  const id = parseInt(b.id, 10);
  if (!id) return send(res, 400, { ok: false, error: 'id_required' });

  let request;
  try { request = await store.getRequest(id); } catch (e) { return send(res, 500, { ok: false, error: 'store_error' }); }
  if (!request) return send(res, 404, { ok: false, error: 'not_found' });

  const client = request.client || {};
  if (!client.email) return send(res, 400, { ok: false, error: 'no_client_email' });

  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 100)
    .map((l) => ({ label: clean(l && l.label, 200), qty: Math.max(0, toNumber(l && l.qty, 1)), unit: Math.max(0, toNumber(l && l.unit, 0)) }))
    .filter((l) => l.label);
  if (!lines.length) return send(res, 400, { ok: false, error: 'no_lines' });

  let settings;
  try { settings = await store.getSettings(); } catch (e) { settings = store.DEFAULT_SETTINGS; }

  const depositPct = Math.min(100, Math.max(0, Math.round(toNumber(b.depositPct, settings.depositPct))));
  const sentAt = new Date().toISOString();

  const reply = {
    invoiceNumber: clean(b.invoiceNumber || b.quoteNumber, 40) || request.ref,
    message: cleanMultiline(b.message, 4000),
    lines,
    notes: cleanMultiline(b.notes, 1000),
    depositPct, sentAt
  };

  const q = computeInvoice(lines, depositPct);

  let pdf;
  try { pdf = await buildFacturePdf(request, settings, reply); }
  catch (e) { return send(res, 500, { ok: false, error: 'pdf_error' }); }

  try { await mail.sendFactureEmail(request, settings, reply, pdf); }
  catch (e) { return send(res, 502, { ok: false, error: 'mail_error', detail: String((e && e.message) || e).slice(0, 200) }); }

  request.reply = Object.assign({}, reply, { subtotal: q.subtotal, deposit: q.deposit, balance: q.balance });
  request.status = 'replied';
  try { await store.updateRequest(request); } catch (e) { /* e-mail envoye ; persistance echouee */ }

  return send(res, 200, { ok: true, ref: request.ref, total: q.subtotal });
};
