// Durees de conservation : ce que la politique de confidentialite promet doit
// etre exactement ce que le code applique — ni plus, ni moins.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');
const store = require('../api/_lib/store');

const AN = 365.25 * 24 * 3600 * 1000;
const MAINTENANT = Date.parse('2026-08-07T12:00:00Z');
const ilYA = (ans) => new Date(MAINTENANT - ans * AN).toISOString();

const prospect = (id, ans) => ({ id, ref: 'F-' + id, createdAt: ilYA(ans), client: {} });
const facture = (id, ans) => ({
  id, ref: 'F-' + id, createdAt: ilYA(ans), client: {},
  reply: { sentAt: ilYA(ans), lines: [], subtotal: 100 }
});

test('une demande sans suite s efface apres trois ans', () => {
  assert.deepStrictEqual(store.aPurger([prospect(1, 4)], MAINTENANT), [1]);
  assert.deepStrictEqual(store.aPurger([prospect(2, 2.9)], MAINTENANT), [], 'pas encore trois ans');
  assert.deepStrictEqual(store.aPurger([prospect(3, 0)], MAINTENANT), [], 'recue aujourd hui');
});

// Une facture est une piece comptable : l'obligation legale de dix ans prime
// sur le confort de la purge.
test('une demande facturee est gardee dix ans', () => {
  assert.deepStrictEqual(store.aPurger([facture(10, 4)], MAINTENANT), [], 'quatre ans : on garde');
  assert.deepStrictEqual(store.aPurger([facture(11, 9.9)], MAINTENANT), [], 'presque dix ans : on garde');
  assert.deepStrictEqual(store.aPurger([facture(12, 11)], MAINTENANT), [12], 'onze ans : on efface');
});

// C'est la date du dernier evenement qui compte, pas celle de la reception :
// une demande de 2020 facturee en 2025 reste une piece de 2025.
test('c est le dernier contact qui fait foi', () => {
  const tardive = {
    id: 20, createdAt: ilYA(11), client: {},
    reply: { sentAt: ilYA(1), lines: [], subtotal: 50 }
  };
  assert.deepStrictEqual(store.aPurger([tardive], MAINTENANT), [], 'facturee il y a un an : on garde');
  assert.strictEqual(store.dernierContact(tardive), Date.parse(ilYA(1)));
});

// Le principe qui doit gouverner tout code de suppression : dans le doute,
// on garde. Une donnee effacee a tort ne revient jamais.
test('dans le doute, rien n est efface', () => {
  const cas = [
    { id: 30, createdAt: 'pas une date', client: {} },
    { id: 31, createdAt: '', client: {} },
    { id: 32, client: {} },
    { id: 33, createdAt: null, client: {} },
    { id: 34, createdAt: new Date(MAINTENANT + 5 * AN).toISOString(), client: {} }, // date future
    { createdAt: ilYA(20), client: {} },                                            // sans identifiant
    null,
    undefined
  ];
  assert.deepStrictEqual(store.aPurger(cas, MAINTENANT), []);
  assert.deepStrictEqual(store.aPurger(null, MAINTENANT), []);
  assert.deepStrictEqual(store.aPurger(undefined, MAINTENANT), []);
});

// Garde-fou : meme si la base contenait des milliers de lignes perimees, un
// seul passage ne peut pas tout emporter d'un coup.
test('un passage de balai est borne', () => {
  const beaucoup = [];
  for (let i = 1; i <= 500; i++) beaucoup.push(prospect(i, 5));
  const ids = store.aPurger(beaucoup, MAINTENANT);
  assert.strictEqual(ids.length, store.PURGE_MAX);
  assert.strictEqual(store.PURGE_MAX, 200);
});

test('le tri du bon grain et de l ivraie se fait dans un meme lot', () => {
  const lot = [
    prospect(40, 5),      // perime
    prospect(41, 1),      // recent
    facture(42, 5),       // facture, dans les dix ans
    facture(43, 12),      // facture, au-dela
    { id: 44, createdAt: 'nawak', client: {} } // illisible
  ];
  assert.deepStrictEqual(store.aPurger(lot, MAINTENANT).sort((a, b) => a - b), [40, 43]);
});

test('les durees correspondent a ce que le site annonce', () => {
  assert.strictEqual(Math.round(store.DUREE_PROSPECT / AN), 3);
  assert.strictEqual(Math.round(store.DUREE_COMPTABLE / AN), 10);
});
