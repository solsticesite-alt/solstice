/* Maison Solstice — les pièces, source unique.
 *
 * Ce fichier est la SEULE description chiffrée des pièces. Le catalogue les
 * affiche, les formules des collections s'en servent pour se chiffrer : sans
 * source commune, les deux dérivent et un même objet finit à deux prix.
 *
 * Champs :
 *   ref     identifiant stable — c'est slugify(nom), le même que celui posé
 *           par cart.js quand on ajoute une pièce depuis le catalogue
 *   prix    nombre, en euros. C'est lui qui permet au panier de calculer :
 *           sans nombre, la ligne repart en « à chiffrer »
 *   unite   'jour' (multiplié par la durée) ou 'week-end' (tarif fixe)
 *   caution nombre, en euros, par pièce
 *
 * ⚠️ Données d'attente. À remplacer par le vrai catalogue : voir A-FAIRE.md §7.
 * test/pieces.test.js vérifie que ce fichier et catalogue.html disent la
 * même chose — si l'un bouge sans l'autre, les tests le disent.
 */
(function () {
  'use strict';

  var PIECES = [
    { ref: "chaise-napoleon-transparente", nom: "Chaise Napoléon transparente", prix: 4, unite: 'jour', caution: 15, cat: "mobilier", style: "classique", couleur: "blanc", collections: "ecru dore nuit bordeaux", saison: "ete hiver", glyphe: "g3-chair" },
    { ref: "table-de-banquet-en-bois-brut", nom: "Table de banquet en bois brut", prix: 18, unite: 'jour', caution: 60, cat: "mobilier", style: "champetre", couleur: "bois", collections: "olivier ecru terracotta", saison: "ete", glyphe: "g3-table" },
    { ref: "arche-ronde-en-bois-clair", nom: "Arche ronde en bois clair", prix: 45, unite: 'week-end', caution: 80, cat: "ceremonie", style: "boheme", couleur: "bois", collections: "olivier ecru terracotta", saison: "ete", glyphe: "g3-arch" },
    { ref: "verrerie-fumee-lot-de-6", nom: "Verrerie fumée · lot de 6", prix: 9, unite: 'jour', caution: 30, cat: "table", style: "vintage", couleur: "fume", collections: "dore nuit bordeaux", saison: "hiver", glyphe: "g3-glass" },
    { ref: "menagere-doree-6-couverts", nom: "Ménagère dorée · 6 couverts", prix: 12, unite: 'jour', caution: 40, cat: "table", style: "baroque", couleur: "dore", collections: "dore nuit bordeaux terracotta olivier", saison: "ete hiver", glyphe: "g3-cutlery" },
    { ref: "photobooth-vintage-toile", nom: "Photobooth vintage & toile", prix: 90, unite: 'week-end', caution: 150, cat: "animations", style: "vintage", couleur: "bois", collections: "olivier ecru", saison: "ete", glyphe: "g3-camera" },
    { ref: "guirlande-guinguette-25-m", nom: "Guirlande guinguette · 25 m", prix: 15, unite: 'week-end', caution: 25, cat: "lumiere", style: "champetre", couleur: "dore", collections: "olivier ecru terracotta", saison: "ete", glyphe: "g3-lantern" },
    { ref: "brasero-convivial-en-acier", nom: "Brasero convivial en acier", prix: 35, unite: 'week-end', caution: 90, cat: "exterieur", style: "minimal", couleur: "fume", collections: "olivier ecru", saison: "hiver", glyphe: "g3-sun" },
    { ref: "chemin-de-table-eucalyptus", nom: "Chemin de table eucalyptus", prix: 6, unite: 'jour', caution: 10, cat: "decoration", style: "champetre", couleur: "vert", collections: "olivier ecru dore", saison: "ete", glyphe: "g3-foliage" },
    { ref: "centre-de-table-fleuri", nom: "Centre de table fleuri", prix: 14, unite: 'jour', caution: 20, cat: "decoration", style: "boheme", couleur: "terracotta", collections: "terracotta olivier", saison: "ete", glyphe: "g3-vase" },
    { ref: "photophores-verre-bougies", nom: "Photophores verre & bougies", prix: 3, unite: 'jour', caution: 8, cat: "lumiere", style: "minimal", couleur: "blanc", collections: "ecru dore nuit bordeaux", saison: "hiver", glyphe: "g3-candles" },
    { ref: "nappe-en-lin-lave-froisse", nom: "Nappe en lin lavé froissé", prix: 8, unite: 'jour', caution: 15, cat: "table", style: "minimal", couleur: "blanc", collections: "ecru dore terracotta olivier", saison: "ete hiver", glyphe: "g3-doc" }
  ];

  /* Un objet SANS prototype. Avec un objet ordinaire, chercher la référence
     « __proto__ » ou « constructor » remonte une propriété héritée : la
     fonction renvoyait alors le constructeur d'Object au lieu de null. Sans
     conséquence sur les prix — l'objet rendu n'a pas de `prix` numérique, donc
     la ligne repartait en « à chiffrer » — mais une fonction de lecture ne
     doit jamais rendre autre chose que ce qu'on y a mis. */
  var index = Object.create(null);
  PIECES.forEach(function (p) { index[p.ref] = p; });

  window.SolPieces = {
    tout: function () { return PIECES.slice(); },
    /* Renvoie la pièce, ou null. Jamais d'exception : une référence inconnue
       doit dégrader en « à chiffrer », pas casser la page. */
    par: function (ref) {
      return (typeof ref === 'string' && index[ref]) || null;
    }
  };
})();
