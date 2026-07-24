const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');

module.exports = async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });
  let id;
  try {
    const u = new URL(req.url, 'http://localhost');
    id = parseInt(u.searchParams.get('id'), 10);
  } catch (e) { id = NaN; }
  if (!id) return send(res, 400, { ok: false, error: 'id_required' });
  try {
    const r = await store.getRequest(id);
    if (!r) return send(res, 404, { ok: false, error: 'not_found' });
    if (r.status === 'new') {
      r.status = 'read';
      try { await store.updateRequest(r); } catch (e) { /* non bloquant */ }
    }
    return send(res, 200, { ok: true, request: r });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'store_error' });
  }
};
