// Les pièces : une seule source, et des formules qui savent la lire.
//
// Deux dérives sont possibles, et toutes deux se voient sur la facture d'un
// client avant de se voir ailleurs :
//   · pieces.js et catalogue.html annoncent des prix différents pour le même
//     objet — le catalogue dit 4 €, la formule en compte 6 ;
//   · une formule pointe vers une référence qui n'existe pas — la ligne
//     retombe silencieusement en « à chiffrer », et personne ne le remarque.
// Ce fichier rend les deux impossibles à livrer sans le savoir.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');

/* ---------- on exécute les fichiers du site comme le ferait un navigateur ---------- */

function chargerPieces() {
  const fenetre = {};
  vm.runInNewContext(lire('pieces.js'), { window: fenetre });
  return fenetre.SolPieces;
}

// collections.js s'arrête tout seul s'il ne trouve pas de bouton .offer-btn.
// On lui donne un document minimal et on récupère ce qu'il expose pour les tests.
function chargerCollections(pieces) {
  const fenetre = { SolPieces: pieces };
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'complete',
    createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, classList: { add() {} } }),
    body: { appendChild() {} }
  };
  const sandbox = { window: fenetre, document, setTimeout, clearTimeout, console };
  vm.runInNewContext(lire('collections.js'), sandbox);
  return fenetre;
}

const SolPieces = chargerPieces();

/* ---------- pieces.js tient debout tout seul ---------- */

test('chaque pièce est complète et bien formée', () => {
  const tout = SolPieces.tout();
  assert.ok(tout.length >= 12, 'seulement ' + tout.length + ' pièces');
  for (const p of tout) {
    assert.match(p.ref, /^[a-z0-9-]+$/, 'référence douteuse : ' + p.ref);
    assert.ok(p.nom && p.nom.length > 2, 'nom vide pour ' + p.ref);
    assert.strictEqual(typeof p.prix, 'number', 'prix non numérique pour ' + p.ref);
    assert.ok(p.prix > 0, 'prix nul ou négatif pour ' + p.ref);
    assert.ok(p.unite === 'jour' || p.unite === 'week-end', 'unité inconnue pour ' + p.ref + ' : ' + p.unite);
    assert.strictEqual(typeof p.caution, 'number', 'caution non numérique pour ' + p.ref);
    assert.ok(p.caution >= 0, 'caution négative pour ' + p.ref);
  }
});

test('les références sont uniques', () => {
  const refs = SolPieces.tout().map((p) => p.ref);
  assert.strictEqual(new Set(refs).size, refs.length, 'doublon parmi : ' + refs.join(', '));
});

// La référence DOIT être slugify(nom) : c'est celle que cart.js pose quand on
// ajoute la pièce depuis le catalogue. Si les deux divergent, la même pièce
// existe sous deux identités dans le panier.
test('la référence est bien le nom « slugifié », comme le fait cart.js', () => {
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'piece';
  for (const p of SolPieces.tout()) {
    assert.strictEqual(p.ref, slugify(p.nom), 'référence ≠ slug du nom pour « ' + p.nom + ' »');
  }
});

test('une référence inconnue renvoie null sans jeter', () => {
  for (const mauvais of [null, undefined, '', 'nawak', 0, {}, '__proto__', 'constructor']) {
    assert.strictEqual(SolPieces.par(mauvais), null, JSON.stringify(String(mauvais)));
  }
});

test('la liste renvoyée est une copie : la modifier n’altère pas la source', () => {
  const a = SolPieces.tout();
  a.push({ ref: 'intrus' });
  a[0] = null;
  assert.strictEqual(SolPieces.tout().length, a.length - 1);
  assert.ok(SolPieces.tout()[0], 'la première pièce a été effacée depuis l’extérieur');
});

/* ---------- pieces.js et catalogue.html disent la même chose ---------- */

