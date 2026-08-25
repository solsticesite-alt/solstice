(function () {
  var form = document.querySelector('.filterbar');
  if (!form) return;

  var btn    = document.getElementById('fbToggle');
  var adv    = document.getElementById('fbAdvanced');
  var foot   = document.getElementById('fbFoot');
  var compte = document.getElementById('fbCount');
  var vide   = document.getElementById('fbEmpty');

  // Seule la grille du catalogue est filtrée. « Vous aimerez aussi… » est un
  // choix de la maison, pas un résultat de recherche : il reste intact.
  var principale = document.querySelector('.cat-grid');
  if (!principale) return;
  var toutes = [].slice.call(principale.querySelectorAll('.card'));

  // Un critère = un select. La marque (coup de cœur / nouveauté) n'existe
  // que sous forme de pastille.
  var CRITERES = [
    { cle: 'cat',     id: 'f-categorie' },
    { cle: 'style',   id: 'f-style' },
    { cle: 'couleur', id: 'f-couleur' },
    { cle: 'collection', id: 'f-collection' },
    { cle: 'saison',  id: 'f-saison' },
    { cle: 'prix',    id: 'f-prix' }
  ];
  CRITERES.forEach(function (c) { c.el = document.getElementById(c.id); });

  var marque = '';
  var pastilles = [].slice.call(form.querySelectorAll('.chip[data-chip]'));

  function valeur(cle) {
    for (var i = 0; i < CRITERES.length; i++) {
      if (CRITERES[i].cle === cle) return CRITERES[i].el ? CRITERES[i].el.value : '';
    }
    return '';
  }

  // Les attributs des cartes sont des listes séparées par des espaces :
  // data-saison="ete hiver" doit répondre à « été » comme à « hiver ».
  function contient(carte, attr, val) {
    if (!val) return true;
    return (' ' + (carte.getAttribute('data-' + attr) || '') + ' ').indexOf(' ' + val + ' ') >= 0;
  }

  function dansLaTranche(carte, tranche) {
    if (!tranche) return true;
    var p = parseFloat(carte.getAttribute('data-prix'));
    if (!isFinite(p)) return false;
    if (tranche === '0-10')  return p < 10;
    if (tranche === '10-30') return p >= 10 && p < 30;
    if (tranche === '30-60') return p >= 30 && p <= 60;
    if (tranche === '60-')   return p > 60;
    return true;
  }

  function retenue(carte) {
    return contient(carte, 'cat', valeur('cat'))
        && contient(carte, 'style', valeur('style'))
        && contient(carte, 'couleur', valeur('couleur'))
        && contient(carte, 'collection', valeur('collection'))
        && contient(carte, 'saison', valeur('saison'))
        && contient(carte, 'marque', marque)
        && dansLaTranche(carte, valeur('prix'));
  }

  function actif() {
    if (marque) return true;
    for (var i = 0; i < CRITERES.length; i++) if (CRITERES[i].el && CRITERES[i].el.value) return true;
    return false;
  }

  // Une carte masquée n'est jamais entrée dans le champ de l'observateur
  // d'apparition : sans ce coup de pouce elle reviendrait transparente.
  function montrer(carte, oui) {
    carte.hidden = !oui;
    if (oui) carte.classList.add('in');
  }

  function appliquer() {
    var trouves = 0;
    toutes.forEach(function (c) { var ok = retenue(c); montrer(c, ok); if (ok) trouves++; });

    var filtre = actif();

    if (vide) vide.hidden = !(filtre && trouves === 0);
    if (foot) foot.hidden = !filtre;
    if (compte) {
      compte.innerHTML = trouves === 0
        ? 'Aucune pièce sur ' + toutes.length
        : '<em>' + trouves + '</em> pièce' + (trouves > 1 ? 's' : '') + ' sur ' + toutes.length;
    }

    synchroniserPastilles();
    ecrireUrl();
  }

  function synchroniserPastilles() {
    var collection = valeur('collection');
    var rien = !actif();
    pastilles.forEach(function (p) {
      var v = p.getAttribute('data-chip');
      var on = v === 'tout' ? rien
             : v === 'collection:' + collection ? true
             : v === 'marque:' + marque ? true
             : false;
      p.classList.toggle('on', on);
      p.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function ecrireUrl() {
    if (!window.history || !history.replaceState) return;
    var bouts = [];
    CRITERES.forEach(function (c) { if (c.el && c.el.value) bouts.push(c.cle + '=' + encodeURIComponent(c.el.value)); });
    if (marque) bouts.push('marque=' + encodeURIComponent(marque));
    history.replaceState(null, '', location.pathname + (bouts.length ? '?' + bouts.join('&') : '') + location.hash);
  }

  function reinitialiser() {
    CRITERES.forEach(function (c) { if (c.el) c.el.value = ''; });
    marque = '';
    appliquer();
  }

  CRITERES.forEach(function (c) { if (c.el) c.el.addEventListener('change', appliquer); });

  pastilles.forEach(function (p) {
    p.addEventListener('click', function () {
      var v = p.getAttribute('data-chip') || '';
      if (v === 'tout') { reinitialiser(); return; }
      var sep = v.indexOf(':');
      var quoi = v.slice(0, sep), val = v.slice(sep + 1);
      if (quoi === 'marque') {
        marque = (marque === val) ? '' : val;
      } else if (quoi === 'collection') {
        var sel = document.getElementById('f-collection');
        if (sel) sel.value = (sel.value === val) ? '' : val;
      }
      appliquer();
    });
  });

  var razBtn = document.getElementById('fbReset');
  if (razBtn) razBtn.addEventListener('click', reinitialiser);
  var razVide = document.getElementById('fbEmptyReset');
  if (razVide) razVide.addEventListener('click', reinitialiser);

  form.addEventListener('submit', function (e) { e.preventDefault(); });

  if (btn && adv) {
    btn.addEventListener('click', function () {
      var ouvert = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
      adv.hidden = ouvert;
    });
  }

  // Entrées directes : /catalogue?cat=mobilier depuis le pied de page,
  // ou une adresse partagée qui rejoue exactement la même sélection.
  (function depuisUrl() {
    var q = location.search.replace(/^\?/, '');
    if (!q) { appliquer(); return; }
    var lu = {};
    q.split('&').forEach(function (p) {
      var i = p.indexOf('=');
      if (i < 0) return;
      try { lu[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); } catch (e) {}
    });
    var deplie = false;
    CRITERES.forEach(function (c) {
      var v = lu[c.cle];
      if (!c.el || !v) return;
      // On n'accepte que les valeurs réellement proposées par le select.
      var connue = [].some.call(c.el.options, function (o) { return o.value === v; });
      if (connue) { c.el.value = v; deplie = true; }
    });
    if (lu.marque === 'coeur' || lu.marque === 'nouveau') marque = lu.marque;
    if (deplie && btn && adv) { btn.setAttribute('aria-expanded', 'true'); adv.hidden = false; }
    appliquer();
  })();
})();
