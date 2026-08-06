const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');
const mail = require('../_lib/mail');
const imap = require('../_lib/imap');

// L'etat de la configuration (base, SMTP, IMAP) n'a d'utilite qu'une fois
// connecte : le donner a un inconnu revient a lui dresser la carte des services
// branches derriere le site. Seul `authed` est public — la page en a besoin
// pour savoir s'il faut afficher le formulaire de connexion.
module.exports = async (req, res) => {
  const authed = auth.isAuthed(req);
  if (!authed) return send(res, 200, { ok: true, authed: false });
  return send(res, 200, {
    ok: true,
    authed: true,
    config: {
      store: store.storeReady(),
      mail: mail.mailReady(),
      imap: imap.imapReady(),
      adminPassword: Boolean(process.env.ADMIN_PASSWORD)
    }
  });
};
