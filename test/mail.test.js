// Composition des e-mails sortants.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');
const { simpleParser } = require('mailparser');

process.env.SMTP_HOST = 'exemple.test';
process.env.SMTP_USER = 'contact@maison-solstice.fr';
process.env.SMTP_PASS = 'x';

const envoyes = [];
global.__solMockTransport = { sendMail: async (o) => { envoyes.push(o); return { messageId: '<1>' }; } };
const mail = require('../api/_lib/mail');

const REQUETE = {
  ref: 'F-2026-001',
  client: { name: 'Camille Durand', email: 'camille@exemple.fr', phone: '06 00 00 00 00' },
  event: { type: 'Mariage', date: '2026-06-12', location: 'Amiens', guests: 60 },
  items: [{ name: 'Chaise Napoléon', qty: 60 }],
  message: 'Bonjour, voici mon projet.'
};
const REGLAGES = { companyName: 'Maison Solstice', email: 'contact@maison-solstice.fr' };
const FACTURE = {
  invoiceNumber: 'F-2026-001',
  message: 'Bonjour Camille,\n\nRavis de vous accompagner.',
  lines: [{ label: 'Chaise Napoléon', qty: 60, unit: 4 }, { label: 'Table banquet', qty: 8, unit: 18 }],
  depositPct: 50
};

async function dernier() { return simpleParser(envoyes[envoyes.length - 1].raw); }

test('la facture part en pièce jointe, pas recopiée dans le corps', async () => {
  await mail.sendFactureEmail(REQUETE, REGLAGES, FACTURE, Buffer.from('%PDF-1.4'));
  const p = await dernier();
  assert.match(p.subject, /F-2026-001/);
  assert.strictEqual(p.attachments.length, 1);
  assert.match(p.attachments[0].filename, /\.pdf$/);
  assert.strictEqual(p.attachments[0].contentType, 'application/pdf');
  // Le detail de la facture ne doit apparaitre QUE dans le PDF.
  assert.ok(!/<table/i.test(p.html), 'aucun tableau de lignes dans le corps');
  assert.ok(!/Napol/.test(p.html), 'aucune designation d article dans le corps');
  assert.ok(!/Napol/.test(p.text));
});

test('le corps explique ce qu il faut faire', async () => {
  await mail.sendFactureEmail(REQUETE, REGLAGES, FACTURE, Buffer.from('%PDF'));
  const p = await dernier();
  assert.match(p.text, /pièce jointe/i);
  assert.match(p.text, /384,00\s*€/, 'le total est annoncé');
  assert.match(p.text, /acompte de 192,00\s*€/, 'l acompte est annoncé');
  assert.match(p.text, /solde, 192,00\s*€/i, 'le solde est annoncé');
  assert.match(p.text, /Ravis de vous accompagner/, 'le message personnalisé est repris');
});

test('paiement intégral : pas de mention d acompte', async () => {
  await mail.sendFactureEmail(REQUETE, REGLAGES, Object.assign({}, FACTURE, { depositPct: 100 }), Buffer.from('%PDF'));
  const p = await dernier();
  assert.ok(!/acompte/i.test(p.text), 'reste : ' + p.text);
  assert.match(p.text, /en totalité/i);
});

// Un message sans version texte est mal noté par les filtres et illisible
// dans un client sans HTML.
test('tout e-mail sortant porte une version texte et une version HTML', async () => {
  await mail.sendFactureEmail(REQUETE, REGLAGES, FACTURE, Buffer.from('%PDF'));
  let p = await dernier();
  assert.ok(p.text && p.text.trim().length > 40, 'facture : version texte');
  assert.ok(p.html && p.html.length > 40, 'facture : version HTML');

  await mail.sendOwnerNotification(REQUETE, 'https://maison-solstice.fr');
  const notif = envoyes[envoyes.length - 1];
  assert.ok(notif.text && /Camille Durand/.test(notif.text), 'notification : version texte');
  assert.ok(notif.html, 'notification : version HTML');
  assert.match(notif.text, /Chaise Napoléon/, 'la sélection figure dans le texte');

  await mail.sendReply({ settings: REGLAGES, to: ['x@y.fr'], subject: 'Objet', text: 'Bonjour', html: '<p>Bonjour</p>' });
  p = await dernier();
  assert.ok(p.text && p.html, 'réponse : les deux versions');
});

test('l expéditeur et l adresse de réponse sont ceux du domaine', async () => {
  await mail.sendFactureEmail(REQUETE, REGLAGES, FACTURE, Buffer.from('%PDF'));
  const p = await dernier();
  assert.match(p.from.text, /contact@maison-solstice\.fr/);
  assert.match(p.from.text, /Maison Solstice/);
  assert.strictEqual(p.to.value[0].address, 'camille@exemple.fr');
});
