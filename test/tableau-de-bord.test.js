// Les chiffres du tableau de bord.
//
// Un tableau de bord ment plus facilement qu'une liste : personne ne recompte
// « 4 710 € facturé cette année » à la main. S'il se trompe, il se trompe
// silencieusement, et on prend des décisions dessus.
//
// Ce fichier éprouve donc chaque chiffre affiché en haut du back-office, sur
// des données construites pour ça. Les dates sont TOUJOURS relatives à
// maintenant : un test qui contient « 2026-08-30 » passe aujourd'hui et échoue
// la semaine prochaine sans que rien n'ait cassé.
//
// La navigation de retour (le bouton, Échap, re-cliquer la demande ouverte) se
// vérifie dans un vrai navigateur — outils de recette, harnais `bo5.js` — parce
// qu'elle ne veut rien dire hors du DOM.

const test = require('node:test');
const assert = require('node:assert');

const { statistiques } = require('../api/admin/requests.js');

/* ---------- de quoi fabriquer des demandes ---------- */

const JOUR = 24 * 3600 * 1000;
const iso = (decalageJours) => new Date(Date.now() + decalageJours * JOUR).toISOString();
const jourSeul = (decalageJours) => iso(decalageJours).slice(0, 10);

let seq = 0;
function demande(o) {
  o = o || {};
  return {
    id: ++seq,
    ref: 'F-' + seq,
    createdAt: 'creeLe' in o ? o.creeLe : iso(-1),
    status: o.status || 'read',
    client: { name: o.nom || 'Client ' + seq },
    event: {
      type: 'type' in o ? o.type : 'Mariage',
      date: 'dans' in o ? jourSeul(o.dans) : jourSeul(30),
      guests: 'invites' in o ? o.invites : 50
    },
    items: o.items || [],
    montant: 'montant' in o ? o.montant : 0,
    reply: o.reply || null
  };
}
const facture = (total, decalageJours) =>
  ({ total, sentAt: iso(decalageJours === undefined ? -1 : decalageJours) });

/* ---------- ce que comptent les quatre tuiles ---------- */

test('« nouvelles demandes » ne compte que celles jamais ouvertes', () => {
  const s = statistiques([
    demande({ status: 'new' }), demande({ status: 'new' }),
    demande({ status: 'read' }), demande({ status: 'replied' })
  ]);
  assert.strictEqual(s.nouvelles, 2);
  assert.strictEqual(s.total, 4, 'le total, lui, compte tout');
});

test('« événements à venir » inclut aujourd’hui et exclut le passé', () => {
  const s = statistiques([
    demande({ dans: -40 }), demande({ dans: -1 }),
    demande({ dans: 0 }), demande({ dans: 3 }), demande({ dans: 200 })
  ]);
  // Le jour même compte : l'événement n'a pas encore eu lieu à 9 h du matin.
  assert.strictEqual(s.aVenir, 3);
});

test('« en attente de facture » ne retient que les événements à venir non facturés', () => {
  const s = statistiques([
    demande({ dans: 10, montant: 300 }),                          // compte
    demande({ dans: 20, montant: 200 }),                          // compte
    demande({ dans: 15, montant: 999, reply: facture(999) }),     // déjà facturée
    demande({ dans: -15, montant: 500 })                          // déjà passée
  ]);
  assert.strictEqual(s.enAttente, 2);
  assert.strictEqual(s.montantAttente, 500);
});

test('une facture émise prime sur l’estimation dans les montants en attente', () => {
  // Cas limite : facturée mais l'événement est à venir — elle n'est plus en attente.
  const s = statistiques([demande({ dans: 10, montant: 300, reply: facture(250) })]);
  assert.strictEqual(s.enAttente, 0);
  assert.strictEqual(s.montantAttente, 0);
});

test('« facturé cette année » ne compte que les factures de l’année en cours', () => {
  const anPasse = new Date();
  anPasse.setFullYear(anPasse.getFullYear() - 1);
  const s = statistiques([
    demande({ reply: facture(100, -2) }),
    demande({ reply: facture(200, -3) }),
    demande({ reply: { total: 5000, sentAt: anPasse.toISOString() } })
  ]);
  assert.strictEqual(s.factureAnnee, 300, 'l’an dernier n’a rien à faire dans le compteur de l’année');
  assert.strictEqual(s.nbFactures, 3, 'mais toutes les factures restent comptées');
});

