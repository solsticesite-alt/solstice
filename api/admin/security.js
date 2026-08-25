// Reglages de securite du back-office : double authentification et sessions.
//
// Toutes les actions exigent une session valide. Celles qui affaiblissent la
// protection (retirer le second facteur, refaire des codes de secours)
// exigent EN PLUS le mot de passe : un ordinateur laisse ouvert ne doit pas
// suffire a desarmer le compte.

const { readJson, send, clean } = require('../_lib/util');
const auth = require('../_lib/auth');
const sessions = require('../_lib/sessions');
const secret = require('../_lib/secret');
const totp = require('../_lib/totp');
const frein = require('../_lib/ratelimit');
const store = require('../_lib/store');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Le compte affiche dans l'application d'authentification.
async function nomDuCompte() {
  try {
    const s = await store.getSettings();
    if (s && s.email) return s.email;
  } catch (e) { /* la base peut etre absente */ }
  return process.env.SMTP_USER || process.env.GMAIL_USER || 'back-office';
}

module.exports = async (req, res) => {
  if (!(await auth.requireAdmin(req, res))) return;

  if (req.method === 'GET') {
    try { return send(res, 200, { ok: true, etat: await sessions.etat() }); }
    catch (e) { return send(res, 500, { ok: false, error: 'state_error' }); }
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }
  const action = clean(body.action, 40);

  /* ---------- Etape 1 : preparer un secret ---------- */
  if (action === 'start') {
    const deja = await sessions.secretActif();
    if (deja) return send(res, 409, { ok: false, error: 'already_enabled' });
    if (!sessions.durable()) return send(res, 503, { ok: false, error: 'security_table_missing' });

    const s = totp.genererSecret();
    await sessions.poserAttente(s);
    const compte = await nomDuCompte();
    return send(res, 200, {
      ok: true,
      secret: s,
      secretLisible: totp.secretLisible(s),
      uri: totp.uriOtpauth(s, compte, 'Maison Solstice'),
      compte
    });
  }

  /* ---------- Etape 2 : confirmer par un premier code ---------- */
  if (action === 'confirm') {
    const attente = await sessions.secretEnAttente();
    if (!attente) return send(res, 409, { ok: false, error: 'no_pending_secret' });

    // Meme freinage que la connexion : sinon on brute le code ici.
    let barriere;
    try { barriere = await frein.etat(req, null, frein.CLE_CODE); }
    catch (e) { barriere = { bloque: false, resteMs: 0 }; }
    if (barriere.bloque) {
      const s = frein.secondes(barriere.resteMs);
      res.setHeader('Retry-After', String(s));
      return send(res, 429, { ok: false, error: 'too_many_attempts', retryAfter: s });
    }

    const r = totp.verifier(attente.secret, clean(body.code, 40));
    if (!r.ok) {
      let echec;
      try { echec = await frein.echec(req, null, frein.CLE_CODE); }
      catch (e) { echec = { freinMs: 500 }; }
      await attendre(echec.freinMs || 0);
      return send(res, 400, { ok: false, error: 'bad_code' });
    }
    try { await frein.succes(req, frein.CLE_CODE); } catch (e) { /* sans blocage */ }

    const { clairs, haches } = secret.genererCodesSecours(8);
    const ok = await sessions.activer(haches, r.compteur);
    if (!ok) return send(res, 409, { ok: false, error: 'no_pending_secret' });

    // Les codes en clair ne sont montres qu'ici, une seule fois.
    return send(res, 200, { ok: true, recovery: clairs });
  }

  if (action === 'cancel') {
    await sessions.annulerAttente();
    return send(res, 200, { ok: true });
  }

  /* ---------- Retirer le second facteur ---------- */
  if (action === 'disable') {
    if (!auth.checkPassword(clean(body.password, 200))) {
      await attendre(600);
      return send(res, 401, { ok: false, error: 'bad_password' });
    }
    const actif = await sessions.secretActif();
    if (!actif) return send(res, 200, { ok: true, already: true });

    // Un code valide en plus du mot de passe : celui qui desarme doit prouver
    // qu'il tient encore le telephone, sinon le second facteur ne protege plus
    // de rien des lors qu'on a le mot de passe.
    const r = totp.verifier(actif.secret, clean(body.code, 40), { apres: actif.dernier || 0 });
    if (!r.ok) {
      const idx = secret.trouverCodeSecours(clean(body.recovery, 40), await sessions.codesSecours());
      if (idx < 0) {
        await attendre(600);
        return send(res, 401, { ok: false, error: 'bad_code' });
      }
      await sessions.consommerSecours(idx);
    }

    await sessions.desactiver();          // coupe aussi toutes les sessions
    auth.setSession(res, await sessions.generation()); // sauf celle-ci
    return send(res, 200, { ok: true });
  }

  /* ---------- Refaire des codes de secours ---------- */
  if (action === 'recovery') {
    if (!auth.checkPassword(clean(body.password, 200))) {
      await attendre(600);
      return send(res, 401, { ok: false, error: 'bad_password' });
    }
    const actif = await sessions.secretActif();
    if (!actif) return send(res, 409, { ok: false, error: 'not_enabled' });
    const { clairs, haches } = secret.genererCodesSecours(8);
    await sessions.remplacerSecours(haches);
    return send(res, 200, { ok: true, recovery: clairs });
  }

  /* ---------- Deconnecter partout ---------- */
  if (action === 'revoke-all') {
    if (!auth.checkPassword(clean(body.password, 200))) {
      await attendre(600);
      return send(res, 401, { ok: false, error: 'bad_password' });
    }
    if (!sessions.durable()) return send(res, 503, { ok: false, error: 'security_table_missing' });
    const gen = await sessions.revoquerTout();
    // On rouvre immediatement une session pour celui qui a clique : le but est
    // de chasser les autres, pas de se mettre soi-meme dehors.
    auth.setSession(res, gen);
    return send(res, 200, { ok: true, generation: gen });
  }

  return send(res, 400, { ok: false, error: 'unknown_action' });
};
