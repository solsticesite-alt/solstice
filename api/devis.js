// POST public : reception d'une demande de reservation depuis le site.
// La route garde son nom historique : elle est appelee par cart.js et panier.js.
const { readJson, send, clean, cleanMultiline, isEmail, toNumber } = require('./_lib/util');
const store = require('./_lib/store');
const mail = require('./_lib/mail');
const frein = require('./_lib/ratelimit');

const DOMAINE = 'maison-solstice.fr';

// L'en-tete Host vient du client : quiconque envoyait une demande avec
// « X-Forwarded-Host: evil.test » faisait pointer le bouton « Ouvrir le
// back-office » du mail de notification vers son propre site. On n'accepte
// donc que des hotes connus, et a defaut on retombe sur le domaine.
function baseUrl(req) {
  const declare = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(declare)) return declare;

  const brut = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '')
    .split(',')[0].trim().toLowerCase();
  const host = brut.split(':')[0];
  const connu =
    host === DOMAINE ||
    host === 'www.' + DOMAINE ||
    /^[a-z0-9-]+\.vercel\.app$/.test(host); // deploiements de preversion

  return 'https://' + (connu ? brut : DOMAINE);
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

  // Chaque demande coute une ligne en base et un e-mail : on compte apres avoir
  // valide le formulaire, pour qu'une faute de frappe corrigee ne consomme rien,
  // et avant d'ecrire quoi que ce soit.
  try {
    const trop = await frein.formulaire(req);
    if (trop.bloque) {
      const s = frein.secondes(trop.resteMs);
      res.setHeader('Retry-After', String(s));
      return send(res, 429, { ok: false, error: 'too_many_requests', retryAfter: s });
    }
  } catch (e) { /* le comptage ne doit jamais empecher une vraie demande */ }

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

  // Notification e-mail au gérant : elle ne bloque jamais la demande, mais son
  // echec est enregistre — sans quoi une commande pourrait passer inapercue.
  let notified = false;
  try {
    if (mail.mailReady()) { await mail.sendOwnerNotification(request, baseUrl(req)); notified = true; }
  } catch (e) { /* la demande est enregistrée quand même */ }
  if (!notified) {
    request.notified = false;
    try { await store.updateRequest(request); } catch (e) { /* sans consequence */ }
  }

  return send(res, 200, { ok: true, ref: request.ref });
};
