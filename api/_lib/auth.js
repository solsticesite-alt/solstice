// Authentification du back-office : mot de passe, double authentification,
// et cookie signe (HMAC).
//
// Trois proprietes tenues ici :
//
//  1. Sans secret configure, personne n'entre. La valeur de repli qui existait
//     autrefois etait publiee dans le depot : un cookie forge avec elle aurait
//     ouvert le back-office sur un deploiement mal configure.
//
//  2. Changer le mot de passe coupe TOUTES les sessions ouvertes, toujours.
//     L'empreinte du mot de passe entre dans la cle de signature : les jetons
//     emis avant deviennent invalides d'eux-memes, sans rien a purger. C'est
//     ce qui manquait — on pouvait changer le mot de passe et rester connecte
//     avec l'ancien cookie.
//
//  3. Un bouton « Deconnecter partout » coupe les sessions sans toucher au
//     mot de passe : les jetons portent un numero de generation, compare a
//     celui conserve en base a chaque requete.

const crypto = require('crypto');
const { parseCookies, send } = require('./util');
const secretLib = require('./secret');

const COOKIE = 'sol_admin';
const COOKIE_ETAPE = 'sol_admin_2fa'; // preuve que le mot de passe est passe
const MAX_AGE = 60 * 60 * 24 * 7;     // 7 jours
const MAX_AGE_ETAPE = 5 * 60;         // 5 minutes pour saisir le code
const VERSION = 2;

/* ---------- Cle de signature ---------- */

// Ce qui identifie le mot de passe courant, sans jamais le manipuler en clair
// au-dela de ce hachage. Couvre les deux formes : hash (recommande) ou clair.
function empreinteMotDePasse() {
  const v = process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD || '';
  return crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
}

function motDePasseConfigure() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD);
}

function cle(generation) {
  if (!process.env.SESSION_SECRET && !motDePasseConfigure()) return '';
  return [
    process.env.SESSION_SECRET || '',
    empreinteMotDePasse(),
    String(generation || 0)
  ].join('|');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deB64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(data, generation) {
  return b64url(crypto.createHmac('sha256', cle(generation)).update(data).digest());
}

/* ---------- Jetons ---------- */

function makeToken(generation, options) {
  const o = options || {};
  const payload = b64url(JSON.stringify({
    v: VERSION,
    iat: Number.isFinite(o.iat) ? o.iat : Date.now(),
    gen: generation || 0,
    k: o.kind || 's'  // 's' = session complete, 'p' = etape mot de passe validee
  }));
  return payload + '.' + hmac(payload, generation);
}

/*
 * Verifie un jeton. `generation` est celle qui fait foi aujourd'hui : un jeton
 * emis sous une generation anterieure est refuse, c'est le ressort du bouton
 * « Deconnecter partout ».
 */
function verifyToken(token, generation, options) {
  const o = options || {};
  const genCourante = generation || 0;
  if (!cle(genCourante)) return false;
  if (!token || typeof token !== 'string') return false;
  const point = token.indexOf('.');
  if (point <= 0) return false;
  const payload = token.slice(0, point);
  const sig = token.slice(point + 1);
  if (!payload || !sig) return false;

  let data;
  try {
    data = JSON.parse(deB64url(payload).toString('utf8'));
  } catch (e) {
    return false;
  }
  if (!data || data.v !== VERSION || typeof data.iat !== 'number') return false;
  if ((data.gen || 0) !== genCourante) return false;
  if ((data.k || 's') !== (o.kind || 's')) return false;

  // Signature verifiee APRES la lecture du contenu, mais avant d'accorder quoi
  // que ce soit : la generation lue sert a rejouer exactement la meme cle.
  const attendu = hmac(payload, data.gen || 0);
  const a = Buffer.from(sig);
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const age = (o.maxAge || MAX_AGE) * 1000;
  if (Date.now() - data.iat > age) return false;
  return true;
}

/* ---------- Cookies ---------- */

function poser(res, nom, valeur, maxAge) {
  const parts = [
    nom + '=' + valeur,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    'Max-Age=' + maxAge
  ];
  const deja = res.getHeader && res.getHeader('Set-Cookie');
  const liste = deja ? (Array.isArray(deja) ? deja.slice() : [deja]) : [];
  liste.push(parts.join('; '));
  res.setHeader('Set-Cookie', liste);
}

function setSession(res, generation) {
  poser(res, COOKIE, makeToken(generation, { kind: 's' }), MAX_AGE);
  poser(res, COOKIE_ETAPE, '', 0); // l'etape intermediaire n'a plus lieu d'etre
}

function setEtape(res, generation) {
  poser(res, COOKIE_ETAPE, makeToken(generation, { kind: 'p' }), MAX_AGE_ETAPE);
}

function clearSession(res) {
  poser(res, COOKIE, '', 0);
  poser(res, COOKIE_ETAPE, '', 0);
}

function isAuthed(req, generation) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE], generation, { kind: 's' });
}

function etapePassee(req, generation) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE_ETAPE], generation, { kind: 'p', maxAge: MAX_AGE_ETAPE });
}

/* ---------- Mot de passe ---------- */

/*
 * Accepte les deux formes :
 *   ADMIN_PASSWORD_HASH  — recommandee, produite par `npm run motdepasse`
 *   ADMIN_PASSWORD       — en clair, conservee pour ne rien casser
 *
 * Dans les deux cas la comparaison est a temps constant, et ne revele pas la
 * longueur attendue (voir secret.egalConstant).
 */
function checkPassword(saisie) {
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  if (hash) return secretLib.verifierHash(String(saisie == null ? '' : saisie), hash);
  const clair = process.env.ADMIN_PASSWORD || '';
  if (!clair) return false;
  return secretLib.egalConstant(String(saisie == null ? '' : saisie), clair);
}

/* ---------- Garde d'acces ---------- */

// Asynchrone depuis que la generation est lue en base a chaque requete : c'est
// le prix de la revocation immediate, et une lecture de plus sur un back-office
// qui en fait deja plusieurs par page.
async function requireAdmin(req, res) {
  const sessions = require('./sessions');
  const gen = await sessions.generation();
  if (isAuthed(req, gen)) return true;
  send(res, 401, { ok: false, error: 'unauthorized' });
  return false;
}

module.exports = {
  COOKIE, COOKIE_ETAPE, MAX_AGE, MAX_AGE_ETAPE, VERSION,
  isAuthed, etapePassee, setSession, setEtape, clearSession,
  checkPassword, motDePasseConfigure, requireAdmin,
  makeToken, verifyToken, empreinteMotDePasse
};
