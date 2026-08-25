// Parcours de connexion complet, sur les vrais gestionnaires HTTP.
//
// Ce fichier ne teste pas des fonctions isolees mais la porte d'entree telle
// qu'elle repond : /api/admin/login, /api/admin/security, /api/admin/me.
// C'est le seul niveau ou l'on voit vraiment si le mot de passe seul ouvre
// encore quelque chose une fois le second facteur en place.

const test = require('node:test');
const assert = require('node:assert');

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SESSION_SECRET = 'sel-de-test-connexion';
process.env.ADMIN_PASSWORD = 'le-bon-mot-de-passe';
delete process.env.ADMIN_PASSWORD_HASH;

const totp = require('../api/_lib/totp');
const sessions = require('../api/_lib/sessions');
const auth = require('../api/_lib/auth');
const login = require('../api/admin/login');
const securite = require('../api/admin/security');
const me = require('../api/admin/me');

/* ---------- base simulee ----------
 * Le module `sessions` refuse d'activer la double authentification tant que
 * l'etat n'est pas durable — sinon il ne tiendrait que dans la memoire d'une
 * instance serverless, et ne vaudrait rien. On lui fournit donc ici une table
 * `admin_security` en memoire qui repond comme Supabase.
 */
const table = { ligne: null };

global.__solMockSecurityDb = {
  from(nom) {
    if (nom !== 'admin_security') throw new Error('table inattendue : ' + nom);
    return {
      select() {
        return {
          eq() {
            return { maybeSingle: async () => ({ data: table.ligne, error: null }) };
          }
        };
      },
      async upsert(row) {
        table.ligne = { data: JSON.parse(JSON.stringify(row.data)) };
        return { error: null };
      }
    };
  }
};

/* ---------- petit harnais HTTP ---------- */

let nIp = 0;

function faireReq(body, cookies, options) {
  const o = options || {};
  const entetes = { 'x-real-ip': o.ip || 'ip-conn-' + ++nIp };
  if (cookies && Object.keys(cookies).length) {
    entetes.cookie = Object.keys(cookies).map((k) => k + '=' + cookies[k]).join('; ');
  }
  return {
    method: o.method || 'POST',
    headers: entetes,
    socket: {},
    body: body || {},
    on() {}
  };
}

function faireRes() {
  const res = {
    statusCode: 200,
    entetes: {},
    corps: null,
    setHeader(k, v) { this.entetes[k] = v; },
    getHeader(k) { return this.entetes[k]; },
    end(s) { try { this.corps = JSON.parse(s); } catch (e) { this.corps = s; } }
  };
  return res;
}

// Rejoue ce qu'un navigateur ferait des en-tetes Set-Cookie.
function majCookies(pot, res) {
  const brut = res.entetes['Set-Cookie'];
  if (!brut) return pot;
  const liste = Array.isArray(brut) ? brut : [brut];
  for (const c of liste) {
    const [paire, ...attrs] = c.split(';');
    const idx = paire.indexOf('=');
    const nom = paire.slice(0, idx).trim();
    const val = paire.slice(idx + 1).trim();
    const expire = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expire || !val) delete pot[nom];
    else pot[nom] = val;
  }
  return pot;
}

async function appeler(handler, body, pot, options) {
  const res = faireRes();
  await handler(faireReq(body, pot, options), res);
  majCookies(pot, res);
  return res;
}

function neuf() {
  table.ligne = null;
  sessions._reinitialiser();
  return {};
}

/* ---------- sans double authentification ---------- */

test('le bon mot de passe ouvre une session', async () => {
  const pot = neuf();
  const r = await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.corps.ok, true);
  assert.ok(!r.corps.need2fa, 'sans second facteur, pas d etape supplementaire');
  assert.ok(pot.sol_admin, 'le cookie de session est pose');

  const m = await appeler(me, {}, pot, { method: 'GET' });
  assert.strictEqual(m.corps.authed, true);
});

test('un mauvais mot de passe n ouvre rien', async () => {
  const pot = neuf();
  const r = await appeler(login, { password: 'raté' }, pot);
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(r.corps.error, 'bad_password');
  assert.ok(!pot.sol_admin);
});

test('sans session, /me ne dit rien de la configuration', async () => {
  const m = await appeler(me, {}, neuf(), { method: 'GET' });
  assert.strictEqual(m.corps.authed, false);
  assert.strictEqual(m.corps.config, undefined, 'la carte des services reste privee');
  assert.strictEqual(m.corps.securite, undefined, 'et l etat du second facteur aussi');
});

/* ---------- mise en place du second facteur ---------- */

// Le code qui a servi a l'activation est consomme : l'anti-rejeu le refusera
// ensuite. Pour se connecter il faut donc celui du pas suivant — ce qui est
// exactement ce que fait un telephone trente secondes plus tard, et reste
// dans la fenetre de tolerance.
function codeSuivant(secret) {
  return totp.code(secret, Date.now() + totp.PAS_S * 1000);
}

