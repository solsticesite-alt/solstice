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


// ---------------------------------------------------------------------------
// Defauts trouves en soumettant le nettoyeur a ~1100 charges connues et mutees,
// dont la sortie etait rejouee dans un vrai navigateur sans bac a sable.
// ---------------------------------------------------------------------------

// Le plus grave : un caractere invisible dans le NOM de l'attribut. « href »
// suivi d'un octet nul n'etait pas reconnu comme une URL et echappait donc au
// controle de schema — puis le nom etait nettoye a l'ecriture et ressortait en
// « href » parfaitement vivant. Un nom doit etre juge sur ce qu'il DEVIENDRA.
test('un nom d attribut maquille ne contourne pas le controle d URL', () => {
  const nul = String.fromCharCode(0);
  const cas = [
    '<a href' + nul + '="javascript:alert(1)">clic</a>',
    '<img src' + nul + '="javascript:alert(1)">',
    '<div on' + nul + 'click="alert(1)">x</div>',
    '<div onclick' + nul + '="alert(1)">x</div>',
    '<a href' + String.fromCharCode(1) + '="javascript:alert(1)">clic</a>'
  ];
  cas.forEach((h) => {
    const out = nettoye(h);
    assert.ok(!/javascript:/i.test(out), 'aucune URL executable ne subsiste : ' + JSON.stringify(out));
    assert.ok(!/\son[a-z]+\s*=/i.test(out), 'aucun gestionnaire ne subsiste : ' + JSON.stringify(out));
  });
});

// Des guillemets mal apparies faisaient tomber la decoupe au mauvais endroit :
// un morceau d'attribut ressortait dans la page, et le navigateur le relisait
// comme un attribut que le nettoyeur n'avait jamais examine.
test('des guillemets mal apparies ne laissent aucun debris', () => {
  const out = nettoye('<img src=x onerror="f("y")"><a href="x onclick="g()">l</a>');
  // Ce qui compte est qu'aucun ATTRIBUT ne s'appelle on… ; le meme mot dans la
  // valeur d'un lien n'est que du texte, et il est echappe. On met donc les
  // valeurs de cote avant de chercher.
  const sansValeurs = out.replace(/"[^"]*"/g, '""');
  assert.ok(!/\son[a-z-]+\s*=/i.test(sansValeurs), 'plus aucun gestionnaire : ' + out);
  assert.ok(!/f\(|g\(/.test(out), 'plus aucun appel de fonction : ' + out);
  // Et la sortie est bien formee : autant de guillemets ouverts que fermes.
  assert.strictEqual((out.match(/"/g) || []).length % 2, 0, 'guillemets apparies : ' + out);
});

// Le pistage a la lecture ne passe pas que par <img src>.
test('tout ce qui charge une ressource distante est mis de cote', () => {
  const vecteurs = [
    ['image classique', '<img src="https://pisteur.test/p.png">'],
    ['protocole herite', '<img src="//pisteur.test/p.png">'],
    ['bouton image', '<input type="image" src="https://pisteur.test/p.png">'],
    ['affiche de video', '<video poster="https://pisteur.test/p.png"></video>'],
    ['jeu de resolutions', '<img srcset="https://pisteur.test/p.png 1x">'],
    ['fond de tableau', '<table background="https://pisteur.test/p.png"></table>'],
    ['fond en CSS', '<div style="background:url(https://pisteur.test/p.png)">x</div>'],
    ['CSS a entites', '<div style="background&#58;url(https&#58;//pisteur.test/p.png)">x</div>'],
    ['CSS sans guillemets', '<div style=background:url(https://pisteur.test/p.png)>x</div>'],
    ['bloc de style', '<style>b{background:url(https://pisteur.test/p.png)}</style>']
  ];
  vecteurs.forEach(([quoi, html]) => {
    const r = sanitizeEmailHtml(html);
    // L'adresse peut subsister dans `data-osrc` — mise de cote, jamais chargee.
    // Ce qui ne doit plus exister, c'est un attribut qui la charge tout seul,
    // ou un url() dans une feuille de style.
    assert.ok(
      !/\s(src|srcset|poster|background)="[^"]*pisteur\.test/i.test(r.html),
      quoi + ' : plus aucun attribut ne la charge → ' + r.html
    );
    assert.ok(!/url\([^)]*pisteur\.test/i.test(r.html), quoi + ' : plus aucun url() → ' + r.html);
    assert.ok(r.blocked >= 1, quoi + ' : le compteur doit le signaler');
  });
});

// Seule l'image classique est conservee de cote : c'est la seule que le
// back-office sait reafficher quand on clique sur « afficher les images ».
test('l image mise de cote reste reaffichable, les autres non', () => {
  const r = sanitizeEmailHtml('<img src="https://exemple.fr/photo.jpg" alt="photo">');
  assert.match(r.html, /data-osrc="https:\/\/exemple\.fr\/photo\.jpg"/);
  assert.match(r.html, /alt="photo"/, 'le reste de la balise est conserve');
});

// Un courrier ordinaire ne doit rien perdre au passage.
test('une mise en forme legitime traverse intacte', () => {
  const r = sanitizeEmailHtml(
    '<table bgcolor="#F5EEE1" cellpadding="8"><tr><td align="left" style="color:#333">Chaise</td></tr></table>' +
    '<a href="https://exemple.fr/x">voir</a> <a href="mailto:a@b.fr">écrire</a> <img src="cid:logo@x">'
  );
  assert.match(r.html, /bgcolor="#F5EEE1"/);
  assert.match(r.html, /cellpadding="8"/);
  assert.match(r.html, /style="color:#333"/);
  assert.match(r.html, /href="https:\/\/exemple\.fr\/x"/);
  assert.match(r.html, /rel="noopener noreferrer nofollow"/);
  assert.match(r.html, /href="mailto:a@b\.fr"/);
  assert.match(r.html, /src="cid:logo@x"/, 'les images incorporees restent');
  assert.strictEqual(r.blocked, 0);
});
