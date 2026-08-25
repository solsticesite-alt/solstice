// Le délai avant l'événement, et le tri qui en découle.
//
// Constat qui a motivé ce code : sur neuf demandes de démonstration, six
// portaient sur une date DÉJÀ PASSÉE, et rien ne les distinguait des autres.
// Pire, la liste étant triée par date de demande, l'événement le plus proche
// (cinq jours) s'affichait sous un événement à dix-huit jours.
//
// Ces deux fonctions vivent dans admin.js, qui s'exécute dans un navigateur ;
// on en rejoue ici la règle exacte, celle qui décide de ce que la gérante voit.

const test = require('node:test');
const assert = require('node:assert');

/* ---------- la règle, telle qu'elle est écrite dans admin.js ---------- */

function delai(dateStr, aujourdhui) {
  if (!dateStr) return null;
  var d = new Date(dateStr); if (isNaN(d)) return null;
  var jour = function (x) { return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()); };
  var n = Math.round((jour(d) - jour(aujourdhui || new Date())) / 86400000);
  if (n < 0) return { n: n, classe: 'passe', texte: 'passé' };
  if (n === 0) return { n: 0, classe: 'proche', texte: "aujourd'hui" };
  if (n === 1) return { n: 1, classe: 'proche', texte: 'demain' };
  if (n <= 14) return { n: n, classe: 'proche', texte: 'dans ' + n + ' jours' };
  if (n <= 60) return { n: n, classe: 'venir', texte: 'dans ' + Math.round(n / 7) + ' semaines' };
  return { n: n, classe: 'venir', texte: 'dans ' + Math.round(n / 30.5) + ' mois' };
}

function trier(items, aujourdhui) {
  return items.slice().sort(function (a, b) {
    var da = delai(a.date, aujourdhui), db = delai(b.date, aujourdhui);
    if (!da && !db) return b.id - a.id;
    if (!da) return 1;
    if (!db) return -1;
    var pa = da.n < 0, pb = db.n < 0;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? db.n - da.n : da.n - db.n;
  });
}

const AUJ = new Date('2026-08-25T10:00:00');
const d = (s) => delai(s, AUJ);

/* ---------- le délai ---------- */

test('aujourd’hui, demain et les jours proches sont nommés', () => {
  assert.strictEqual(d('2026-08-25').texte, "aujourd'hui");
  assert.strictEqual(d('2026-08-26').texte, 'demain');
  assert.strictEqual(d('2026-08-30').texte, 'dans 5 jours');
  assert.strictEqual(d('2026-09-08').texte, 'dans 14 jours');
});

// Le cas qui a motivé la comparaison en JOURS plutôt qu'en instants : un
// événement le soir même ne doit pas être annoncé « passé » dès le matin.
test('un événement du jour même n’est jamais annoncé passé', () => {
  for (const heure of ['T00:00:00', 'T08:00:00', 'T23:59:00']) {
    const r = delai('2026-08-25' + heure, new Date('2026-08-25T18:30:00'));
    assert.strictEqual(r.texte, "aujourd'hui", heure);
    assert.ok(r.n >= 0);
  }
});

test('au-delà de deux semaines, on passe aux semaines puis aux mois', () => {
  assert.strictEqual(d('2026-09-12').texte, 'dans 3 semaines');
  assert.strictEqual(d('2026-10-04').texte, 'dans 6 semaines');
  assert.match(d('2026-12-24').texte, /dans \d+ mois/);
  assert.strictEqual(d('2027-08-25').texte, 'dans 12 mois');
});

test('une date passée est signalée comme telle', () => {
  for (const s of ['2026-08-24', '2026-07-19', '2025-01-01']) {
    const r = d(s);
    assert.strictEqual(r.texte, 'passé', s);
    assert.strictEqual(r.classe, 'passe');
    assert.ok(r.n < 0);
  }
});

test('les trois classes correspondent à trois urgences distinctes', () => {
  assert.strictEqual(d('2026-08-27').classe, 'proche');
  assert.strictEqual(d('2026-10-04').classe, 'venir');
  assert.strictEqual(d('2026-01-01').classe, 'passe');
});

test('une date absente ou illisible ne produit rien, sans jeter', () => {
  for (const v of [null, undefined, '', 'pas une date', '0000-00-00', {}, [], 0, NaN]) {
    assert.strictEqual(d(v), null, JSON.stringify(String(v)));
  }
});

