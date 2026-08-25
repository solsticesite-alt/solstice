// Le montant d'une demande : calculé au moment où elle arrive, et conservé.
//
// Il sert à deux choses : afficher d'un coup d'œil ce que pèse une demande, et
// garder trace de ce qui a été annoncé au client ce jour-là. Il ne remplace
// jamais une facture émise — celle-ci fait foi, c'est elle qui est partie.
//
// La règle de calcul est volontairement la MÊME que celle du panier :
// une pièce facturée au week-end garde son tarif, une pièce au jour est
// multipliée par la durée. Si les deux divergeaient, le client verrait un
// total sur le site et un autre dans sa boîte mail.

const test = require('node:test');
const assert = require('node:assert');

const devis = require('../api/devis.js');
const pieces = require('../pieces.js');

let enregistrees = [];
let idSuivant = 1;

global.__solMockBackend = {
  async nextId() { return idSuivant++; },
  async putRequest(o) { enregistrees.push(o); },
  async getRequest(id) { return enregistrees.find((r) => r.id === Number(id)) || null; },
  async listRequests() { return enregistrees.slice().reverse(); },
  async listOldestRequests() { return enregistrees.slice(); },
  async getSettingsRow() { return {}; },
  async putSettingsRow() {},
  async deleteRequest() {},
  async deleteRequests() {}
};

require('../api/_lib/mail').mailReady = () => false;

function faireRes() {
  return {
    statusCode: 200, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k] = v; },
    getHeader(k) { return this.entetes[k]; },
    end(s) { try { this.corps = JSON.parse(s); } catch (e) { this.corps = s; } }
  };
}

async function envoyer(items, extra) {
  const res = faireRes();
  await devis({
    method: 'POST', url: '/api/devis',
    headers: { 'x-real-ip': 'ip-montant-' + Math.random(), host: 'maison-solstice.fr' },
    socket: {}, on() {},
    body: Object.assign({
      name: 'Camille Test', email: 'camille@example.com', phone: '0600000000',
      eventType: 'Mariage', date: '2026-09-12', location: 'Amiens', guests: 80,
      message: '', payment: 'acompte', items, website: ''
    }, extra || {})
  }, res);
  return { res, demande: enregistrees[enregistrees.length - 1] };
}

const neuf = () => { enregistrees = []; idSuivant = 1; };
const CHAISE = { name: 'Chaise', ref: 'chaise-napoleon-transparente', piece: 'chaise-napoleon-transparente' };
const ARCHE = { name: 'Arche', ref: 'arche-ronde-en-bois-clair', piece: 'arche-ronde-en-bois-clair' };

/* ---------- le calcul ---------- */

test('une pièce au tarif journalier compte une fois par jour', async () => {
  neuf();
  const jour = await envoyer([Object.assign({ qty: 80 }, CHAISE)], { duration: 'jour' });
  assert.strictEqual(jour.demande.montant, 80 * 4, 'une journée');

  const we = await envoyer([Object.assign({ qty: 80 }, CHAISE)], { duration: 'weekend' });
  assert.strictEqual(we.demande.montant, 80 * 4 * 2, 'un week-end coûte le double');
});

// L'arche est facturée au week-end : sa durée ne la multiplie pas.
test('une pièce au forfait week-end garde son tarif quelle que soit la durée', async () => {
  neuf();
  const jour = await envoyer([Object.assign({ qty: 1 }, ARCHE)], { duration: 'jour' });
  const we = await envoyer([Object.assign({ qty: 1 }, ARCHE)], { duration: 'weekend' });
  assert.strictEqual(jour.demande.montant, 45);
  assert.strictEqual(we.demande.montant, 45, 'le forfait ne doit pas doubler');
});

test('un panier mixte additionne les deux règles', async () => {
  neuf();
  const { demande } = await envoyer([
    Object.assign({ qty: 80 }, CHAISE),   // 4 € / jour
    Object.assign({ qty: 1 }, ARCHE)      // 45 € / week-end
  ], { duration: 'weekend' });
  assert.strictEqual(demande.montant, 80 * 4 * 2 + 45);
});

