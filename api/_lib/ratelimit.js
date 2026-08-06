// Freinage des tentatives de connexion au back-office, et du formulaire public.
//
// Le mot de passe admin ouvre les commandes des clients ET la boite mail du
// domaine : il merite mieux qu'un simple delai. Ici, chaque echec compte, et
// au-dela de quelques essais l'adresse est mise en attente, avec un temps qui
// double a chaque nouvelle erreur.
//
// L'etat est conserve dans Supabase quand la table `admin_logins` existe (le
// compteur survit alors aux redemarrages et vaut pour toutes les instances
// serverless). Si la table est absente ou la base injoignable, on retombe sur
// un compteur en memoire : moins solide, mais jamais bloquant pour la
// connexion elle-même.

const crypto = require('crypto');

const SEUIL = 5; // essais tolerés avant la première mise en attente
const BASE_MS = 60 * 1000; // durée de la première attente
const MAX_MS = 6 * 60 * 60 * 1000; // plafond : six heures
const OUBLI_MS = 6 * 60 * 60 * 1000; // sans échec pendant ce délai, on repart de zéro
const LENTEUR_MS = 250; // ralentissement progressif sous le seuil
const LENTEUR_MAX_MS = 2000;

// Formulaire public : une fenetre glissante toute simple. Un client honnete
// envoie une demande, deux au pire ; au-dela c'est un robot, et chaque demande
// coute une ligne en base et un e-mail dans la boite du gerant.
const FORM_MAX = 5;
const FORM_FENETRE_MS = 60 * 60 * 1000;

// Les deux compteurs partagent la meme table : un prefixe les separe.
const CLE_CONNEXION = 'c:';
const CLE_FORMULAIRE = 'f:';

const memoire = new Map();
let _sbErreurSignalee = false;

// L'adresse IP est une donnee personnelle : on n'en stocke que l'empreinte.
function empreinte(ip) {
  const sel = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'sel-local';
  return crypto.createHmac('sha256', sel).update(String(ip)).digest('hex').slice(0, 32);
}

// Vercel place l'adresse reelle du visiteur dans ces en-tetes. Un client peut
// tenter d'en inventer, d'ou le repli sur l'adresse de la socket : au pire le
// compteur est partage, jamais contourne silencieusement.
function adresseDe(req) {
  const h = (req && req.headers) || {};
  const xri = h['x-real-ip'];
  if (xri) return String(xri).trim();
  const xff = h['x-forwarded-for'];
  if (xff) {
    const premier = String(xff).split(',')[0].trim();
    if (premier) return premier;
  }
  return (req && req.socket && req.socket.remoteAddress) || 'inconnue';
}

// Attente appliquee apres `fails` echecs : rien sous le seuil, puis un temps
// qui double a chaque erreur supplementaire, plafonne a six heures.
function attentePour(fails) {
  if (fails < SEUIL) return 0;
  const puissance = Math.min(fails - SEUIL, 20);
  return Math.min(MAX_MS, BASE_MS * Math.pow(2, puissance));
}

function supabase() {
  if (global.__solMockLoginDb) return global.__solMockLoginDb; // injection en test
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

async function lire(cle) {
  const sb = supabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('admin_logins')
        .select('fails, last_fail')
        .eq('ip_hash', cle)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return { fails: 0, lastFail: 0, durable: true };
      return { fails: Number(data.fails) || 0, lastFail: Date.parse(data.last_fail) || 0, durable: true };
    } catch (e) {
      if (!_sbErreurSignalee) {
        _sbErreurSignalee = true;
        console.warn('[ratelimit] table admin_logins indisponible, compteur en mémoire :', e.message);
      }
    }
  }
  const m = memoire.get(cle);
  return { fails: (m && m.fails) || 0, lastFail: (m && m.lastFail) || 0, durable: false };
}

// Rien ne supprimait les lignes devenues inutiles : une campagne lancee depuis
// des milliers d'adresses aurait fait gonfler la table sans fin. On balaie donc
// les compteurs oublies au moment ou un nouveau commence — c'est exactement
// quand il y en a besoin, et jamais a chaque tentative.
async function purger(sb, avant) {
  try {
    await sb.from('admin_logins').delete().lt('last_fail', new Date(avant).toISOString());
  } catch (e) {
    /* le menage n'est pas critique : on n'en fait pas un echec de connexion */
  }
}