/* ---------- le tri ---------- */

const DEMANDES = [
  { id: 9, clientName: 'Camille Durand', date: '2026-09-12' },  // dans 18 j
  { id: 8, clientName: 'Léa Marchand', date: '2026-08-30' },    // dans 5 j
  { id: 7, clientName: 'Thomas Bernard', date: '2026-10-04' },  // dans 40 j
  { id: 6, clientName: 'Sofia Ferreira', date: '2026-07-19' },  // passé
  { id: 5, clientName: 'Antoine Lefèvre', date: '2026-06-21' }, // passé, plus ancien
  { id: 4, clientName: 'Sans date', date: null }
];

test('le plus urgent remonte en tête', () => {
  const ordre = trier(DEMANDES, AUJ).map((x) => x.clientName);
  assert.strictEqual(ordre[0], 'Léa Marchand', 'l’événement dans 5 jours doit passer devant');
  assert.strictEqual(ordre[1], 'Camille Durand');
  assert.strictEqual(ordre[2], 'Thomas Bernard');
});

test('les événements passés sont rejetés après ceux à venir', () => {
  const ordre = trier(DEMANDES, AUJ).map((x) => x.clientName);
  const dernierAVenir = ordre.indexOf('Thomas Bernard');
  const premierPasse = ordre.indexOf('Sofia Ferreira');
  assert.ok(premierPasse > dernierAVenir, 'un événement passé ne doit pas devancer un événement à venir');
});

test('entre événements passés, le plus récent est en tête', () => {
  const ordre = trier(DEMANDES, AUJ).map((x) => x.clientName);
  assert.ok(ordre.indexOf('Sofia Ferreira') < ordre.indexOf('Antoine Lefèvre'),
    'juillet doit devancer juin');
});

test('une demande sans date ne remonte jamais en tête par accident', () => {
  const ordre = trier(DEMANDES, AUJ).map((x) => x.clientName);
  assert.strictEqual(ordre[ordre.length - 1], 'Sans date');
});

test('le tri ne modifie pas la liste d’origine', () => {
  const avant = DEMANDES.map((x) => x.id);
  trier(DEMANDES, AUJ);
  assert.deepStrictEqual(DEMANDES.map((x) => x.id), avant);
});

test('le tri est stable et ne perd aucune demande', () => {
  const t = trier(DEMANDES, AUJ);
  assert.strictEqual(t.length, DEMANDES.length);
  assert.deepStrictEqual(t.map((x) => x.id).sort(), DEMANDES.map((x) => x.id).sort());
});

test('un jeu entièrement passé ou entièrement à venir ne casse pas le tri', () => {
  const passes = [{ id: 1, date: '2026-01-01' }, { id: 2, date: '2026-05-01' }];
  assert.deepStrictEqual(trier(passes, AUJ).map((x) => x.id), [2, 1], 'le plus récent d’abord');
  const venir = [{ id: 1, date: '2027-01-01' }, { id: 2, date: '2026-09-01' }];
  assert.deepStrictEqual(trier(venir, AUJ).map((x) => x.id), [2, 1], 'le plus proche d’abord');
  assert.deepStrictEqual(trier([], AUJ), []);
});

/* ---------- le filtre « À venir » ---------- */

function filtrerAVenir(items, aujourdhui) {
  return items.filter(function (it) {
    var x = delai(it.date, aujourdhui);
    return Boolean(x) && x.n >= 0;
  });
}

test('« À venir » ne garde que ce qui reste à préparer', () => {
  const restants = filtrerAVenir(DEMANDES, AUJ).map((x) => x.clientName);
  assert.deepStrictEqual(restants.sort(), ['Camille Durand', 'Léa Marchand', 'Thomas Bernard'].sort());
});

test('« À venir » garde l’événement du jour même', () => {
  const liste = [{ id: 1, clientName: 'Ce soir', date: '2026-08-25' }];
  assert.strictEqual(filtrerAVenir(liste, AUJ).length, 1);
});

test('« À venir » écarte les demandes sans date plutôt que de les supposer à venir', () => {
  assert.strictEqual(filtrerAVenir([{ id: 1, date: null }], AUJ).length, 0);
});
