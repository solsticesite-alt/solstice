// Freinage des tentatives de connexion au back-office.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');

// Aucune variable Supabase n'est definie pendant les tests : le module
// retombe volontairement sur son compteur en memoire, ce qui est exactement
// le chemin de repli qu'on veut verifier.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SESSION_SECRET = 'sel-de-test';

const frein = require('../api/_lib/ratelimit');

// Chaque test part d'une adresse differente pour ne pas heriter du compteur
// laisse par le precedent.
let n = 0;
const req = (ip) => ({ headers: { 'x-real-ip': ip || 'ip-test-' + ++n }, socket: {} });

test('sous le seuil, on ralentit sans bloquer', async () => {
  const r = req();
  for (let i = 1; i < frein.SEUIL; i++) {
    const e = await frein.echec(r);
    assert.strictEqual(e.bloque, false, 'essai ' + i + ' ne doit pas bloquer');
    assert.ok(e.freinMs > 0, 'la reponse est freinee des le premier echec');
  }
  assert.strictEqual((await frein.etat(r)).bloque, false);
});

test('au seuil, l adresse est mise en attente', async () => {
  const r = req();
  let e;
  for (let i = 0; i < frein.SEUIL; i++) e = await frein.echec(r);
  assert.strictEqual(e.bloque, true);
  assert.strictEqual(e.resteMs, 60 * 1000, 'la premiere attente est d une minute');
  assert.strictEqual((await frein.etat(r)).bloque, true);
});

test('l attente double a chaque erreur supplementaire, sans depasser six heures', () => {
  assert.strictEqual(frein.attentePour(0), 0);
  assert.strictEqual(frein.attentePour(frein.SEUIL - 1), 0);
  assert.strictEqual(frein.attentePour(frein.SEUIL), 60 * 1000);
  assert.strictEqual(frein.attentePour(frein.SEUIL + 1), 120 * 1000);
  assert.strictEqual(frein.attentePour(frein.SEUIL + 4), 16 * 60 * 1000);
  assert.strictEqual(frein.attentePour(frein.SEUIL + 40), 6 * 60 * 60 * 1000, 'plafond a six heures');
});

test('une connexion reussie remet le compteur a zero', async () => {
  const r = req();
  for (let i = 0; i < frein.SEUIL + 2; i++) await frein.echec(r);
  assert.strictEqual((await frein.etat(r)).bloque, true);
  await frein.succes(r);
  const apres = await frein.etat(r);
  assert.strictEqual(apres.fails, 0);
  assert.strictEqual(apres.bloque, false);
});

// Sans cet oubli, une erreur d'il y a six mois compterait encore.
test('le compteur s oublie apres une longue accalmie', async () => {
  const r = req();
  const jadis = Date.now() - frein.OUBLI_MS - 1000;
  for (let i = 0; i < frein.SEUIL + 3; i++) await frein.echec(r, jadis);
  const apres = await frein.etat(r);
  assert.strictEqual(apres.fails, 0, 'les echecs anciens ne comptent plus');
  assert.strictEqual(apres.bloque, false);
  // Et le compteur repart bien de 1, pas de la valeur d'avant.
  assert.strictEqual((await frein.echec(r)).fails, 1);
});

// Deux visiteurs differents ne doivent pas se bloquer l'un l'autre.
test('le comptage est propre a chaque adresse', async () => {
  const a = req('ip-voisine-a'), b = req('ip-voisine-b');
  for (let i = 0; i < frein.SEUIL; i++) await frein.echec(a);
  assert.strictEqual((await frein.etat(a)).bloque, true);
  assert.strictEqual((await frein.etat(b)).bloque, false, 'le voisin reste libre');
});

test('l adresse est lue dans les en-tetes, avec repli sur la socket', () => {
  assert.strictEqual(frein.adresseDe({ headers: { 'x-real-ip': '1.2.3.4' }, socket: {} }), '1.2.3.4');
  assert.strictEqual(
    frein.adresseDe({ headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }, socket: {} }),
    '5.6.7.8',
    'la premiere adresse de la chaine est celle du visiteur'
  );
  assert.strictEqual(frein.adresseDe({ headers: {}, socket: { remoteAddress: '10.0.0.1' } }), '10.0.0.1');
  // Sans rien du tout, on renvoie une cle constante plutot que de planter :
  // toutes les tentatives anonymes partagent alors le meme compteur.
  assert.strictEqual(frein.adresseDe({ headers: {}, socket: {} }), 'inconnue');
  assert.strictEqual(frein.adresseDe(null), 'inconnue');
});

test('secondes arrondit vers le haut et ne descend jamais a zero', () => {
  assert.strictEqual(frein.secondes(1), 1);
  assert.strictEqual(frein.secondes(1500), 2);
  assert.strictEqual(frein.secondes(60000), 60);
});
