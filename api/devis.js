// POST public : reception d'une demande de reservation depuis le site.
// La route garde son nom historique : elle est appelee par cart.js et panier.js.
const { readJson, send, clean, cleanMultiline, isEmail, toNumber } = require('./_lib/util');
const store = require('./_lib/store');
const mail = require('./_lib/mail');
// Le catalogue chiffre, partage avec le site : une seule source de prix.
const pieces = require('../pieces.js');
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

  /*
   * Le tarif est retrouve ICI, dans notre propre catalogue, a partir de la
   * seule reference envoyee par la page. Le navigateur n'a jamais son mot a
   * dire sur le prix : sans cela, il suffirait de modifier sa page pour
   * commander a n'importe quel tarif, et la facture partirait avec.
   *
   * C'est aussi ce qui permet au back-office de pre-remplir la facture : le
   * prix affiche au client au moment de sa demande est desormais CONSERVE
   * avec elle. Avant, il etait perdu — la facture repartait de zero et rien
   * ne garantissait qu'elle corresponde a ce que le client avait vu.
   */
  /* Duree et mode de remise : on n'accepte que les deux valeurs prevues, et on
     retombe sur la plus prudente en cas de doute. */
  const duration = body.duration === 'weekend' ? 'weekend' : 'jour';
  const delivery = body.delivery === 'livraison' ? 'livraison' : 'retrait';
  const jours = duration === 'weekend' ? 2 : 1;

  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
  const items = rawItems.map((it) => {
    const ligne = {
      name: clean(it && it.name, 160),
      ref: clean(it && it.ref, 80),
      piece: clean(it && it.piece, 80),
      qty: Math.min(999, Math.max(1, Math.round(toNumber(it && it.qty, 1)))),
      priceHint: clean(it && it.priceHint, 40)
    };
    const p = pieces.par(ligne.piece) || pieces.par(ligne.ref);
    if (p && typeof p.prix === 'number') {
      ligne.piece = p.ref;
      ligne.price = p.prix;
      ligne.unit = p.unite;
      ligne.caution = typeof p.caution === 'number' ? p.caution : null;
      // Le nom fait foi cote maison : la page pourrait annoncer autre chose.
      ligne.name = p.nom;
    }
    return ligne;
  }).filter((it) => it.name);

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
      /* Le montant estime est calcule ICI, avec la meme regle que le panier :
         une piece au week-end garde son tarif, une piece au jour est
         multipliee par la duree. Il est conserve avec la demande pour que le
         back-office puisse l'afficher sans recalculer, et surtout pour garder
         une trace de ce qui a ete annonce au client ce jour-la. */
      modalites: { duree: duration, remise: delivery, jours },
      montant: items.reduce(function (n, it) {
        if (typeof it.price !== 'number') return n;
        return n + it.price * it.qty * (it.unit === 'week-end' ? 1 : jours);
      }, 0),
      aChiffrer: items.filter(function (it) { return typeof it.price !== 'number'; }).length,
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
