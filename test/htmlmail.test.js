// Nettoyage du HTML des e-mails recus.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeEmailHtml, textToHtml, isDangerousUrl } = require('../api/_lib/htmlmail');

function nettoye(html) { return sanitizeEmailHtml(html).html; }

test('retire les elements executables avec leur contenu', () => {
  ['<script>alert(1)</script>', '<iframe src="//evil"></iframe>',
   '<object data="x"></object>', '<form action="//evil"><input></form>',
   '<svg onload="alert(1)"><circle/></svg>'].forEach((entree) => {
    const out = nettoye('<p>ok</p>' + entree);
    assert.ok(out.indexOf('ok') >= 0, 'le contenu legitime est conserve');
    assert.ok(!/<(script|iframe|object|form|svg)\b/i.test(out), 'reste : ' + out);
  });
});

test('retire les gestionnaires d evenements, guillemets ou non', () => {
  [' onclick="alert(1)"', " onclick='alert(1)'", ' onclick=alert(1)',
   ' ONMOUSEOVER=alert(1)'].forEach((attr) => {
    const out = nettoye('<div' + attr + '>x</div>');
    assert.ok(!/\son[a-z]+\s*=/i.test(out), 'reste : ' + out);
  });
});

test('neutralise les URL executables', () => {
  assert.ok(!/javascript/i.test(nettoye('<a href="javascript:alert(1)">x</a>')));
  assert.ok(!/javascript/i.test(nettoye('<a href="jaVaScRiPt&#58;alert(1)">x</a>')));
  assert.ok(!/vbscript/i.test(nettoye('<a href="vbscript:x">x</a>')));
  assert.ok(isDangerousUrl('java\tscript:alert(1)'));
  assert.ok(!isDangerousUrl('https://exemple.fr/page'));
});

// Le defaut trouve en revue : la regex exigeait des guillemets apparies,
// alors que le navigateur, lui, accepte un guillemet isole.
test('une balise a guillemet depareille est nettoyee elle aussi', () => {
  const out = nettoye('<a href="https://evil.test/" x=y" onclick="alert(1)">clic</a>');
  assert.ok(!/onclick/i.test(out), 'le gestionnaire subsiste : ' + out);
  const img = sanitizeEmailHtml('<img src="https://t.test/p.gif" x=y">');
  assert.strictEqual(img.blocked, 1, 'le traceur doit etre compte : ' + img.html);
  assert.ok(/data-osrc/.test(img.html));
});

test('met les images distantes de cote et les compte', () => {
  const r = sanitizeEmailHtml('<img src="https://a.test/1.gif"><img src="http://b.test/2.gif">');
  assert.strictEqual(r.blocked, 2);
  assert.ok(!/\ssrc=/.test(r.html));
  // Les images deja incorporees restent affichees.
  const d = sanitizeEmailHtml('<img src="data:image/png;base64,AAAA">');
  assert.strictEqual(d.blocked, 0);
  assert.ok(/src="data:/.test(d.html));
});

test('durcit les liens sortants', () => {
  const out = nettoye('<a href="https://exemple.fr" target="_self">x</a>');
  assert.ok(/target="_blank"/.test(out));
  assert.ok(/rel="noopener noreferrer nofollow"/.test(out));
  assert.strictEqual((out.match(/target=/g) || []).length, 1, 'un seul target : ' + out);
});

test('conserve la mise en page mais desamorce le CSS', () => {
  const out = nettoye('<style>@import url(//evil);body{color:red}</style><p style="color:blue">x</p>');
  assert.ok(!/@import/.test(out));
  assert.ok(/color:red/.test(out), 'le style legitime survit : ' + out);
  assert.ok(/color:blue/.test(out));
});

test('une balise jamais refermee ne passe pas telle quelle', () => {
  const out = nettoye('<p>debut</p><div onclick="alert(1)"');
  assert.ok(out.indexOf('debut') >= 0);
  assert.ok(!/onclick/i.test(out), 'reste : ' + out);
});

test('un « < » litteral est echappe', () => {
  assert.ok(/&lt;\s*3/.test(nettoye('<p>a < 3</p>')));
});

test('le texte brut devient du HTML lisible', () => {
  const out = textToHtml('Bonjour\n> citation\nhttps://exemple.fr fin');
  assert.ok(/<blockquote class="q">/.test(out));
  assert.ok(/<a href="https:\/\/exemple\.fr"/.test(out));
  assert.ok(!/<script/i.test(textToHtml('<script>alert(1)</script>')));
});
