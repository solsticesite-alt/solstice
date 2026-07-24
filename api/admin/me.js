const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');
const mail = require('../_lib/mail');

module.exports = async (req, res) => {
  return send(res, 200, {
    ok: true,
    authed: auth.isAuthed(req),
    config: {
      store: store.storeReady(),
      mail: mail.mailReady(),
      adminPassword: Boolean(process.env.ADMIN_PASSWORD)
    }
  });
};
