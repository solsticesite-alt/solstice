// Etat de securite du back-office : generation de session et double
// authentification.
//
// Deux choses vivent ici, dans une ligne dediee de la base (table
// `admin_security`, id = 1) :
//
//   · `gen` — le numero de generation des sessions. Les jetons le portent ;
//     l'incrementer invalide d'un coup toutes les sessions ouvertes. C'est le
//     ressort du bouton « Deconnecter partout ».
//
//   · `totp` — le secret de la double authentification, le compteur du dernier
//     code accepte (anti-rejeu) et les empreintes des codes de secours.
//
// Une table a part, et non la ligne des reglages : celle-ci est renvoyee telle
// quelle au navigateur par /api/admin/settings. Un secret n'a rien a y faire.
//
// Si la table n'existe pas encore (script SQL pas rejoue), tout retombe sur un
// etat en memoire : la connexion continue de fonctionner, mais la revocation
// et la double authentification ne tiennent pas d'une instance a l'autre. Le
// back-office le signale plutot que de faire semblant.

const VIDE = { gen: 0, totp: null, totpAttente: null, secours: [] };

let memoire = null;
let _tableManquante = false;

function normaliser(o) {
  const s = o && typeof o === 'object' ? o : {};
  return {
    gen: Number.isFinite(Number(s.gen)) ? Number(s.gen) : 0,
    totp: s.totp && typeof s.totp === 'object' ? s.totp : null,
    totpAttente: s.totpAttente && typeof s.totpAttente === 'object' ? s.totpAttente : null,
    secours: Array.isArray(s.secours) ? s.secours : []
  };
}

function supabase() {
  if (global.__solMockSecurityDb) return global.__solMockSecurityDb; // injection en test
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  } catch (e) {
    return null;
  }
}

async function lire() {
  const sb = supabase();
  if (sb) {
    try {
      const { data, error } = await sb.from('admin_security').select('data').eq('id', 1).maybeSingle();
      if (error) throw new Error(error.message);
      _tableManquante = false;
      return normaliser(data ? data.data : null);
    } catch (e) {
      if (!_tableManquante) {
        _tableManquante = true;
        console.warn('[sessions] table admin_security indisponible, etat en memoire :', e.message);
      }
    }
  }
  return normaliser(memoire);
}

async function ecrire(etat) {
  const propre = normaliser(etat);
  const sb = supabase();
  if (sb) {
    try {
      const { error } = await sb.from('admin_security').upsert({ id: 1, data: propre }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
      _tableManquante = false;
      memoire = propre; // garde le repli coherent
      return propre;
    } catch (e) {
      _tableManquante = true;
    }
  }
  memoire = propre;
  return propre;
}

// Vrai quand l'etat ne tient que dans la memoire de l'instance : la revocation
// et la double authentification ne valent alors que pour cette instance-la.
function durable() {
  return Boolean(supabase()) && !_tableManquante;
}

/* ---------- Generation de session ---------- */

async function generation() {
  const e = await lire();
  return e.gen;
}

// Renvoie la nouvelle generation. Toutes les sessions emises avant tombent.
async function revoquerTout() {
  const e = await lire();
  const suivant = Object.assign({}, e, { gen: (e.gen || 0) + 1 });
  await ecrire(suivant);
  return suivant.gen;
}

/* ---------- Double authentification ---------- */

async function etat() {
  const e = await lire();
  return {
    actif: Boolean(e.totp && e.totp.secret),
    enAttente: Boolean(e.totpAttente && e.totpAttente.secret),
    secoursRestants: e.secours.length,
    durable: durable(),
    generation: e.gen
  };
}

async function secretActif() {
  const e = await lire();
  return e.totp && e.totp.secret ? e.totp : null;
}

async function secretEnAttente() {
  const e = await lire();
  return e.totpAttente && e.totpAttente.secret ? e.totpAttente : null;
}

async function poserAttente(secret, maintenant) {
  const e = await lire();
  await ecrire(Object.assign({}, e, { totpAttente: { secret, cree: maintenant || Date.now() } }));
}

// Promeut le secret en attente et remet des codes de secours neufs.
async function activer(secours, compteur) {
  const e = await lire();
  if (!e.totpAttente || !e.totpAttente.secret) return false;
  await ecrire({
    gen: e.gen,
    totp: { secret: e.totpAttente.secret, depuis: Date.now(), dernier: compteur || 0 },
    totpAttente: null,
    secours: Array.isArray(secours) ? secours : []
  });
  return true;
}

async function annulerAttente() {
  const e = await lire();
  await ecrire(Object.assign({}, e, { totpAttente: null }));
}

// Desactiver coupe aussi les sessions : si quelqu'un a pu retirer le second
// facteur, on ne laisse pas trainer les acces qui existaient avant.
async function desactiver() {
  const e = await lire();
  await ecrire({ gen: (e.gen || 0) + 1, totp: null, totpAttente: null, secours: [] });
}

// Anti-rejeu : on retient le compteur du dernier code accepte.
async function noterCompteur(compteur) {
  const e = await lire();
  if (!e.totp) return;
  if ((e.totp.dernier || 0) >= compteur) return;
  await ecrire(Object.assign({}, e, {
    totp: Object.assign({}, e.totp, { dernier: compteur })
  }));
}

async function codesSecours() {
  const e = await lire();
  return e.secours;
}

// Un code de secours ne sert qu'une fois.
async function consommerSecours(index) {
  const e = await lire();
  if (index < 0 || index >= e.secours.length) return false;
  const reste = e.secours.slice();
  reste.splice(index, 1);
  await ecrire(Object.assign({}, e, { secours: reste }));
  return true;
}

async function remplacerSecours(haches) {
  const e = await lire();
  await ecrire(Object.assign({}, e, { secours: Array.isArray(haches) ? haches : [] }));
}

// Pour les tests : repartir d'un etat propre.
function _reinitialiser() {
  memoire = null;
  _tableManquante = false;
}

module.exports = {
  generation, revoquerTout,
  etat, secretActif, secretEnAttente, poserAttente, activer, annulerAttente,
  desactiver, noterCompteur, codesSecours, consommerSecours, remplacerSecours,
  durable, _reinitialiser, VIDE
};
