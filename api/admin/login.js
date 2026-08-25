// Connexion au back-office, en un ou deux temps.
//
//   Sans double authentification : mot de passe -> session.
//   Avec : mot de passe -> jeton d'etape (5 min) -> code a six chiffres -> session.
//
// Le second temps a son propre compteur d'echecs. C'est indispensable : un code
// TOTP ne vaut que six chiffres, soit un million de possibilites, et la fenetre
// de tolerance en rend trois valables a la fois. Sans freinage, un robot les
// epuise en quelques minutes.

const { readJson, send, clean } = require('../_lib/util');
const auth = require('../_lib/auth');
const sessions = require('../_lib/sessions');
const secret = require('../_lib/secret');
const totp = require('../_lib/totp');
const frein = require('../_lib/ratelimit');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function refuser429(res, resteMs) {
  const s = frein.secondes(resteMs);
  res.setHeader('Retry-After', String(s));
  return send(res, 429, { ok: false, error: 'too_many_attempts', retryAfter: s });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }

  let generation = 0;
  try { generation = await sessions.generation(); } catch (e) { generation = 0; }

  const code = clean(body.code, 40);
  const secours = clean(body.recovery, 40);
  const deuxiemeTemps = Boolean(code || secours);

  /* ---------------- Deuxieme temps : le code ---------------- */
  if (deuxiemeTemps) {
    if (!auth.etapePassee(req, generation)) {
      // Jeton d'etape absent ou perime : on repart du mot de passe.
      return send(res, 401, { ok: false, error: 'step_expired' });
    }

    let barriere;
    try { barriere = await frein.etat(req, null, frein.CLE_CODE); }
    catch (e) { barriere = { bloque: false, resteMs: 0 }; }
    if (barriere.bloque) return refuser429(res, barriere.resteMs);

    const config = await sessions.secretActif();
    if (!config || !config.secret) {
      // La double authentification a ete retiree entre les deux temps.
      auth.setSession(res, generation);
      return send(res, 200, { ok: true });
    }

    let valide = false;
    let compteur = 0;
    let parSecours = false;

    if (code) {
      const r = totp.verifier(config.secret, code, { apres: config.dernier || 0 });
      valide = r.ok;
      compteur = r.compteur;
    } else if (secours) {
      const liste = await sessions.codesSecours();
      const idx = secret.trouverCodeSecours(secours, liste);
      if (idx >= 0) {
        await sessions.consommerSecours(idx);
        valide = true;
        parSecours = true;
      }
    }

    if (!valide) {
      let echec;
      try { echec = await frein.echec(req, null, frein.CLE_CODE); }
      catch (e) { echec = { bloque: false, resteMs: 0, freinMs: 500 }; }
      await attendre(echec.freinMs || 0);
      if (echec.bloque) return refuser429(res, echec.resteMs);
      return send(res, 401, { ok: false, error: 'bad_code', remaining: Math.max(0, frein.SEUIL - echec.fails) });
    }

    // Anti-rejeu : le compteur consomme ne repassera pas.
    if (compteur) { try { await sessions.noterCompteur(compteur); } catch (e) { /* sans blocage */ } }
    try { await frein.succes(req, frein.CLE_CODE); } catch (e) { /* idem */ }
    auth.setSession(res, generation);
    const restants = (await sessions.codesSecours()).length;
    return send(res, 200, { ok: true, usedRecovery: parSecours, recoveryLeft: restants });
  }

  /* ---------------- Premier temps : le mot de passe ---------------- */

  // Une adresse deja en attente n'a meme pas besoin d'etre comparee : on
  // repond avant de toucher au mot de passe.
  let barriere;
  try { barriere = await frein.etat(req); } catch (e) { barriere = { bloque: false, resteMs: 0 }; }
  if (barriere.bloque) return refuser429(res, barriere.resteMs);

  if (!auth.motDePasseConfigure()) return send(res, 503, { ok: false, error: 'admin_password_not_set' });

  if (auth.checkPassword(clean(body.password, 200))) {
    try { await frein.succes(req); } catch (e) { /* le compteur n'empeche pas d'entrer */ }

    const config = await sessions.secretActif();
    if (config && config.secret) {
      // Le mot de passe seul ne suffit plus : on ne pose qu'un jeton d'etape.
      auth.setEtape(res, generation);
      return send(res, 200, { ok: true, need2fa: true });
    }

    auth.setSession(res, generation);
    return send(res, 200, { ok: true });
  }

  let echec;
  try { echec = await frein.echec(req); }
  catch (e) { echec = { bloque: false, resteMs: 0, freinMs: 500 }; }
  // Sous le seuil, la reponse est simplement ralentie ; au-dela, l'adresse est
  // mise en attente et on annonce le delai.
  await attendre(echec.freinMs || 0);
  if (echec.bloque) return refuser429(res, echec.resteMs);
  return send(res, 401, { ok: false, error: 'bad_password', remaining: Math.max(0, frein.SEUIL - echec.fails) });
};
