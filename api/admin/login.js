const { readJson, send, clean } = require('../_lib/util');
const auth = require('../_lib/auth');
const frein = require('../_lib/ratelimit');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });

  // Une adresse deja en attente n'a meme pas besoin d'etre comparee : on
  // repond avant de toucher au mot de passe.
  let barriere;
  try {
    barriere = await frein.etat(req);
  } catch (e) {
    barriere = { bloque: false, resteMs: 0 };
  }
  if (barriere.bloque) {
    const s = frein.secondes(barriere.resteMs);
    res.setHeader('Retry-After', String(s));
    return send(res, 429, { ok: false, error: 'too_many_attempts', retryAfter: s });
  }

  let body;
  try { body = await readJson(req); } catch (e) { return send(res, 400, { ok: false, error: 'invalid_body' }); }
  if (!process.env.ADMIN_PASSWORD) return send(res, 503, { ok: false, error: 'admin_password_not_set' });

  if (auth.checkPassword(clean(body.password, 200))) {
    try { await frein.succes(req); } catch (e) { /* le compteur n'empeche pas d'entrer */ }
    auth.setSession(res);
    return send(res, 200, { ok: true });
  }

  let echec;
  try {
    echec = await frein.echec(req);
  } catch (e) {
    echec = { bloque: false, resteMs: 0, freinMs: 500 };
  }
  // Sous le seuil, la reponse est simplement ralentie ; au-dela, l'adresse est
  // mise en attente et on annonce le delai.
  await attendre(echec.freinMs || 0);
  if (echec.bloque) {
    const s = frein.secondes(echec.resteMs);
    res.setHeader('Retry-After', String(s));
    return send(res, 429, { ok: false, error: 'too_many_attempts', retryAfter: s });
  }
  return send(res, 401, { ok: false, error: 'bad_password', remaining: Math.max(0, frein.SEUIL - echec.fails) });
};
