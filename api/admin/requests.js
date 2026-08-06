const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');

module.exports = async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });
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
      replied: Boolean(r.reply)
    }));
    return send(res, 200, { ok: true, items });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'store_error' });
  }
};
