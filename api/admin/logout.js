const { send } = require('../_lib/util');
const auth = require('../_lib/auth');

module.exports = async (req, res) => {
  auth.clearSession(res);
  return send(res, 200, { ok: true });
};
