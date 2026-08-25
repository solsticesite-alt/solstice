const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const sessions = require('../_lib/sessions');
const store = require('../_lib/store');
const mail = require('../_lib/mail');
const imap = require('../_lib/imap');

// L'etat de la configuration (base, SMTP, IMAP) n'a d'utilite qu'une fois
// connecte : le donner a un inconnu revient a lui dresser la carte des services
// branches derriere le site. Seul `authed` est public — la page en a besoin
// pour savoir s'il faut afficher le formulaire de connexion.
//
// L'etat de la double authentification est lui aussi reserve aux connectes :
// savoir de l'exterieur qu'un compte n'a pas de second facteur, c'est savoir
// lequel attaquer.
module.exports = async (req, res) => {
  let generation = 0;
  try { generation = await sessions.generation(); } catch (e) { generation = 0; }

  const authed = auth.isAuthed(req, generation);
  if (!authed) return send(res, 200, { ok: true, authed: false });

  let securite = { actif: false, secoursRestants: 0, durable: false };
  try { securite = await sessions.etat(); } catch (e) { /* valeurs par defaut */ }

  return send(res, 200, {
    ok: true,
    authed: true,
    config: {
      store: store.storeReady(),
      mail: mail.mailReady(),
      imap: imap.imapReady(),
      adminPassword: auth.motDePasseConfigure(),
      // Vrai quand le mot de passe est stocke sous forme d'empreinte plutot
      // qu'en clair dans les variables d'environnement.
      adminPasswordHache: Boolean(process.env.ADMIN_PASSWORD_HASH)
    },
    securite: {
      deuxFacteurs: securite.actif,
      secoursRestants: securite.secoursRestants,
      // Faux = l'etat ne tient qu'en memoire d'instance : la table
      // `admin_security` manque, il faut rejouer supabase-schema.sql.
      durable: securite.durable
    }
  });
};
