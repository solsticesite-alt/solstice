// Le tarif que le client a vu doit arriver intact sur sa facture.
//
// La chaîne compte cinq maillons — panier du navigateur, envoi, serveur,
// enregistrement, back-office — et elle était rompue à trois endroits : le
// prix partait sous forme de texte, le serveur ne le conservait pas, et la
// facture repartait de zéro. La gérante retapait chaque montant, et rien ne
// garantissait qu'elle retape le bon.
//
// Deux exigences ici, et la seconde compte autant que la première :
//   1. le prix arrive jusqu'à la facture ;
//   2. il vient du catalogue de la maison, JAMAIS de ce que la page annonce.
//      Sinon il suffirait de modifier sa page pour commander au tarif de son
//      choix — et la facture partirait avec.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const pieces = require('../pieces.js');
const devis = require('../api/devis.js');

/* ---------- base et envoi simulés ---------- */

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

const mail = require('../api/_lib/mail');
mail.mailReady = () => false;   // l'envoi n'est pas le sujet de ce fichier

function faireReq(body, ip) {
  return {
    method: 'POST',
    url: '/api/devis',
    headers: { 'x-real-ip': ip || 'ip-tarif-' + Math.random(), host: 'maison-solstice.fr' },
    socket: {},
    body,
    on() {}
  };
}

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
  await devis(faireReq(Object.assign({
    name: 'Camille Test', email: 'camille@example.com', phone: '0600000000',
    eventType: 'Mariage', date: '2026-09-12', location: 'Amiens', guests: 80,
    message: '', payment: 'acompte', items, website: ''
  }, extra || {})), res);
  return { res, demande: enregistrees[enregistrees.length - 1] };
}

function neuf() { enregistrees = []; idSuivant = 1; }

/* ---------- le prix arrive jusqu'au bout ---------- */

test('une pièce du catalogue est chiffrée par le serveur', async () => {
  neuf();
  const { res, demande } = await envoyer([
    { name: 'Chaise Napoléon transparente', ref: 'chaise-napoleon-transparente', piece: 'chaise-napoleon-transparente', qty: 80 }
  ]);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.corps));
  const l = demande.items[0];
  assert.strictEqual(l.price, 4, 'le prix du catalogue doit être retenu');
  assert.strictEqual(l.unit, 'jour');
  assert.strictEqual(l.caution, 15);
  assert.strictEqual(l.qty, 80);
});

test('une pièce de formule est chiffrée par sa référence, pas par celle de la ligne', async () => {
  neuf();
  // Le panier identifie la ligne « terracotta-reception-chaises » ; c'est le
  // champ `piece` qui dit de quel objet du catalogue il s'agit.
  const { demande } = await envoyer([
    { name: 'Chaises', ref: 'terracotta-reception-chaises', piece: 'chaise-napoleon-transparente', qty: 20 }
  ]);
  const l = demande.items[0];
  assert.strictEqual(l.price, 4);
  assert.strictEqual(l.ref, 'terracotta-reception-chaises', 'la ligne garde son identité');
  assert.strictEqual(l.piece, 'chaise-napoleon-transparente');
});

test('sans champ `piece`, la référence de ligne sert de repli', async () => {
  neuf();
  const { demande } = await envoyer([
    { name: 'Nappe en lin lavé froissé', ref: 'nappe-en-lin-lave-froisse', qty: 4 }
  ]);
  assert.strictEqual(demande.items[0].price, 8);
});

test('une pièce absente du catalogue reste sans prix, sans faire échouer la demande', async () => {
  neuf();
  const { res, demande } = await envoyer([
    { name: 'Coin lounge', ref: 'terracotta-reception-coin-lounge', piece: 'coin-lounge', qty: 1 }
  ]);
  assert.strictEqual(res.statusCode, 200);
  const l = demande.items[0];
  assert.strictEqual(l.price, undefined, 'pas de prix inventé');
  assert.strictEqual(l.name, 'Coin lounge', 'le nom saisi est conservé');
});

/* ---------- et surtout : le navigateur ne décide pas du prix ---------- */