async function ecrire(cle, fails, lastFail) {
  const sb = supabase();
  if (sb) {
    try {
      const { error } = await sb
        .from('admin_logins')
        .upsert(
          { ip_hash: cle, fails, last_fail: new Date(lastFail).toISOString() },
          { onConflict: 'ip_hash' }
        );
      if (error) throw new Error(error.message);
      if (fails === 1) await purger(sb, lastFail - OUBLI_MS);
      return;
    } catch (e) {
      /* repli memoire ci-dessous */
    }
  }
  memoire.set(cle, { fails, lastFail });
  // Le repli memoire ne doit pas grossir sans fin sur une instance chaude.
  if (memoire.size > 5000) {
    const limite = Date.now() - OUBLI_MS;
    for (const [k, v] of memoire) if (v.lastFail < limite) memoire.delete(k);
  }
}

async function effacer(cle) {
  const sb = supabase();
  if (sb) {
    try {
      const { error } = await sb.from('admin_logins').delete().eq('ip_hash', cle);
      if (!error) return;
    } catch (e) {
      /* repli memoire ci-dessous */
    }
  }
  memoire.delete(cle);
}

// Etat courant de l'adresse : bloquee ou non, et combien de temps encore.
async function etat(req, maintenant) {
  const now = maintenant || Date.now();
  const cle = CLE_CONNEXION + empreinte(adresseDe(req));
  const { fails, lastFail } = await lire(cle);
  if (!fails || now - lastFail > OUBLI_MS) return { cle, fails: 0, bloque: false, resteMs: 0 };
  const reste = lastFail + attentePour(fails) - now;
  return { cle, fails, bloque: reste > 0, resteMs: Math.max(0, reste) };
}

// Un echec de plus. Renvoie le temps d'attente a respecter avant de repondre,
// et l'etat qui en decoule.
async function echec(req, maintenant) {
  const now = maintenant || Date.now();
  const cle = CLE_CONNEXION + empreinte(adresseDe(req));
  const { fails, lastFail } = await lire(cle);
  const precedents = !fails || now - lastFail > OUBLI_MS ? 0 : fails;
  const total = precedents + 1;
  await ecrire(cle, total, now);
  return {
    fails: total,
    bloque: total >= SEUIL,
    resteMs: attentePour(total),
    // Sous le seuil, on ralentit deja la reponse pour rendre le balayage penible.
    freinMs: Math.min(LENTEUR_MAX_MS, LENTEUR_MS * total)
  };
}

// Une demande de plus depuis cette adresse. Renvoie l'etat APRES comptage :
// au-dela de FORM_MAX dans l'heure, la demande doit etre refusee.
async function formulaire(req, maintenant) {
  const now = maintenant || Date.now();
  const cle = CLE_FORMULAIRE + empreinte(adresseDe(req));
  const { fails, lastFail } = await lire(cle);
  // `lastFail` sert ici de debut de fenetre, pas de dernier echec.
  const dansLaFenetre = fails > 0 && now - lastFail < FORM_FENETRE_MS;
  const compte = dansLaFenetre ? fails + 1 : 1;
  const debut = dansLaFenetre ? lastFail : now;
  await ecrire(cle, compte, debut);
  return {
    compte,
    bloque: compte > FORM_MAX,
    resteMs: Math.max(1000, debut + FORM_FENETRE_MS - now)
  };
}

async function succes(req) {
  await effacer(CLE_CONNEXION + empreinte(adresseDe(req)));
}

// En secondes, pour l'en-tete Retry-After et le message affiche.
function secondes(ms) {
  return Math.max(1, Math.ceil(ms / 1000));
}

module.exports = {
  etat,
  echec,
  succes,
  formulaire,
  secondes,
  // exportes pour les tests
  attentePour,
  adresseDe,
  SEUIL,
  OUBLI_MS,
  FORM_MAX,
  FORM_FENETRE_MS
};