test('les montants sont arrondis au centime, pas laissés en flottants', () => {
  const s = statistiques([
    demande({ dans: 5, montant: 0.1 }), demande({ dans: 6, montant: 0.2 }),
    demande({ reply: facture(0.1, -1) }), demande({ reply: facture(0.2, -1) })
  ]);
  assert.strictEqual(s.montantAttente, 0.3, 'affiché tel quel, 0.30000000000000004 serait risible');
  assert.strictEqual(s.factureAnnee, 0.3);
});

/* ---------- le prochain rendez-vous ---------- */

test('le prochain rendez-vous est le plus proche, pas le premier de la liste', () => {
  const s = statistiques([
    demande({ dans: 90, nom: 'Loin' }),
    demande({ dans: 4, nom: 'Léa Marchand' }),
    demande({ dans: 30, nom: 'Milieu' }),
    demande({ dans: -2, nom: 'Passé' })
  ]);
  assert.strictEqual(s.prochainNom, 'Léa Marchand');
  assert.strictEqual(s.prochainJours, 4);
});

test('sans aucun événement à venir, le prochain rendez-vous est nul, pas zéro', () => {
  const s = statistiques([demande({ dans: -10 })]);
  assert.strictEqual(s.prochainJours, null, '« dans 0 j » annoncerait un rendez-vous qui n’existe pas');
  assert.strictEqual(s.prochainNom, '');
});

/* ---------- le pied de page ---------- */

test('le taux de transformation est la part des demandes facturées', () => {
  const s = statistiques([
    demande({ reply: facture(10) }), demande(), demande(), demande()
  ]);
  assert.strictEqual(s.transformation, 25);
});

test('la moyenne d’invités ignore les demandes qui n’en déclarent pas', () => {
  const s = statistiques([
    demande({ invites: 100 }), demande({ invites: 50 }),
    demande({ invites: null }), demande({ invites: 0 })
  ]);
  assert.strictEqual(s.invitesMoyen, 75, 'compter les absents comme zéro écraserait la moyenne');
});

