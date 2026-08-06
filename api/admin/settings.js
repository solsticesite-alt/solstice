const { readJson, send, clean, cleanMultiline, toNumber } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');

module.exports = async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });

  if (req.method === 'GET') {
    try { return send(res, 200, { ok: true, settings: await store.getSettings() }); }
    catch (e) { return send(res, 500, { ok: false, error: 'store_error' }); }
  }

  if (req.method === 'POST') {
    let b;
    try { b = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }
    const s = {
      companyName: clean(b.companyName, 160),
      legalForm: clean(b.legalForm, 120),
      siret: clean(b.siret, 60),
      address: clean(b.address, 200),
      postcode: clean(b.postcode, 12),
      city: clean(b.city, 80),
      email: clean(b.email, 160),
      phone: clean(b.phone, 40),
      website: clean(b.website, 160),
      tvaMention: clean(b.tvaMention, 160),
      quotePrefix: clean(b.quotePrefix, 8),
      signature: cleanMultiline(b.signature, 600),
      depositPct: Math.min(100, Math.max(0, Math.round(toNumber(b.depositPct, 30)))),
      cautionNote: cleanMultiline(b.cautionNote, 600),
      conditions: cleanMultiline(b.conditions, 2000)
    };
    try { return send(res, 200, { ok: true, settings: await store.saveSettings(s) }); }
    catch (e) { return send(res, 500, { ok: false, error: 'store_error' }); }
  }

  return send(res, 405, { ok: false, error: 'method_not_allowed' });
};
