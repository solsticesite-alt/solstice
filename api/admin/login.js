const { readJson, send, clean } = require('../_lib/util');
const auth = require('../_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }
  if (!process.env.ADMIN_PASSWORD) return send(res, 503, { ok: false, error: 'admin_password_not_set' });
  if (auth.checkPassword(clean(body.password, 200))) {
    auth.setSession(res);
    return send(res, 200, { ok: true });
  }
  // Petit delai pour ralentir le bruteforce.
  await new Promise((r) => setTimeout(r, 500));
  return send(res, 401, { ok: false, error: 'bad_password' });
};
