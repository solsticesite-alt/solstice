const { send } = require('../_lib/util');
const auth = require('../_lib/auth');

// POST uniquement : sur GET, une simple balise <img src="/api/admin/logout">
// posee sur n'importe quel site aurait suffi a faire sauter la session.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  auth.clearSession(res);
  return send(res, 200, { ok: true });
};