test('une base vide donne des zéros affichables, pas des NaN', () => {
  const s = statistiques([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.transformation, 0);
  assert.strictEqual(s.invitesMoyen, 0);
  assert.strictEqual(s.montantAttente, 0);
  assert.strictEqual(s.prochainJours, null);
  assert.deepStrictEqual(s.types, []);
  assert.deepStrictEqual(s.pieces, []);
  assert.strictEqual(s.mois.length, 12, 'le graphique doit rester dessinable');
});

/* ---------- les douze mois ---------- */

test('le graphique couvre toujours douze mois, du plus ancien au mois courant', () => {
  const s = statistiques([demande()]);
  assert.strictEqual(s.mois.length, 12);
  const cles = s.mois.map((m) => m.cle);
  assert.deepStrictEqual(cles.slice().sort(), cles, 'les mois doivent être en ordre chronologique');
  const d = new Date();
  const courant = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  assert.strictEqual(cles[11], courant, 'la dernière colonne est le mois en cours');
  assert.strictEqual(new Set(cles).size, 12, 'douze mois distincts');
});

test('un mois sans aucune demande vaut zéro, il n’est pas escamoté', () => {
  // Une seule demande, ce mois-ci : les onze autres colonnes doivent exister à 0.
  const s = statistiques([demande({ creeLe: iso(0) })]);
  const vides = s.mois.filter((m) => m.n === 0);
  assert.strictEqual(vides.length, 11, 'un creux dans l’année est une information');
  assert.strictEqual(s.mois[11].n, 1);
});

test('les demandes de plus d’un an ne rentrent pas dans le graphique', () => {
  const s = statistiques([demande({ creeLe: iso(-400) }), demande({ creeLe: iso(0) })]);
  assert.strictEqual(s.mois.reduce((n, m) => n + m.n, 0), 1);
  assert.strictEqual(s.total, 2, 'mais elles comptent toujours dans le total');
});

/* ---------- les classements ---------- */

test('les types d’événement sont classés du plus fréquent au moins fréquent', () => {
  const s = statistiques([
    demande({ type: 'Mariage' }), demande({ type: 'Mariage' }), demande({ type: 'Mariage' }),
    demande({ type: 'Baptême' }), demande({ type: 'Baptême' }),
    demande({ type: 'Séminaire' })
  ]);
  assert.deepStrictEqual(s.types, [
    { nom: 'Mariage', n: 3 }, { nom: 'Baptême', n: 2 }, { nom: 'Séminaire', n: 1 }
  ]);
});

test('le classement des types s’arrête à six lignes', () => {
  const l = [];
  for (let i = 0; i < 12; i++) for (let k = 0; k <= i; k++) l.push(demande({ type: 'T' + i }));
  const s = statistiques(l);
  assert.strictEqual(s.types.length, 6);
  assert.strictEqual(s.types[0].nom, 'T11', 'le plus fréquent en tête');
});

test('un type vide ou en espaces ne crée pas une ligne anonyme', () => {
  const s = statistiques([
    demande({ type: '' }), demande({ type: '   ' }), demande({ type: null }),
    demande({ type: 'Mariage' })
  ]);
  assert.deepStrictEqual(s.types, [{ nom: 'Mariage', n: 1 }]);
});

// Le classement par quantité écrasait tout : 2 312 chaises contre 2 arches.
test('les pièces sont classées par nombre de demandes, pas par quantité', () => {
  const s = statistiques([
    demande({ items: [{ name: 'Arche', qty: 1 }] }),
    demande({ items: [{ name: 'Arche', qty: 1 }] }),
    demande({ items: [{ name: 'Chaise', qty: 300 }] })
  ]);
  assert.strictEqual(s.pieces[0].nom, 'Arche', '300 chaises en une fois ≠ la pièce la plus demandée');
  assert.deepStrictEqual(s.pieces[0], { nom: 'Arche', demandes: 2, quantite: 2 });
  assert.deepStrictEqual(s.pieces[1], { nom: 'Chaise', demandes: 1, quantite: 300 });
});

test('à égalité de demandes, la quantité départage', () => {
  const s = statistiques([
    demande({ items: [{ name: 'Nappe', qty: 4 }, { name: 'Photophore', qty: 40 }] })
  ]);
  assert.strictEqual(s.pieces[0].nom, 'Photophore');
});

test('une quantité absente ou absurde compte la demande, pas la quantité', () => {
  const s = statistiques([
    demande({ items: [{ name: 'Chaise' }] }),
    demande({ items: [{ name: 'Chaise', qty: 'beaucoup' }] }),
    demande({ items: [{ name: 'Chaise', qty: 6 }] })
  ]);
  assert.deepStrictEqual(s.pieces[0], { nom: 'Chaise', demandes: 3, quantite: 6 });
});

/* ---------- ce qui ne doit pas faire tomber le tableau de bord ---------- */

test('des dates absentes ou illisibles n’empêchent aucun chiffre', () => {
  const abimee = demande();
  abimee.event.date = 'la semaine prochaine';
  abimee.createdAt = null;
  const s = statistiques([abimee, demande({ dans: 5, montant: 10 })]);
  assert.strictEqual(s.total, 2);
  assert.strictEqual(s.aVenir, 1, 'une date illisible n’est pas un événement à venir');
  assert.strictEqual(s.prochainJours, 5);
});

test('une demande sans client, sans événement ni pièces ne jette pas', () => {
  assert.doesNotThrow(() => {
    const s = statistiques([{ id: 1 }, { id: 2, event: null, items: null, client: null }]);
    assert.strictEqual(s.total, 2);
  });
});

// Les noms viennent du formulaire public : ils ne doivent jamais atterrir sur
// le prototype des compteurs.
test('un nom de type ou de pièce nommé « __proto__ » reste une donnée', () => {
  const s = statistiques([
    demande({ type: '__proto__', items: [{ name: '__proto__', qty: 2 }, { name: 'constructor', qty: 1 }] })
  ]);
  assert.deepStrictEqual(s.types, [{ nom: '__proto__', n: 1 }]);
  assert.strictEqual(s.pieces.length, 2);
  assert.ok(s.pieces.some((p) => p.nom === '__proto__' && p.demandes === 1));
  assert.strictEqual({}.demandes, undefined, 'le prototype d’Object doit être intact');
});

test('un montant non numérique n’injecte pas de NaN dans les totaux', () => {
  const s = statistiques([
    demande({ dans: 5, montant: 'cher' }),
    demande({ dans: 6, montant: 100 }),
    demande({ reply: { total: 'gratuit', sentAt: iso(-1) } })
  ]);
  assert.strictEqual(s.montantAttente, 100);
  assert.strictEqual(s.factureAnnee, 0);
  assert.strictEqual(s.nbFactures, 0, 'une facture sans total chiffré n’est pas une facture');
});
