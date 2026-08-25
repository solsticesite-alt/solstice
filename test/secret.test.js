const test = require('node:test');
const assert = require('node:assert');
const secret = require('../api/_lib/secret');

test('un mot de passe se verifie contre son empreinte', () => {
  const h = secret.hacher('correct horse battery staple');
  assert.strictEqual(secret.verifierHash('correct horse battery staple', h), true);
  assert.strictEqual(secret.verifierHash('correct horse battery stapl', h), false);
  assert.strictEqual(secret.verifierHash('', h), false);
});

test('deux hachages du meme mot de passe different (sel aleatoire)', () => {
  const a = secret.hacher('pareil');
  const b = secret.hacher('pareil');
  assert.notStrictEqual(a, b, 'sans sel unique, deux comptes identiques se verraient');
  assert.strictEqual(secret.verifierHash('pareil', a), true);
  assert.strictEqual(secret.verifierHash('pareil', b), true);
});

test('le format de l empreinte est reconnaissable', () => {
  assert.strictEqual(secret.estUnHash(secret.hacher('x')), true);
  for (const mauvais of ['', 'x', 'scrypt$', 'scrypt$a$b$c$d$e', null, undefined, 42, {}]) {
    assert.strictEqual(secret.estUnHash(mauvais), false, JSON.stringify(mauvais));
  }
});

test('une empreinte abimee ne valide rien, et ne jette pas', () => {
  const bon = secret.hacher('mot');
  const abimes = [
    bon.replace('scrypt', 'bcrypt'),
    bon + 'AAAA',
    'scrypt$0$0$0$AAAA$AAAA',
    'scrypt$99999999$8$1$AAAA$AAAA',
    'scrypt$16385$8$1$AAAAAAAAAAAA$AAAA',   // N pas une puissance de deux
    'scrypt$16384$0$1$AAAAAAAAAAAA$AAAA',   // r nul
    'scrypt$16384$8$0$AAAAAAAAAAAA$AAAA'    // p nul
  ];
  for (const a of abimes) {
    assert.strictEqual(secret.verifierHash('mot', a), false, a.slice(0, 30));
  }
});

// Le defaut trouve en ecrivant ces tests : scrypt produit, pour une sortie
// courte, le prefixe exact de la sortie longue. Deriver la longueur de ce qui
// est stocke rendait donc l'empreinte affaiblissable par simple troncature —
// jusqu'a un seul octet, ou n'importe quel mot de passe passe une fois sur 256.
test('une empreinte tronquee ne valide plus, a AUCUNE longueur', () => {
  const bon = secret.hacher('mot');
  const [, n, r, p, sel, empreinte] = bon.split('$');
  for (let coupe = 1; coupe < empreinte.length; coupe++) {
    const tronquee = ['scrypt', n, r, p, sel, empreinte.slice(0, empreinte.length - coupe)].join('$');
    assert.strictEqual(secret.verifierHash('mot', tronquee), false,
      'tronquee de ' + coupe + ' caractere(s)');
  }
});

test('un sel tronque ne valide pas non plus', () => {
  const bon = secret.hacher('mot');
  const [, n, r, p, sel, empreinte] = bon.split('$');
  for (let coupe = 1; coupe < sel.length; coupe++) {
    const t = ['scrypt', n, r, p, sel.slice(0, sel.length - coupe), empreinte].join('$');
    assert.strictEqual(secret.verifierHash('mot', t), false, 'sel tronque de ' + coupe);
  }
});

// Idem cote codes de secours : ils vivent en base, donc a portee de quiconque
// obtiendrait un acces en ecriture. Les affaiblir ne doit pas etre possible.
test('un code de secours a l empreinte tronquee ne passe plus', () => {
  const { clairs, haches } = secret.genererCodesSecours(3);
  const morceaux = haches[1].split('$');
  morceaux[5] = morceaux[5].slice(0, 8);
  const affaiblis = haches.slice();
  affaiblis[1] = morceaux.join('$');
  assert.strictEqual(secret.trouverCodeSecours(clairs[1], affaiblis), -1);
  // Et surtout : aucun autre code ne doit tomber dessus par hasard.
  assert.strictEqual(secret.trouverCodeSecours('ABCDE-ABCDE', affaiblis), -1);
});

test('la comparaison en clair ne trahit pas la longueur', () => {
  assert.strictEqual(secret.egalConstant('abc', 'abc'), true);
  assert.strictEqual(secret.egalConstant('abc', 'abd'), false);
  assert.strictEqual(secret.egalConstant('abc', 'abcdefghij'), false);
  assert.strictEqual(secret.egalConstant('', ''), true);
  assert.strictEqual(secret.egalConstant(null, ''), true, 'null vaut la chaine vide');
  assert.strictEqual(secret.egalConstant('a', null), false);
});

/* ---------- codes de secours ---------- */

test('les codes de secours sont lisibles et uniques', () => {
  const { clairs, haches } = secret.genererCodesSecours(8);
  assert.strictEqual(clairs.length, 8);
  assert.strictEqual(haches.length, 8);
  assert.strictEqual(new Set(clairs).size, 8, 'aucun doublon');
  for (const c of clairs) {
    assert.match(c, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/, c);
    // Ni I, ni O, ni 0, ni 1 : on les confond a la lecture.
    assert.ok(!/[IO01]/.test(c), 'caractere ambigu dans ' + c);
  }
});

test('un code de secours se retrouve dans la liste, quelle que soit la casse', () => {
  const { clairs, haches } = secret.genererCodesSecours(5);
  assert.strictEqual(secret.trouverCodeSecours(clairs[3], haches), 3);
  assert.strictEqual(secret.trouverCodeSecours(clairs[3].toLowerCase(), haches), 3);
  assert.strictEqual(secret.trouverCodeSecours(clairs[3].replace('-', ''), haches), 3);
  assert.strictEqual(secret.trouverCodeSecours(clairs[3].replace('-', ' '), haches), 3);
});

test('un code inconnu ou malforme ne trouve rien', () => {
  const { haches } = secret.genererCodesSecours(5);
  for (const m of ['AAAAA-AAAAA', '', null, undefined, 'trop-court', 'ABCDE-ABCDEF', 'ABCDE-ABCD1', {}, []]) {
    assert.strictEqual(secret.trouverCodeSecours(m, haches), -1, JSON.stringify(String(m)));
  }
});

test('chercher dans une liste vide ou absente ne jette pas', () => {
  assert.strictEqual(secret.trouverCodeSecours('ABCDE-ABCDE', []), -1);
  assert.strictEqual(secret.trouverCodeSecours('ABCDE-ABCDE', null), -1);
  assert.strictEqual(secret.trouverCodeSecours('ABCDE-ABCDE', undefined), -1);
});

test('un code de secours ne vaut pas comme mot de passe et inversement', () => {
  const { clairs, haches } = secret.genererCodesSecours(3);
  const hashMdp = secret.hacher('mon-mot-de-passe');
  assert.strictEqual(secret.verifierHash(clairs[0], hashMdp), false);
  assert.strictEqual(secret.trouverCodeSecours('mon-mot-de-passe', haches), -1);
});