function fichesDuCatalogue() {
  const html = lire('catalogue.html');
  const cards = html.match(/<article class="card[^"]*"[^>]*>[\s\S]*?<\/article>/g) || [];
  const deHtml = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
  const montant = (s) => {
    const m = String(s).replace(/\s/g, '').match(/(\d+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  };
  return cards.map((c) => {
    const nom = deHtml((c.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '');
    const px = c.match(/card-price">([^<]*)<span>([^<]*)<\/span>/);
    const caution = (c.match(/card-caution">([^<]*)</) || [])[1] || '';
    return {
      nom,
      prix: montant(px ? px[1] : ''),
      unite: /week-?end/i.test(px ? px[2] : '') ? 'week-end' : 'jour',
      caution: montant(caution)
    };
  });
}

test('chaque fiche du catalogue existe dans pieces.js, au même prix', () => {
  const fiches = fichesDuCatalogue();
  assert.ok(fiches.length >= 12, 'seulement ' + fiches.length + ' fiches lues dans catalogue.html');
  for (const f of fiches) {
    const p = SolPieces.tout().find((x) => x.nom === f.nom);
    assert.ok(p, 'la fiche « ' + f.nom +' » n’est pas dans pieces.js');
    assert.strictEqual(p.prix, f.prix, 'prix différent pour « ' + f.nom + ' »');
    assert.strictEqual(p.unite, f.unite, 'unité différente pour « ' + f.nom + ' »');
    assert.strictEqual(p.caution, f.caution, 'caution différente pour « ' + f.nom + ' »');
  }
});

test('aucune pièce fantôme : pieces.js ne décrit rien que le catalogue ignore', () => {
  const noms = new Set(fichesDuCatalogue().map((f) => f.nom));
  for (const p of SolPieces.tout()) {
    assert.ok(noms.has(p.nom), '« ' + p.nom + ' » est dans pieces.js mais absente du catalogue');
  }
});

/* ---------- les formules savent lire les pièces ---------- */

const collections = chargerCollections(SolPieces);

test('collections.js s’exécute et expose de quoi être testé', () => {
  assert.ok(collections.SolCollections, 'collections.js doit exposer window.SolCollections pour être vérifiable');
});

test('toute référence citée par une formule existe vraiment', () => {
  const { formules } = collections.SolCollections;
  const manquantes = [];
  for (const kind of Object.keys(formules)) {
    for (const it of formules[kind]()) {
      if (it.p && !SolPieces.par(it.p)) manquantes.push(kind + ' → ' + it.n + ' (' + it.p + ')');
    }
  }
  assert.deepStrictEqual(manquantes, [], 'références introuvables : ' + manquantes.join(' | '));
});

test('les quantités suivent le nombre d’invités, sans jamais tomber à zéro', () => {
  const { formules, qtyFor } = collections.SolCollections;
  for (const kind of Object.keys(formules)) {
    for (const it of formules[kind]()) {
      for (const invites of [1, 2, 8, 20, 60]) {
        const q = qtyFor(it, invites);
        assert.ok(Number.isFinite(q) && q >= 1,
          kind + ' → ' + it.n + ' donne ' + q + ' pour ' + invites + ' invités');
      }
      // Une pièce « par invité » doit croître avec le nombre d'invités.
      if (it.per === 'g') {
        assert.ok(qtyFor(it, 60) > qtyFor(it, 20), it.n + ' ne suit pas le nombre d’invités');
      }
    }
  }
});

test('une formule chiffre ce qui est chiffrable, et le dit pour le reste', () => {
  const { formules, ligneTotal } = collections.SolCollections;
  for (const kind of Object.keys(formules)) {
    const items = formules[kind]();
    const chiffrees = items.filter((it) => ligneTotal(it, 20) !== null);
    assert.ok(chiffrees.length > 0, 'la formule « ' + kind + ' » ne chiffre aucune ligne');
    for (const it of chiffrees) {
      const t = ligneTotal(it, 20);
      assert.ok(Number.isFinite(t) && t > 0, kind + ' → ' + it.n + ' donne un total de ' + t);
    }
    // Sans référence, pas de prix inventé : la ligne doit rester nulle.
    for (const it of items.filter((x) => !x.p)) {
      assert.strictEqual(ligneTotal(it, 20), null, kind + ' → ' + it.n + ' chiffre sans référence');
    }
  }
});

test('le total d’une ligne est bien le prix multiplié par la quantité', () => {
  const { formules, ligneTotal, qtyFor } = collections.SolCollections;
  const items = formules.reception();
  for (const it of items.filter((x) => x.p)) {
    const p = SolPieces.par(it.p);
    for (const invites of [8, 30, 60]) {
      assert.strictEqual(ligneTotal(it, invites), p.prix * qtyFor(it, invites),
        it.n + ' à ' + invites + ' invités');
    }
  }
});

// Le vrai enjeu de tout ce fichier : la formule ne doit plus afficher
// « Sur demande » comme total alors qu'elle contient des pièces chiffrées.
test('chaque formule produit une estimation non nulle', () => {
  const { formules, ligneTotal } = collections.SolCollections;
  for (const kind of Object.keys(formules)) {
    const total = formules[kind]().reduce((n, it) => n + (ligneTotal(it, 30) || 0), 0);
    assert.ok(total > 0, 'la formule « ' + kind + ' » reste entièrement sur demande');
  }
});

// Ce test échouera le jour où le vrai catalogue arrivera — et c'est voulu :
// il faudra alors relier les pièces restantes, et ce chiffre le rappellera.
test('inventaire des pièces que le catalogue ne contient pas encore', () => {
  const { formules } = collections.SolCollections;
  const manquantes = new Set();
  for (const kind of Object.keys(formules)) {
    for (const it of formules[kind]()) if (!it.p) manquantes.add(it.n);
  }
  console.log('        pièces à ajouter au catalogue (' + manquantes.size + ') : ' + [...manquantes].join(', '));
  assert.ok(manquantes.size <= 12, manquantes.size + ' pièces manquantes, c’est plus que prévu');
});