test('un prix envoyé par la page est IGNORÉ', async () => {
  neuf();
  const { demande } = await envoyer([
    { name: 'Chaise Napoléon transparente', ref: 'chaise-napoleon-transparente',
      piece: 'chaise-napoleon-transparente', qty: 80,
      price: 0.01, unit: 'week-end', caution: 0 }   // tentative de tarif maison
  ]);
  const l = demande.items[0];
  assert.strictEqual(l.price, 4, 'le serveur doit imposer SON prix');
  assert.strictEqual(l.unit, 'jour');
  assert.strictEqual(l.caution, 15);
});

test('un nom trafiqué est remplacé par celui du catalogue', async () => {
  neuf();
  const { demande } = await envoyer([
    { name: 'Chaise offerte gracieusement', ref: 'chaise-napoleon-transparente',
      piece: 'chaise-napoleon-transparente', qty: 1 }
  ]);
  assert.strictEqual(demande.items[0].name, 'Chaise Napoléon transparente');
});

test('une référence hostile ne fait rien passer', async () => {
  neuf();
  for (const piece of ['__proto__', 'constructor', 'prototype', '', 'nawak', '../pieces']) {
    const { res, demande } = await envoyer([{ name: 'Pièce X', ref: 'x-' + Math.random(), piece, qty: 1 }]);
    assert.strictEqual(res.statusCode, 200, piece);
    assert.strictEqual(demande.items[0].price, undefined, 'un prix est sorti de « ' + piece + ' »');
  }
});

/* ---------- la facture part de ces valeurs ---------- */

// buildInitialLines vit dans admin.js, qui s'exécute dans un navigateur. On en
// rejoue ici la règle exacte : c'est elle qui décide de ce que la gérante voit.
function buildInitialLines(req) {
  if (req.reply && req.reply.lines && req.reply.lines.length) {
    return req.reply.lines.map((l) => ({ label: l.label, qty: l.qty, unit: l.unit }));
  }
  if (req.items && req.items.length) {
    return req.items.map((it) => ({
      label: it.name, qty: it.qty || 1,
      unit: typeof it.price === 'number' ? it.price : ''
    }));
  }
  return [{ label: '', qty: 1, unit: '' }];
}

test('la facture s’ouvre avec les prix déjà remplis', async () => {
  neuf();
  const { demande } = await envoyer([
    { name: 'Chaise Napoléon transparente', ref: 'chaise-napoleon-transparente', piece: 'chaise-napoleon-transparente', qty: 80 },
    { name: 'Table de banquet en bois brut', ref: 'table-de-banquet-en-bois-brut', piece: 'table-de-banquet-en-bois-brut', qty: 10 }
  ]);
  const lignes = buildInitialLines(demande);
  assert.deepStrictEqual(lignes, [
    { label: 'Chaise Napoléon transparente', qty: 80, unit: 4 },
    { label: 'Table de banquet en bois brut', qty: 10, unit: 18 }
  ]);
  // Et le total correspond à ce que le client a vu sur le site.
  const total = lignes.reduce((n, l) => n + (Number(l.unit) || 0) * l.qty, 0);
  assert.strictEqual(total, 80 * 4 + 10 * 18);
});

test('une pièce non chiffrée laisse la case vide, pas un zéro', async () => {
  neuf();
  const { demande } = await envoyer([
    { name: 'Coin lounge', ref: 'x-coin-lounge', piece: 'coin-lounge', qty: 1 }
  ]);
  // Un zéro se prendrait pour un tarif offert ; une case vide se voit.
  assert.strictEqual(buildInitialLines(demande)[0].unit, '');
});

test('une facture déjà émise garde SES lignes, pas celles du catalogue', async () => {
  const demande = {
    items: [{ name: 'Chaise Napoléon transparente', price: 4, qty: 80 }],
    reply: { lines: [{ label: 'Chaise Napoléon (remise geste commercial)', qty: 80, unit: 3 }] }
  };
  const lignes = buildInitialLines(demande);
  assert.strictEqual(lignes[0].unit, 3, 'le prix négocié doit primer sur le catalogue');
  assert.strictEqual(lignes[0].label, 'Chaise Napoléon (remise geste commercial)');
});

/* ---------- pieces.js sert bien les deux côtés ---------- */

test('pieces.js est lisible depuis le serveur comme depuis le navigateur', () => {
  assert.ok(Array.isArray(pieces.tout()), 'export Node absent');
  assert.strictEqual(typeof pieces.par, 'function');
  assert.ok(pieces.par('chaise-napoleon-transparente'));
  assert.strictEqual(path.basename(require.resolve('../pieces.js')), 'pieces.js');
});