async function activerDeuxFacteurs(pot) {
  const debut = await appeler(securite, { action: 'start' }, pot);
  assert.strictEqual(debut.statusCode, 200, JSON.stringify(debut.corps));
  const s = debut.corps.secret;
  const conf = await appeler(securite, { action: 'confirm', code: totp.code(s) }, pot);
  assert.strictEqual(conf.statusCode, 200, JSON.stringify(conf.corps));
  return { secret: s, secours: conf.corps.recovery };
}

test('l activation demande un premier code valide', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);

  const debut = await appeler(securite, { action: 'start' }, pot);
  assert.strictEqual(debut.statusCode, 200);
  assert.match(debut.corps.secret, /^[A-Z2-7]{32}$/);
  assert.ok(debut.corps.uri.startsWith('otpauth://totp/'));

  const faux = await appeler(securite, { action: 'confirm', code: '000000' }, pot);
  assert.strictEqual(faux.statusCode, 400);
  assert.strictEqual((await sessions.etat()).actif, false, 'rien ne s active sur un mauvais code');

  const bon = await appeler(securite, { action: 'confirm', code: totp.code(debut.corps.secret) }, pot);
  assert.strictEqual(bon.statusCode, 200);
  assert.strictEqual(bon.corps.recovery.length, 8, 'huit codes de secours sont remis');
  assert.strictEqual((await sessions.etat()).actif, true);
});

test('un inconnu ne peut pas toucher aux reglages de securite', async () => {
  const pot = neuf();
  for (const action of ['start', 'confirm', 'disable', 'revoke-all', 'recovery']) {
    const r = await appeler(securite, { action }, pot);
    assert.strictEqual(r.statusCode, 401, action);
  }
});

/* ---------- connexion avec second facteur ---------- */

test('le mot de passe seul ne suffit plus une fois le second facteur actif', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const { secret } = await activerDeuxFacteurs(pot);

  // Nouveau navigateur, aucun cookie.
  const autre = {};
  const r = await appeler(login, { password: 'le-bon-mot-de-passe' }, autre);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.corps.need2fa, true, 'le serveur reclame le code');
  assert.ok(!autre.sol_admin, 'aucune session complete n est ouverte');
  assert.ok(autre.sol_admin_2fa, 'seulement un jeton d etape');

  // Et ce jeton d'etape n'ouvre rien par lui-meme.
  const m = await appeler(me, {}, autre, { method: 'GET' });
  assert.strictEqual(m.corps.authed, false);

  const fini = await appeler(login, { code: codeSuivant(secret) }, autre);
  assert.strictEqual(fini.statusCode, 200);
  assert.ok(autre.sol_admin, 'la session s ouvre apres le code');
  assert.strictEqual((await appeler(me, {}, autre, { method: 'GET' })).corps.authed, true);
});

test('un code sans passer par le mot de passe est refuse', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const { secret } = await activerDeuxFacteurs(pot);

  const autre = {};
  const r = await appeler(login, { code: totp.code(secret) }, autre);
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(r.corps.error, 'step_expired');
  assert.ok(!autre.sol_admin);
});

test('un mauvais code ne passe pas, et se compte', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  await activerDeuxFacteurs(pot);

  const autre = {};
  const ip = 'ip-mauvais-code';
  await appeler(login, { password: 'le-bon-mot-de-passe' }, autre, { ip });
  const r = await appeler(login, { code: '000000' }, autre, { ip });
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual(r.corps.error, 'bad_code');
  assert.ok(!autre.sol_admin);
});

// Le point qui compte : un code vu par-dessus l'epaule ne doit pas resservir.
test('un code deja consomme ne rouvre pas une seconde session', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const { secret } = await activerDeuxFacteurs(pot);

  const code = codeSuivant(secret);
  const premier = {};
  await appeler(login, { password: 'le-bon-mot-de-passe' }, premier, { ip: 'ip-rejeu-1' });
  const a = await appeler(login, { code }, premier, { ip: 'ip-rejeu-1' });
  assert.strictEqual(a.statusCode, 200, 'le premier usage passe');

  const second = {};
  await appeler(login, { password: 'le-bon-mot-de-passe' }, second, { ip: 'ip-rejeu-2' });
  const b = await appeler(login, { code }, second, { ip: 'ip-rejeu-2' });
  assert.strictEqual(b.statusCode, 401, 'le rejeu doit etre refuse');
  assert.ok(!second.sol_admin);
});