test('le montant correspond à ce que le panier a montré au client', async () => {
  neuf();
  // Règle du panier (panier.js, lineTotal) rejouée à l'identique.
  const panier = (items, jours) => items.reduce((n, it) => {
    const p = pieces.par(it.piece);
    if (!p) return n;
    return n + p.prix * it.qty * (p.unite === 'week-end' ? 1 : jours);
  }, 0);
  const items = [Object.assign({ qty: 30 }, CHAISE), Object.assign({ qty: 2 }, ARCHE)];
  for (const [duree, jours] of [['jour', 1], ['weekend', 2]]) {
    const { demande } = await envoyer(items, { duration: duree });
    assert.strictEqual(demande.montant, panier(items, jours), 'durée ' + duree);
  }
});

/* ---------- ce qui n'est pas chiffré ---------- */

test('les pièces sans tarif sont comptées à part, jamais à zéro dans le total', async () => {
  neuf();
  const { demande } = await envoyer([
    Object.assign({ qty: 10 }, CHAISE),
    { name: 'Coin lounge', ref: 'x-lounge', piece: 'coin-lounge', qty: 1 }
  ], { duration: 'jour' });
  assert.strictEqual(demande.montant, 40, 'seul le chiffrable est additionné');
  assert.strictEqual(demande.aChiffrer, 1, 'et le reste est signalé');
});

test('une demande entièrement non chiffrée vaut zéro ET le signale', async () => {
  neuf();
  const { demande } = await envoyer([{ name: 'Coin lounge', ref: 'x', piece: 'coin-lounge', qty: 1 }]);
  assert.strictEqual(demande.montant, 0);
  assert.strictEqual(demande.aChiffrer, 1);
});

/* ---------- les modalités ---------- */

test('la durée et le mode de remise sont enregistrés, plus seulement racontés', async () => {
  neuf();
  const { demande } = await envoyer([Object.assign({ qty: 1 }, CHAISE)],
    { duration: 'weekend', delivery: 'livraison' });
  assert.deepStrictEqual(demande.modalites, { duree: 'weekend', remise: 'livraison', jours: 2 });
});

test('une durée ou une remise inconnue retombe sur la valeur la plus prudente', async () => {
  neuf();
  for (const mauvais of ['3 semaines', '', null, 42, {}, 'WEEKEND']) {
    const { demande } = await envoyer([Object.assign({ qty: 1 }, CHAISE)],
      { duration: mauvais, delivery: mauvais });
    assert.strictEqual(demande.modalites.duree, 'jour', JSON.stringify(String(mauvais)));
    assert.strictEqual(demande.modalites.remise, 'retrait', JSON.stringify(String(mauvais)));
    assert.strictEqual(demande.montant, 4, 'et le montant suit la durée retenue');
  }
});

/* ---------- ce que la liste affiche ---------- */

// Règle de api/admin/requests.js, rejouée : une facture émise fait foi.
function montantListe(r) {
  return r.reply && typeof r.reply.total === 'number'
    ? r.reply.total
    : (typeof r.montant === 'number' ? r.montant : null);
}

test('une facture émise prime sur l’estimation', () => {
  const r = { montant: 500, reply: { total: 420 } };
  assert.strictEqual(montantListe(r), 420, 'c’est la facture qui est partie au client');
});

test('sans facture, l’estimation fait foi', () => {
  assert.strictEqual(montantListe({ montant: 500, reply: null }), 500);
});

test('une demande ancienne, sans montant enregistré, ne casse pas la liste', () => {
  // Les demandes reçues avant cette version n'ont pas de champ `montant`.
  assert.strictEqual(montantListe({ reply: null }), null);
  assert.strictEqual(montantListe({ montant: undefined, reply: null }), null);
});

test('un montant nul reste un montant, pas une absence', () => {
  assert.strictEqual(montantListe({ montant: 0, reply: null }), 0);
});
