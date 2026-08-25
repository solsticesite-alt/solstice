// Hachage des secrets longue duree : mot de passe du back-office et codes de
// secours.
//
// Pourquoi ne pas se contenter d'une comparaison directe ? Parce qu'une
// variable d'environnement se lit : une capture d'ecran du tableau de bord
// Vercel, un collegue de passage, un export de configuration, et le mot de
// passe part en clair. Stocke sous forme de hachage, ce qui fuit ne sert a
// rien tel quel — il faudrait le casser, et scrypt est fait pour que ce soit
// long et cher.
//
// Format : scrypt$N$r$p$sel$empreinte  (sel et empreinte en base64url)

const crypto = require('crypto');

const N = 16384; // cout memoire/temps — environ 50 ms par verification
const R = 8;
const P = 1;
const LONGUEUR = 64;
const SEL = 16;

function b64(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deB64(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// 128 * N * r = 16 Mio ici : au-dessus de la limite par defaut de Node sur
// certaines versions, donc on l'annonce explicitement.
const OPTIONS = { N, r: R, p: P, maxmem: 256 * 1024 * 1024 };

function hacher(valeur, sel) {
  const s = sel ? Buffer.from(sel) : crypto.randomBytes(SEL);
  const h = crypto.scryptSync(String(valeur == null ? '' : valeur), s, LONGUEUR, OPTIONS);
  return ['scrypt', N, R, P, b64(s), b64(h)].join('$');
}

function estUnHash(v) {
  return typeof v === 'string' && /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(v);
}

/*
 * Comparaison a temps constant. Une valeur stockee illisible renvoie false :
 * on ne laisse jamais un format casse ouvrir la porte.
 *
 * La longueur attendue est FIGEE, jamais deduite de ce qui est stocke. Une
 * version anterieure derivait la cle a la taille trouvee dans l'empreinte :
 * comme scrypt produit, pour une sortie courte, le prefixe exact de la sortie
 * longue, il suffisait de tronquer l'empreinte pour qu'elle continue de
 * valider — et tronquee a un octet, n'importe quel mot de passe passait une
 * fois sur 256. Sans consequence pour une variable d'environnement (la
 * modifier suppose deja tout controler), mais les codes de secours, eux,
 * vivent en base : quelqu'un capable d'y ecrire aurait pu les affaiblir au
 * lieu d'avoir a les casser.
 *
 * Les parametres de cout sont bornes pour la meme raison : une valeur stockee
 * ne doit pas pouvoir commander un calcul demesure.
 */
function verifierHash(valeur, stocke) {
  if (!estUnHash(stocke)) return false;
  const [, n, r, p, sel, empreinte] = String(stocke).split('$');
  const nN = Number(n);
  const nR = Number(r);
  const nP = Number(p);
  // N doit etre une puissance de deux, et tout doit rester dans des bornes sensees.
  if (!(nN >= 1024 && nN <= 1 << 20 && (nN & (nN - 1)) === 0)) return false;
  if (!(nR >= 1 && nR <= 32) || !(nP >= 1 && nP <= 16)) return false;

  const attendu = deB64(empreinte);
  if (attendu.length !== LONGUEUR) return false;
  const octetsSel = deB64(sel);
  if (octetsSel.length < 8) return false;

  let calcule;
  try {
    calcule = crypto.scryptSync(
      String(valeur == null ? '' : valeur),
      octetsSel,
      LONGUEUR,
      { N: nN, r: nR, p: nP, maxmem: 256 * 1024 * 1024 }
    );
  } catch (e) {
    return false;
  }
  return crypto.timingSafeEqual(calcule, attendu);
}

/*
 * Comparaison de deux secrets en clair, sans reveler leur longueur.
 *
 * `timingSafeEqual` exige des tampons de meme taille ; le test de longueur
 * qu'on met devant repond plus vite pour une longueur fausse, ce qui suffit a
 * apprendre la taille du mot de passe. En comparant les empreintes SHA-256,
 * les deux cotes font toujours 32 octets et le temps ne dit plus rien.
 */
function egalConstant(a, b) {
  const x = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const y = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* ---------- Codes de secours ---------- */
//
// Sans eux, un telephone perdu = un back-office perdu. Ils sont a usage
// unique et stockes haches, comme un mot de passe.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : illisibles a la main

function genererCodeSecours() {
  const octets = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHABET[octets[i] % ALPHABET.length];
  return out.slice(0, 5) + '-' + out.slice(5);
}

function normaliserCodeSecours(v) {
  return String(v == null ? '' : v).replace(/[\s-]/g, '').toUpperCase();
}

function genererCodesSecours(combien) {
  const n = combien || 8;
  const clairs = [];
  for (let i = 0; i < n; i++) clairs.push(genererCodeSecours());
  return { clairs, haches: clairs.map((c) => hacher(normaliserCodeSecours(c))) };
}

/*
 * Cherche le code parmi les empreintes. Renvoie l'index trouve, ou -1.
 * On parcourt TOUTE la liste meme apres avoir trouve : sinon le temps de
 * reponse indiquerait la position du code, et donc combien en restent.
 */
function trouverCodeSecours(saisie, haches) {
  const propre = normaliserCodeSecours(saisie);
  if (!/^[A-Z2-9]{10}$/.test(propre)) return -1;
  let trouve = -1;
  (Array.isArray(haches) ? haches : []).forEach((h, i) => {
    if (verifierHash(propre, h) && trouve < 0) trouve = i;
  });
  return trouve;
}

module.exports = {
  hacher, verifierHash, estUnHash, egalConstant,
  genererCodesSecours, normaliserCodeSecours, trouverCodeSecours
};
