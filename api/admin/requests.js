const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');

module.exports = async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });

  // Les durees de conservation annoncees dans la politique de confidentialite
  // doivent etre APPLIQUEES, pas seulement promises. Le balayage a lieu au plus
  // une fois par jour et ne doit jamais empecher la liste de s'afficher.
  let purgees = 0;
  try { purgees = await store.purgerPerimees(); } catch (e) { purgees = 0; }

  try {
    const all = await store.listRequests(400);
    const items = all.map((r) => ({
      id: r.id,
      ref: r.ref,
      createdAt: r.createdAt,
      status: r.status,
      clientName: (r.client || {}).name || '',
      // Sert a rapprocher une commande d'un e-mail recu, cote navigateur.
      clientEmail: ((r.client || {}).email || '').toLowerCase(),
      eventType: (r.event || {}).type || '',
      date: (r.event || {}).date || '',
      location: (r.event || {}).location || '',
      itemCount: (r.items || []).length,
      replied: Boolean(r.reply),
      // false uniquement si la notification a echoue ; absent = envoyee.
      notified: r.notified !== false
    }));
    return send(res, 200, { ok: true, items, purged: purgees });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'store_error' });
  }
};
