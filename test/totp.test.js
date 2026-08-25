const test = require('node:test');
const assert = require('node:assert');
const totp = require('../api/_lib/totp');

// Le secret des vecteurs officiels : la chaine ASCII "12345678901234567890".
const SECRET_RFC = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));

test('le secret des vecteurs RFC se code bien en base32', () => {
  assert.strictEqual(SECRET_RFC, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

// RFC 6238, annexe B — la table de reference pour HMAC-SHA1.
const VECTEURS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130']
];

test('les six vecteurs de la RFC 6238 tombent juste (8 chiffres)', () => {
  for (const [secondes, attendu] of VECTEURS) {
    assert.strictEqual(totp.code(SECRET_RFC, secondes * 1000, 8), attendu, 'a T=' + secondes);
  }
});

test('les memes vecteurs tombent juste en 6 chiffres', () => {
  for (const [secondes, attendu] of VECTEURS) {
    assert.strictEqual(totp.code(SECRET_RFC, secondes * 1000), attendu.slice(-6), 'a T=' + secondes);
  }
});

test('le compteur au-dela de 2^32 est traite correctement', () => {
  // T=20000000000 depasse 32 bits une fois divise par 30 ? Non : c'est
  // 666666666, qui tient. On force donc un compteur reellement enorme.
  const grand = 0x100000000 + 12345;
  const c = totp.codePourCompteur(SECRET_RFC, grand);
  assert.match(c, /^[0-9]{6}$/);
  // Et il differe du compteur tronque a 32 bits — preuve que la moitie haute compte.
  assert.notStrictEqual(c, totp.codePourCompteur(SECRET_RFC, 12345));
});

test('base32 fait l’aller-retour sur des tailles variees', () => {
  for (const n of [1, 2, 3, 4, 5, 10, 16, 20, 32, 64]) {
    const buf = Buffer.alloc(n, 0xa7);
    assert.deepStrictEqual(totp.base32Decode(totp.base32Encode(buf)), buf, 'taille ' + n);
  }
});

test('base32 tolere espaces, tirets et minuscules', () => {
  const attendu = totp.base32Decode(SECRET_RFC);
  assert.deepStrictEqual(totp.base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), attendu);
  assert.deepStrictEqual(totp.base32Decode('GEZD-GNBV-GY3T-QOJQ-GEZD-GNBV-GY3T-QOJQ'), attendu);
});

test('base32 refuse un caractere hors alphabet', () => {
  assert.throws(() => totp.base32Decode('GEZD1NBV'), /secret_invalide/);  // 1 n’existe pas
  assert.throws(() => totp.base32Decode('GEZD0NBV'), /secret_invalide/);  // 0 non plus
  assert.throws(() => totp.base32Decode(''), /secret_vide/);
});

test('un secret genere fait 32 caracteres base32 (160 bits)', () => {
  const s = totp.genererSecret();
  assert.strictEqual(s.length, 32);
  assert.match(s, /^[A-Z2-7]+$/);
  assert.notStrictEqual(s, totp.genererSecret());
});

/* ---------- verification ---------- */

const T0 = 1_700_000_000_000; // instant de reference arbitraire

test('le code courant est accepte', () => {
  const s = totp.genererSecret();
  const r = totp.verifier(s, totp.code(s, T0), { t: T0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.compteur, totp.compteurPour(T0));
});

test('les codes du pas precedent et du suivant sont acceptes (± 30 s)', () => {
  const s = totp.genererSecret();
  for (const decalage of [-30_000, 30_000]) {
    const r = totp.verifier(s, totp.code(s, T0 + decalage), { t: T0 });
    assert.strictEqual(r.ok, true, 'decalage ' + decalage);
  }
});

test('au-dela de la fenetre, le code est refuse', () => {
  const s = totp.genererSecret();
  for (const decalage of [-90_000, 90_000, 3_600_000]) {
    assert.strictEqual(totp.verifier(s, totp.code(s, T0 + decalage), { t: T0 }).ok, false, 'decalage ' + decalage);
  }
});

test('un code deja utilise ne repasse pas — meme dans sa fenetre de validite', () => {
  const s = totp.genererSecret();
  const c = totp.code(s, T0);
  const premier = totp.verifier(s, c, { t: T0 });
  assert.strictEqual(premier.ok, true);
  // Rejoue une seconde plus tard : le meme code, toujours valide dans l'absolu.
  const rejeu = totp.verifier(s, c, { t: T0 + 1000, apres: premier.compteur });
  assert.strictEqual(rejeu.ok, false, 'le rejeu doit etre refuse');
});

test('le code du pas suivant reste utilisable apres un code consomme', () => {
  const s = totp.genererSecret();
  const premier = totp.verifier(s, totp.code(s, T0), { t: T0 });
  const suivant = totp.verifier(s, totp.code(s, T0 + 30_000), { t: T0 + 30_000, apres: premier.compteur });
  assert.strictEqual(suivant.ok, true);
  assert.ok(suivant.compteur > premier.compteur);
});

test('un mauvais secret ne valide pas le code d’un autre', () => {
  const a = totp.genererSecret();
  const b = totp.genererSecret();
  assert.strictEqual(totp.verifier(b, totp.code(a, T0), { t: T0 }).ok, false);
});

test('les saisies malformees sont refusees sans exception', () => {
  const s = totp.genererSecret();
  const mauvaises = [null, undefined, '', '12345', '1234567', 'abcdef', '12 34 56', {}, [], '000000\n', '١٢٣٤٥٦'];
  for (const m of mauvaises) {
    const r = totp.verifier(s, m, { t: T0 });
    assert.strictEqual(r.ok, false, JSON.stringify(String(m)));
  }
});

test('les espaces et tirets dans la saisie sont tolerés', () => {
  const s = totp.genererSecret();
  const c = totp.code(s, T0);
  assert.strictEqual(totp.verifier(s, c.slice(0, 3) + ' ' + c.slice(3), { t: T0 }).ok, true);
  assert.strictEqual(totp.verifier(s, c.slice(0, 3) + '-' + c.slice(3), { t: T0 }).ok, true);
});

test('un secret invalide ne fait pas exploser la verification', () => {
  for (const s of [null, '', 'pas-du-base32-!!', undefined]) {
    assert.strictEqual(totp.verifier(s, '123456', { t: T0 }).ok, false);
  }
});

test('l’URI otpauth porte les bons parametres', () => {
  const s = totp.genererSecret();
  const uri = totp.uriOtpauth(s, 'contact@maison-solstice.fr', 'Maison Solstice');
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes('secret=' + s));
  assert.ok(uri.includes('issuer=Maison%20Solstice'));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));
  // Le compte contient un @ : il doit etre encode, sinon l'URI casse.
  assert.ok(uri.includes('contact%40maison-solstice.fr'));
});

test('le secret lisible se regroupe par quatre et reste decodable', () => {
  const s = totp.genererSecret();
  const lisible = totp.secretLisible(s);
  assert.ok(lisible.includes(' '));
  assert.deepStrictEqual(totp.base32Decode(lisible), totp.base32Decode(s));
});

// Une seconde de decalage d'horloge ne doit rien casser : c'est le cas le plus
// frequent en production, entre le telephone et le serveur.
test('un decalage d’horloge de quelques secondes passe', () => {
  const s = totp.genererSecret();
  for (const d of [-5000, -1000, 1000, 5000]) {
    assert.strictEqual(totp.verifier(s, totp.code(s, T0), { t: T0 + d }).ok, true, 'decalage ' + d);
  }
});