test('un code de secours ouvre la session, une seule fois', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const { secours } = await activerDeuxFacteurs(pot);

  const autre = {};
  await appeler(login, { password: 'le-bon-mot-de-passe' }, autre, { ip: 'ip-secours-1' });
  const a = await appeler(login, { recovery: secours[0] }, autre, { ip: 'ip-secours-1' });
  assert.strictEqual(a.statusCode, 200);
  assert.strictEqual(a.corps.usedRecovery, true);
  assert.strictEqual(a.corps.recoveryLeft, 7, 'le code est consomme');

  const encore = {};
  await appeler(login, { password: 'le-bon-mot-de-passe' }, encore, { ip: 'ip-secours-2' });
  const b = await appeler(login, { recovery: secours[0] }, encore, { ip: 'ip-secours-2' });
  assert.strictEqual(b.statusCode, 401, 'le meme code de secours ne resservira pas');
});

/* ---------- deconnecter partout ---------- */

test('« deconnecter partout » ferme les autres sessions et garde la sienne', async () => {
  const pot = neuf();
  // Deux navigateurs connectes.
  const a = {};
  const b = {};
  await appeler(login, { password: 'le-bon-mot-de-passe' }, a, { ip: 'ip-rev-a' });
  await appeler(login, { password: 'le-bon-mot-de-passe' }, b, { ip: 'ip-rev-b' });
  assert.strictEqual((await appeler(me, {}, a, { method: 'GET' })).corps.authed, true);
  assert.strictEqual((await appeler(me, {}, b, { method: 'GET' })).corps.authed, true);

  const r = await appeler(securite, { action: 'revoke-all', password: 'le-bon-mot-de-passe' }, a);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.corps));

  assert.strictEqual((await appeler(me, {}, a, { method: 'GET' })).corps.authed, true, 'celui qui a clique reste');
  assert.strictEqual((await appeler(me, {}, b, { method: 'GET' })).corps.authed, false, 'l autre est dehors');
  void pot;
});

test('« deconnecter partout » exige le mot de passe', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const r = await appeler(securite, { action: 'revoke-all', password: 'pas-le-bon' }, pot);
  assert.strictEqual(r.statusCode, 401);
  assert.strictEqual((await sessions.generation()), 0, 'la generation n a pas bouge');
});

/* ---------- retrait du second facteur ---------- */

test('retirer le second facteur exige le mot de passe ET un code', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const { secret } = await activerDeuxFacteurs(pot);

  const sansCode = await appeler(securite, { action: 'disable', password: 'le-bon-mot-de-passe' }, pot);
  assert.strictEqual(sansCode.statusCode, 401);
  assert.strictEqual((await sessions.etat()).actif, true, 'toujours actif');

  const sansMdp = await appeler(securite, { action: 'disable', code: totp.code(secret) }, pot);
  assert.strictEqual(sansMdp.statusCode, 401);
  assert.strictEqual((await sessions.etat()).actif, true);

  const avecTout = await appeler(
    securite,
    { action: 'disable', password: 'le-bon-mot-de-passe', code: codeSuivant(secret) },
    pot
  );
  assert.strictEqual(avecTout.statusCode, 200, JSON.stringify(avecTout.corps));
  assert.strictEqual((await sessions.etat()).actif, false);
});

test('retirer le second facteur ferme les autres sessions', async () => {
  const pot = neuf();
  const a = {};
  const b = {};
  await appeler(login, { password: 'le-bon-mot-de-passe' }, a, { ip: 'ip-dis-a' });
  const { secret, secours } = await activerDeuxFacteurs(a);
  // b se connecte par code de secours : cela n'entame pas le compteur TOTP,
  // qui reste disponible pour le retrait juste apres.
  await appeler(login, { password: 'le-bon-mot-de-passe' }, b, { ip: 'ip-dis-b' });
  await appeler(login, { recovery: secours[0] }, b, { ip: 'ip-dis-b' });
  assert.strictEqual((await appeler(me, {}, b, { method: 'GET' })).corps.authed, true);

  const r = await appeler(
    securite,
    { action: 'disable', password: 'le-bon-mot-de-passe', code: codeSuivant(secret) },
    a
  );
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.corps));
  assert.strictEqual((await appeler(me, {}, b, { method: 'GET' })).corps.authed, false);
  assert.strictEqual((await appeler(me, {}, a, { method: 'GET' })).corps.authed, true);
  void pot;
});

/* ---------- /me ---------- */

test('/me annonce l etat du second facteur une fois connecte', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  let m = await appeler(me, {}, pot, { method: 'GET' });
  assert.strictEqual(m.corps.securite.deuxFacteurs, false);

  await activerDeuxFacteurs(pot);
  m = await appeler(me, {}, pot, { method: 'GET' });
  assert.strictEqual(m.corps.securite.deuxFacteurs, true);
  assert.strictEqual(m.corps.securite.secoursRestants, 8);
});

test('la session survit a un changement de generation seulement si elle est a jour', async () => {
  const pot = neuf();
  await appeler(login, { password: 'le-bon-mot-de-passe' }, pot);
  const jetonAvant = pot.sol_admin;
  await sessions.revoquerTout();
  assert.strictEqual(auth.isAuthed({ headers: { cookie: 'sol_admin=' + jetonAvant } }, await sessions.generation()), false);
});
