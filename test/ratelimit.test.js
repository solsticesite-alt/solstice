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

// ---------------------------------------------------------------------------
// Le chemin durable (Supabase). Une fausse base, volontairement minimale, qui
// reproduit les quatre requetes utilisees : select / upsert / delete par cle /
// delete par anciennete.
// ---------------------------------------------------------------------------
function fausseBase() {
  const lignes = new Map();
  const journal = [];
  return {
    lignes,
    journal,
    from() {
      const filtres = [];
      const api = {
        select() { return api; },
        eq(col, val) { filtres.push(['eq', col, val]); return api; },
        lt(col, val) { filtres.push(['lt', col, val]); return api; },
        async maybeSingle() {
          journal.push('select');
          const f = filtres.find((x) => x[0] === 'eq');
          const l = f ? lignes.get(f[2]) : null;
          return { data: l || null, error: null };
        },
        async upsert(row) {
          journal.push('upsert');
          lignes.set(row.ip_hash, row);
          return { error: null };
        },
        delete() {
          const suppr = {
            async eq(col, val) { journal.push('delete-eq'); lignes.delete(val); return { error: null }; },
            async lt(col, val) {
              journal.push('delete-lt');
              const limite = Date.parse(val);
              for (const [k, v] of lignes) if (Date.parse(v.last_fail) < limite) lignes.delete(k);
              return { error: null };
            }
          };
          return suppr;
        }
      };
      return api;
    }
  };
}

test('avec la base, le compteur y est ecrit et relu', async (t) => {
  const db = fausseBase();
  global.__solMockLoginDb = db;
  t.after(() => { delete global.__solMockLoginDb; });

  const r = req('ip-durable');
  await frein.echec(r);
  assert.strictEqual(db.lignes.size, 1, 'une ligne creee');
  assert.strictEqual([...db.lignes.values()][0].fails, 1);

  await frein.echec(r);
  assert.strictEqual(db.lignes.size, 1, 'la meme ligne est mise a jour');
  assert.strictEqual([...db.lignes.values()][0].fails, 2, 'le compte suit');

  await frein.succes(r);
  assert.strictEqual(db.lignes.size, 0, 'la reussite efface la ligne');
});

// Le defaut trouve en relecture : rien ne supprimait les compteurs abandonnes.
// Des milliers d'adresses differentes auraient fait grossir la table sans fin.
test('les compteurs oublies sont balayes quand un nouveau commence', async (t) => {
  const db = fausseBase();
  global.__solMockLoginDb = db;
  t.after(() => { delete global.__solMockLoginDb; });

  const vieux = new Date(Date.now() - frein.OUBLI_MS - 60000).toISOString();
  for (let i = 0; i < 5; i++) db.lignes.set('ancien-' + i, { ip_hash: 'ancien-' + i, fails: 3, last_fail: vieux });
  db.lignes.set('recent', { ip_hash: 'recent', fails: 2, last_fail: new Date().toISOString() });

  await frein.echec(req('ip-neuve'));

  assert.ok(!db.journal.includes('delete-eq'), 'aucune suppression ciblee ici');
  assert.ok(db.journal.includes('delete-lt'), 'le balayage a bien eu lieu');
  assert.strictEqual(db.lignes.size, 2, 'les cinq compteurs abandonnes sont partis');
  assert.ok(db.lignes.has('recent'), 'le compteur encore vivant est conserve');
  assert.strictEqual([...db.lignes.keys()].filter((k) => k.startsWith('ancien-')).length, 0);
  // La cle stockee est l'empreinte de l'adresse, jamais l'adresse elle-meme.
  const nouvelle = [...db.lignes.keys()].find((k) => k !== 'recent');
  assert.match(nouvelle, /^[0-9a-f]{32}$/, 'la nouvelle ligne est indexee par une empreinte');
  assert.ok(!db.lignes.has('ip-neuve'), 'l adresse en clair n apparait nulle part');
});

test('le balayage ne se declenche pas a chaque tentative', async (t) => {
  const db = fausseBase();
  global.__solMockLoginDb = db;
  t.after(() => { delete global.__solMockLoginDb; });

  const r = req('ip-repetee');
  await frein.echec(r);
  const apresLePremier = db.journal.filter((x) => x === 'delete-lt').length;
  for (let i = 0; i < 6; i++) await frein.echec(r);
  const total = db.journal.filter((x) => x === 'delete-lt').length;
  assert.strictEqual(apresLePremier, 1, 'un balayage au premier echec');
  assert.strictEqual(total, 1, 'et aucun pour les six suivants');
});

// Si la base tombe, la connexion doit rester possible : on bascule en memoire.
test('une base en panne ne ferme pas le back-office', async (t) => {
  global.__solMockLoginDb = {
    from() {
      const boom = () => { throw new Error('base injoignable'); };
      return { select: boom, upsert: boom, delete: boom, eq: boom, lt: boom, maybeSingle: boom };
    }
  };
  t.after(() => { delete global.__solMockLoginDb; });

  const r = req('ip-panne');
  const e = await frein.echec(r);
  assert.strictEqual(e.fails, 1, 'le comptage continue en memoire');
  assert.strictEqual(e.bloque, false);
  await assert.doesNotReject(() => frein.succes(r));
});
