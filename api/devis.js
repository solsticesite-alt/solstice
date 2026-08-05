// POST public : reception d'une demande de devis depuis le site.
const { readJson, send, clean, cleanMultiline, isEmail, toNumber } = require('./_lib/util');
const store = require('./_lib/store');
const mail = require('./_lib/mail');

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return host ? `${proto}://${host}` : '';
}

function makeRef(settings, id, createdAt) {
  const year = new Date(createdAt).getFullYear();
  const prefix = String(settings.quotePrefix || 'D').replace(/[^A-Za-z0-9]/g, '') || 'D';
  return `${prefix}-${year}-${String(id).padStart(4, '0')}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }

  // Honeypot anti-spam : champ cache qui doit rester vide.
  if (clean(body.website, 100)) return send(res, 200, { ok: true, ref: null });

  const name = clean(body.name, 120);
  const email = clean(body.email, 160);
  const phone = clean(body.phone, 40);
  const eventType = clean(body.eventType, 80);
  const date = clean(body.date, 40);
  const location = clean(body.location, 160);
  const guests = clean(body.guests, 20);
  const message = cleanMultiline(body.message, 4000);
  // Reglement choisi par le client : acompte de 50 % ou paiement integral.
  const payment = body.payment === 'full' ? 'full' : 'deposit';

  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
  const items = rawItems.map((it) => ({
    name: clean(it && it.name, 160),
    ref: clean(it && it.ref, 80),
    qty: Math.min(999, Math.max(1, Math.round(toNumber(it && it.qty, 1)))),
    priceHint: clean(it && it.priceHint, 40)
  })).filter((it) => it.name);

  if (!name) return send(res, 400, { ok: false, error: 'name_required' });
  if (!isEmail(email)) return send(res, 400, { ok: false, error: 'email_invalid' });
  if (!message && !items.length) return send(res, 400, { ok: false, error: 'empty_request' });

  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });

  let settings;
  try { settings = await store.getSettings(); } catch (e) { settings = store.DEFAULT_SETTINGS; }

  let request;
  try {
    const id = await store.nextId();
    const createdAt = new Date().toISOString();
    request = {
      id, ref: makeRef(settings, id, createdAt), createdAt, status: 'new',
      client: { name, email, phone },
      event: { type: eventType, date, location, guests },
      message, items, payment, reply: null
    };
    await store.saveNewRequest(request);
  } catch (e) {
    return send(res, 500, { ok: false, error: 'store_error' });
  }

  // Notification e-mail au gérant (best effort : ne bloque pas la demande).
  try {
    if (mail.mailReady()) await mail.sendOwnerNotification(request, baseUrl(req));
  } catch (e) { /* la demande est enregistrée quand même */ }

  return send(res, 200, { ok: true, ref: request.ref });
};
