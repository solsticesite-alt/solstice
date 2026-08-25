// Double authentification (TOTP, RFC 6238) — sans dependance externe.
//
// Le principe : un secret partage entre le serveur et l'application du
// telephone, et un code a six chiffres derive de ce secret ET de l'heure.
// Le code change toutes les trente secondes, donc l'intercepter ne sert
// presque a rien — et le rejouer ne sert a rien du tout (voir `verifier`).
//
// Rien n'est invente ici : HMAC-SHA1 sur un compteur de 8 octets, puis la
// troncature dynamique de la RFC 4226. Les vecteurs de test officiels de la
// RFC 6238 sont verifies dans test/totp.test.js.

const crypto = require('crypto');

const PAS_S = 30;      // duree d'un code, en secondes
const CHIFFRES = 6;
const FENETRE = 1;     // tolerance : un pas avant, un pas apres (± 30 s)

// RFC 4648. Pas de padding : les applications d'authentification n'en veulent pas.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  const octets = Buffer.from(buf);
  let bits = 0;
  let valeur = 0;
  let out = '';
  for (let i = 0; i < octets.length; i++) {
    valeur = (valeur << 8) | octets[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(valeur << (5 - bits)) & 31];
  return out;
}

// Tolerant a la saisie humaine : espaces, tirets et minuscules acceptes.
// Tout autre caractere est un refus net — on ne devine pas un secret.
function base32Decode(str) {
  const propre = String(str == null ? '' : str).replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!propre) throw new Error('secret_vide');
  let bits = 0;
  let valeur = 0;
  const out = [];
  for (let i = 0; i < propre.length; i++) {
    const idx = ALPHABET.indexOf(propre[i]);
    if (idx < 0) throw new Error('secret_invalide');
    valeur = (valeur << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20 octets = 160 bits, la taille recommandee par la RFC 4226 pour HMAC-SHA1.
function genererSecret(octets) {
  return base32Encode(crypto.randomBytes(octets || 20));
}

function compteurPour(t) {
  return Math.floor((Number.isFinite(t) ? t : Date.now()) / 1000 / PAS_S);
}

// Troncature dynamique (RFC 4226 §5.3).
function codePourCompteur(secret, compteur, chiffres) {
  const n = chiffres || CHIFFRES;
  const cle = base32Decode(secret);
  const bloc = Buffer.alloc(8);
  // Le compteur tient largement sur 53 bits : on l'ecrit en deux moities
  // pour ne pas dependre de BigInt ni deborder sur un decalage 32 bits.
  bloc.writeUInt32BE(Math.floor(compteur / 0x100000000), 0);
  bloc.writeUInt32BE(compteur >>> 0, 4);
  const h = crypto.createHmac('sha1', cle).update(bloc).digest();
  const decalage = h[h.length - 1] & 0x0f;
  const binaire =
    ((h[decalage] & 0x7f) << 24) |
    ((h[decalage + 1] & 0xff) << 16) |
    ((h[decalage + 2] & 0xff) << 8) |
    (h[decalage + 3] & 0xff);
  return String(binaire % Math.pow(10, n)).padStart(n, '0');
}

function code(secret, t, chiffres) {
  return codePourCompteur(secret, compteurPour(t), chiffres);
}

function egalConstant(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/*
 * Verifie une saisie.
 *
 * `apres` est le dernier compteur deja accepte : tout code appartenant a ce
 * pas ou a un pas anterieur est refuse. Sans cela, un code vu par-dessus
 * l'epaule (ou relu dans un journal) resterait utilisable pendant sa demi-
 * minute de vie, et la fenetre de tolerance l'etendrait a une minute et demie.
 *
 * Renvoie { ok, compteur } — le compteur est a conserver pour l'appel suivant.
 */
function verifier(secret, saisie, options) {
  const o = options || {};
  const brut = String(saisie == null ? '' : saisie).replace(/[\s-]/g, '');
  const chiffres = o.chiffres || CHIFFRES;
  if (!new RegExp('^[0-9]{' + chiffres + '}$').test(brut)) return { ok: false, compteur: 0 };

  let cle;
  try { cle = base32Decode(secret); } catch (e) { return { ok: false, compteur: 0 }; }
  if (!cle.length) return { ok: false, compteur: 0 };

  const centre = compteurPour(o.t);
  const fenetre = Number.isFinite(o.fenetre) ? o.fenetre : FENETRE;
  const apres = Number.isFinite(o.apres) ? o.apres : -1;

  // On parcourt toute la fenetre meme apres avoir trouve : le temps de reponse
  // ne doit pas dire ou le code est tombe.
  let trouve = 0;
  for (let d = -fenetre; d <= fenetre; d++) {
    const c = centre + d;
    if (c <= apres) continue;
    if (egalConstant(codePourCompteur(secret, c, chiffres), brut) && !trouve) trouve = c;
  }
  return { ok: trouve > 0, compteur: trouve };
}

// L'URI que lisent les applications d'authentification.
function uriOtpauth(secret, compte, emetteur) {
  const e = encodeURIComponent(emetteur || 'Maison Solstice');
  const c = encodeURIComponent(compte || 'back-office');
  return (
    'otpauth://totp/' + e + ':' + c +
    '?secret=' + secret +
    '&issuer=' + e +
    '&algorithm=SHA1&digits=' + CHIFFRES + '&period=' + PAS_S
  );
}

// Presentation du secret pour une saisie a la main : des groupes de quatre.
function secretLisible(secret) {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

module.exports = {
  base32Encode, base32Decode, genererSecret,
  compteurPour, codePourCompteur, code, verifier,
  uriOtpauth, secretLisible,
  PAS_S, CHIFFRES, FENETRE
};
