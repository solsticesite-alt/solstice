// Fonctions pures du client IMAP : decodage, apercu, images incorporees.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');
const imap = require('../api/_lib/imap');

// Le defaut trouve en revue : imapflow renvoie la CHAINE BRUTE de l'en-tete
// quand la date est illisible. new Date(...).toISOString() levait alors une
// RangeError, et c'etait tout le dossier qui devenait impossible a lister.
test('une date illisible ne fait pas tomber la liste', () => {
  assert.strictEqual(imap.isoDate('Thu, 32 Foo 2026 99:99:99'), null);
  assert.strictEqual(imap.isoDate(''), null);
  assert.strictEqual(imap.isoDate(null), null);
  assert.strictEqual(imap.isoDate(new Date('nawak')), null);
  assert.strictEqual(imap.isoDate('2026-06-12T10:00:00Z'), '2026-06-12T10:00:00.000Z');
  assert.strictEqual(imap.isoDate(new Date(0)), '1970-01-01T00:00:00.000Z');
});

// Autre defaut de la revue : « cid:% » levait une URIError et rendait le
// message definitivement impossible a ouvrir depuis le back-office.
test('un cid malforme n empeche pas la lecture du message', () => {
  const pieces = [{ cid: 'logo@x', contentType: 'image/png', content: Buffer.from('img') }];
  const r = imap.inlineCidImages('<img src="cid:logo@x"><img src="cid:%e0%a4%a">', pieces);
  assert.ok(/src="data:image\/png;base64,/.test(r.html), 'le cid valide est incorpore');
  assert.ok(/cid:%e0%a4%a/.test(r.html), 'le cid casse reste tel quel, sans plantage');
  assert.ok(r.used.has('logo@x'));
});

test('une image incorporee est signalee comme telle, les autres non', () => {
  const pieces = [
    { cid: 'a@x', contentType: 'image/png', content: Buffer.from('a') },
    { cid: 'b@x', contentType: 'image/png', content: Buffer.from('b') }
  ];
  const r = imap.inlineCidImages('<img src="cid:a@x">', pieces);
  assert.ok(r.used.has('a@x'));
  // b n'est pas reference dans le corps : elle doit rester telechargeable.
  assert.ok(!r.used.has('b@x'));
});

test('sans corps ni piece jointe, rien ne casse', () => {
  assert.deepStrictEqual(imap.inlineCidImages('', []).html, '');
  assert.strictEqual(imap.inlineCidImages('<p>x</p>', []).html, '<p>x</p>');
});

test('le decodage suit l encodage annonce', () => {
  assert.strictEqual(imap.toText(Buffer.from('Qm9uam91cg=='), 'base64', 'utf-8'), 'Bonjour');
  assert.strictEqual(imap.toText(Buffer.from('Caf=C3=A9'), 'quoted-printable', 'utf-8'), 'Café');
  assert.strictEqual(imap.toText(Buffer.from([0x43, 0x61, 0x66, 0xE9]), '7bit', 'iso-8859-1'), 'Café');
  assert.strictEqual(imap.toText(null, 'base64', 'utf-8'), '');
});

test('l apercu tient sur une ligne et laisse les citations de cote', () => {
  assert.strictEqual(imap.preview('Bonjour\n> citation\nsuite'), 'Bonjour suite');
  assert.strictEqual(imap.preview('<p>Salut&nbsp;!</p>'), 'Salut !');
  assert.ok(imap.preview('a'.repeat(400)).length <= 160);
  assert.strictEqual(imap.preview(null), '');
});

test('la partie textuelle est choisie avant tout en text/plain', () => {
  const structure = {
    type: 'multipart/alternative',
    childNodes: [
      { type: 'text/html', part: '1' },
      { type: 'text/plain', part: '2', encoding: 'base64' }
    ]
  };
  assert.strictEqual(imap.textNodeOf(structure).part, '2');
  // A defaut de text/plain, on se rabat sur le HTML.
  assert.strictEqual(imap.textNodeOf({ type: 'multipart/mixed', childNodes: [{ type: 'text/html', part: '1' }] }).part, '1');
  assert.strictEqual(imap.textNodeOf(null), null);
});

// Le tampon et l'encodage doivent decrire la MEME partie MIME, sinon du
// base64 est lu comme du texte et l'apercu devient illisible.
test('l apercu ne melange pas les parties MIME', () => {
  const msg = {
    uid: 7, seq: 1,
    envelope: { from: [{ name: 'A', address: 'A@Exemple.FR' }], to: [], subject: 'Objet', date: new Date('2026-01-02T03:04:05Z') },
    flags: new Set(['\\Seen']),
    bodyStructure: { type: 'multipart/alternative', childNodes: [
      { type: 'text/html', part: '1' },
      { type: 'text/plain', part: '2', encoding: 'base64', parameters: { charset: 'utf-8' } }
    ] },
    bodyParts: new Map([['1', Buffer.from('<p>html</p>')], ['2', Buffer.from('Qm9uam91cg==')]])
  };
  const r = imap.summarize(msg);
  assert.strictEqual(r.preview, 'Bonjour', 'la partie 2 doit etre decodee en base64');
  assert.strictEqual(r.from.address, 'a@exemple.fr', 'adresse normalisee en minuscules');
  assert.strictEqual(r.seen, true);
  assert.strictEqual(r.date, '2026-01-02T03:04:05.000Z');
});

test('un message sans expediteur ni objet reste listable', () => {
  const r = imap.summarize({ uid: 1, seq: 1, envelope: {}, flags: new Set(), bodyStructure: null, bodyParts: new Map() });
  assert.strictEqual(r.from, null);
  assert.strictEqual(r.subject, '');
  assert.strictEqual(r.date, null);
  assert.strictEqual(r.preview, '');
});
