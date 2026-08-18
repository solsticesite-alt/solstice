/* Maison Solstice — collections : pop-up « nombre d'invités », quantités
   ajustées automatiquement et ajout à la sélection (panier).
   Partagé par collections.html, collection-*.html et collections.html.
   Le pop-up est injecté automatiquement dès qu'un bouton .offer-btn existe. */
(function () {
  'use strict';

  var MAX_GUESTS = 60;
  var GUEST_STEPS = [2, 4, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  var DEFAULT_GUESTS = 20;

  /* `per` définit l'ajustement selon le nombre d'invités :
     g = par invité · t = par tablée de 8 · d = par tranche de 12
     v = par tranche de 20 · f = quantité fixe */
  /* Trois formules dans chaque collection : le moment apéritif, le moment
     repas, ou les deux réunis. La pièce signature n'est ajoutée qu'une fois,
     tout à la fin, pour qu'elle n'apparaisse pas en double dans Réception. */
  function cocktailItems() {
    return [
      { n: 'Mange-debout + housse', per: 'd', q: 1 },
      { n: 'Verres à cocktail', s: 'coupe + tumbler', per: 'g', q: 2 },
      { n: 'Bar & desserte', per: 'v', q: 1 },
      { n: 'Seau à champagne', per: 'd', q: 1 },
      { n: 'Plateaux de service', per: 'd', q: 1 },
      { n: 'Serviettes cocktail', per: 'g', q: 2 },
      { n: 'Guirlande lumineuse', per: 'v', q: 1 }
    ];
  }
  function tableItems() {
    return [
      { n: 'Nappe en lin', per: 't', q: 1 },
      { n: 'Chemin de table', per: 't', q: 1 },
      { n: 'Assiettes', s: 'service 2 pièces', per: 'g', q: 1 },
      { n: 'Verres', s: 'eau + vin', per: 'g', q: 2 },
      { n: 'Couverts', s: 'parure complète', per: 'g', q: 1 },
      { n: 'Serviettes en tissu', per: 'g', q: 1 },
      { n: 'Marque-places', per: 'g', q: 1 },
      { n: 'Centre de table', s: 'vase + fleurs de saison', per: 't', q: 1 },
      { n: 'Photophores & bougies', per: 't', q: 3 }
    ];
  }
  function receptionItems() {
    return [{ n: 'Table (8 couverts)', per: 't', q: 1 }, { n: 'Chaises', per: 'g', q: 1 }]
      .concat(cocktailItems())
      .concat(tableItems())
      .concat([
        { n: 'Arche décor photo', per: 'f', q: 1 },
        { n: 'Coin lounge', s: 'fauteuils & table basse', per: 'f', q: 1 }
      ]);
  }

  var FORMULES = {
    cocktail: {
      titre: 'Cocktail',
      resume: 'Le moment apéritif : on reçoit debout, un verre à la main.',
      items: cocktailItems
    },
    table: {
      titre: 'Table',
      resume: 'Le moment repas : une table dressée du linge aux bougies.',
      items: tableItems
    },
    reception: {
      titre: 'Réception',
      resume: 'Les deux réunis, du premier verre au dessert. Rien à compléter.',
      items: receptionItems
    }
  };

  function itemsFor(kind, signature) {
    var f = FORMULES[kind] || FORMULES.cocktail;
    return f.items().concat([{ n: signature, s: 'touche signature', per: 't', q: 1 }]);
  }

  /* Les collections sont désormais organisées par COULEUR, et rattachées à
     l'un des deux solstices selon la teinte. Couleurs d'attente : elles seront
     remplacées par les vraies nuances de la maison. */
  var COLS = {
    terracotta: {
      name: 'Terracotta', uni: "Solstice d'Été", univers: 'ete', sig: "Poteries & branches d'olivier",
      desc: 'Terre cuite, ocre et lumière rasante. La chaleur du Sud sur une grande tablée.',
      page: '/collection-terracotta'
    },
    olivier: {
      name: 'Vert olivier', uni: "Solstice d'Été", univers: 'ete', sig: "Feuillage d'eucalyptus",
      desc: 'Vert olivier, feuillages et lin naturel. Recevoir au jardin, simplement.',
      page: '/collection-olivier'
    },
    ecru: {
      name: 'Écru', uni: "Solstice d'Été", univers: 'ete', sig: 'Lin lavé & herbes de pampa',
      desc: "Écru, lin lavé et blanc cassé. La douceur d'une table lumineuse, presque nue.",
      page: '/collection-ecru'
    },
    bordeaux: {
      name: 'Bordeaux', uni: "Solstice d'Hiver", univers: 'hiver', sig: 'Velours & fruits rouges',
      desc: "Bordeaux profond, velours et cuivre. Les grands soirs d'automne et d'hiver.",
      page: '/collection-bordeaux'
    },
    nuit: {
      name: 'Bleu nuit', uni: "Solstice d'Hiver", univers: 'hiver', sig: 'Photophores givrés',
      desc: 'Bleu nuit, argent et bougies. Une réception feutrée sous les lumières basses.',
      page: '/collection-bleu-nuit'
    },
    dore: {
      name: 'Doré', uni: "Solstice d'Hiver", univers: 'hiver', sig: 'Chandeliers dorés',
      desc: "Or et noir, éclat des fêtes. L'élégance des réveillons et des grandes occasions.",
      page: '/collection-dore'
    }
  };

  /* Options complémentaires — exemples, à remplacer par les vraies pièces.
     `g` = visuel (symbole du sprite), `t` = teinte de la vignette. */
  var SUGGESTIONS = [
    { n: 'Mange-debout + housse', d: "Pour l'apéritif d'accueil", g: 'g3-table', t: 'ct-olivier' },
    { n: 'Arche fleurie', d: 'Le coin photo des invités', g: 'g3-arch', t: 'ct-terracotta' },
    { n: 'Coin lounge', d: 'Fauteuils, tapis et table basse', g: 'g3-chair', t: 'ct-ecru' },
    { n: 'Brasero', d: 'Pour prolonger la soirée dehors', g: 'g3-lantern', t: 'ct-nuit' },
    { n: 'Bar à champagne', d: 'Verrerie, seau et desserte', g: 'g3-glass', t: 'ct-bordeaux' },
    { n: 'Guirlandes lumineuses', d: 'Pour habiller le ciel', g: 'g3-lights', t: 'ct-dore' }
  ];

  function qtyFor(item, g) {
    switch (item.per) {
      case 'g': return item.q * g;
      case 't': return item.q * Math.ceil(g / 8);
      case 'd': return item.q * Math.ceil(g / 12);
      case 'v': return item.q * Math.ceil(g / 20);
      default: return item.q;
    }
  }
  function slug(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'piece';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var MODAL_HTML =
    '<div class="om-root" id="omRoot" aria-hidden="true">' +
    '<div class="om-scrim" data-om-close></div>' +
    '<div class="om-panel" role="dialog" aria-modal="true" aria-labelledby="omTitle">' +
    '<div class="om-head"><div><span class="om-k" id="omKicker"></span><h3 id="omTitle"></h3></div>' +
    '<button type="button" class="om-x" data-om-close aria-label="Fermer">&times;</button></div>' +
    '<div class="om-scroll">' +
    '<p class="om-desc" id="omDesc"></p>' +
    '<div class="om-field"><label for="omGuests">Nombre d\'invités</label><select id="omGuests"></select>' +
    '<span class="om-hint">Jusqu\'à 60 invités. Au-delà, écrivez-nous : on compose sur mesure.</span></div>' +
    '<div class="om-listwrap"><div class="om-listhead"><span>Votre sélection</span><span id="omTotal"></span></div>' +
    '<div class="om-list" id="omList"></div></div>' +
    '</div>' +
    '<div class="om-foot"><button type="button" class="btn btn-ink om-add" id="omAdd">Ajouter au panier</button></div>' +
    '</div></div>';

  /* Second pop-up : les options complémentaires, après l'ajout au panier. */
  var OPTIONS_HTML =
    '<div class="om-root" id="osRoot" aria-hidden="true">' +
    '<div class="om-scrim" data-os-close></div>' +
    '<div class="om-panel om-panel-wide" role="dialog" aria-modal="true" aria-labelledby="osTitle">' +
    '<div class="om-head"><div><span class="om-k om-ok" id="osKicker"></span><h3 id="osTitle">Complétez votre table</h3></div>' +
    '<button type="button" class="om-x" data-os-close aria-label="Fermer">&times;</button></div>' +
    '<div class="om-scroll">' +
    '<p class="om-desc">Ceux qui ont choisi cette table ont aussi ajouté&nbsp;:</p>' +
    '<div class="opt-grid" id="osGrid"></div>' +
    '</div>' +
    '<div class="om-foot om-foot-2">' +
    '<button type="button" class="btn btn-ghost" data-os-close>Continuer sans option</button>' +
    '<button type="button" class="btn btn-ink" id="osDone">Voir ma sélection</button>' +
    '</div></div></div>';

  function init() {
    if (!document.querySelector('.offer-btn, [data-offer-host]')) return;

    var host = document.createElement('div');
    host.innerHTML = MODAL_HTML + OPTIONS_HTML;
    var root = host.firstChild;
    var optRoot = host.lastChild;
    document.body.appendChild(root);
    document.body.appendChild(optRoot);

    var elKicker = root.querySelector('#omKicker'),
        elTitle = root.querySelector('#omTitle'),
        elDesc = root.querySelector('#omDesc'),
        elGuests = root.querySelector('#omGuests'),
        elList = root.querySelector('#omList'),
        elTotal = root.querySelector('#omTotal'),
        elAdd = root.querySelector('#omAdd');
    var osKicker = optRoot.querySelector('#osKicker'),
        osGrid = optRoot.querySelector('#osGrid'),
        osDone = optRoot.querySelector('#osDone');

    var state = { col: null, kind: 'cocktail', guests: DEFAULT_GUESTS, added: [] };
    var lastFocus = null;

    GUEST_STEPS.forEach(function (n) {
      var o = document.createElement('option');
      o.value = String(n);
      o.textContent = n + ' invités';
      if (n === DEFAULT_GUESTS) o.selected = true;
      elGuests.appendChild(o);
    });

    function currentItems() {
      var c = COLS[state.col];
      if (!c) return [];
      return itemsFor(state.kind, c.sig);
    }
    function renderList() {
      var total = 0, html = '';
      currentItems().forEach(function (it) {
        var q = qtyFor(it, state.guests);
        total += q;
        html += '<div class="om-row"><span class="rn">' + esc(it.n) +
          (it.s ? '<small>' + esc(it.s) + '</small>' : '') +
          '</span><span class="rq">' + q + '</span></div>';
      });
      elList.innerHTML = html;
      elTotal.textContent = total + ' pièces';
    }

    /* ---------- pop-up 1 : invités + récapitulatif ---------- */
    function open(colKey, kind) {
      var c = COLS[colKey];
      if (!c) return;
      var f = FORMULES[kind] || FORMULES.cocktail;
      state.col = colKey; state.kind = FORMULES[kind] ? kind : 'cocktail';
      state.guests = parseInt(elGuests.value, 10) || DEFAULT_GUESTS;
      elKicker.textContent = c.uni + ' · ' + c.name;
      elTitle.textContent = f.titre;
      elDesc.textContent = c.desc + ' ' + f.resume;
      renderList();
      lastFocus = document.activeElement;
      show(root);
    }
    function show(el) {
      el.classList.add('open');
      el.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function hide(el, restoreFocus) {
      el.classList.remove('open');
      el.setAttribute('aria-hidden', 'true');
      if (!root.classList.contains('open') && !optRoot.classList.contains('open')) {
        document.body.style.overflow = '';
      }
      if (restoreFocus && lastFocus && lastFocus.focus) lastFocus.focus();
    }

    /* ---------- pop-up 2 : options complémentaires ---------- */
    function renderOptions() {
      osGrid.innerHTML = SUGGESTIONS.map(function (s, i) {
        var on = state.added.indexOf(i) !== -1;
        return '<div class="opt' + (on ? ' is-on' : '') + '">' +
          '<div class="opt-img ' + s.t + '"><svg viewBox="0 0 120 120" aria-hidden="true"><use href="#' + s.g + '"/></svg></div>' +
          '<div class="opt-body"><span class="opt-n">' + esc(s.n) + '</span>' +
          '<span class="opt-d">' + esc(s.d) + '</span>' +
          '<button type="button" class="opt-add' + (on ? ' on' : '') + '" data-sug="' + i + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          (on ? 'Ajouté ✓' : '+ Ajouter') + '</button></div></div>';
      }).join('');
    }
    function openOptions() {
      var c = COLS[state.col];
      state.added = [];
      osKicker.textContent = 'Ajouté à votre sélection ✓ · ' + c.name;
      renderOptions();
      show(optRoot);
    }

    /* ---------- branchements ---------- */
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.offer-btn');
      if (b) { e.preventDefault(); open(b.getAttribute('data-col'), b.getAttribute('data-kind')); }
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-om-close]')) hide(root, true);
    });
    optRoot.addEventListener('click', function (e) {
      if (e.target.closest('[data-os-close]')) { hide(optRoot, true); return; }
      var s = e.target.closest('[data-sug]');
      if (s && window.SolCart) {
        var i = parseInt(s.getAttribute('data-sug'), 10);
        if (state.added.indexOf(i) !== -1) return;
        var sug = SUGGESTIONS[i];
        window.SolCart.add({ name: sug.n, ref: slug('option-' + sug.n), qty: 1, priceHint: 'Option · ' + COLS[state.col].name });
        state.added.push(i);
        renderOptions();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (optRoot.classList.contains('open')) hide(optRoot, true);
      else if (root.classList.contains('open')) hide(root, true);
    });
    elGuests.addEventListener('change', function () {
      var g = parseInt(elGuests.value, 10) || DEFAULT_GUESTS;
      state.guests = Math.min(MAX_GUESTS, Math.max(1, g));
      renderList();
    });

    elAdd.addEventListener('click', function () {
      if (!window.SolCart) return;
      var c = COLS[state.col];
      var label = (FORMULES[state.kind] || FORMULES.cocktail).titre + ' · ' + c.name;
      var prefix = state.col + '-' + state.kind + '-';
      currentItems().forEach(function (it) {
        window.SolCart.add({
          name: it.n, ref: slug(prefix + it.n),
          qty: qtyFor(it, state.guests),
          priceHint: label + ' · ' + state.guests + ' invités'
        });
      });
      hide(root, false);
      /* Les options ne sont proposées qu'après coup. Inutile après Réception,
         qui contient déjà tout ce qu'on proposerait d'ajouter. */
      if (state.kind !== 'reception') openOptions();
      else if (lastFocus && lastFocus.focus) lastFocus.focus();
    });

    osDone.addEventListener('click', function () {
      hide(optRoot, false);
      var cartBtn = document.querySelector('.nav-tools [aria-label="Panier"]');
      if (cartBtn) cartBtn.click();
    });
  }

  /* Filtre d'univers sur la page « toutes les collections » (?u=ete|hiver). */
  function applyUniversFilter() {
    var groups = document.querySelectorAll('[data-univers]');
    if (!groups.length) return;
    var u = new URLSearchParams(location.search).get('u');
    if (u !== 'ete' && u !== 'hiver') return;
    groups.forEach(function (g) {
      if (g.getAttribute('data-univers') !== u) g.hidden = true;
    });
    var intro = document.getElementById('collIntro');
    if (intro) {
      intro.textContent = u === 'ete'
        ? "Les couleurs d'été, en cocktail, en table ou en réception complète."
        : "Les couleurs d'hiver, en cocktail, en table ou en réception complète.";
    }
    var h1 = document.getElementById('collTitle');
    if (h1) h1.textContent = u === 'ete' ? "Les collections d'Été" : "Les collections d'Hiver";
    var all = document.getElementById('collAll');
    if (all) all.hidden = false;
  }

  /* ---------- Les trois formules d'une collection ----------
     Un seul panneau ouvert à la fois. À la souris, le survol suffit ; au doigt
     et au clavier, c'est le clic (ou le focus) qui commande.

     Le survol est branché SANS condition, volontairement. Interroger
     `matchMedia('(hover:hover)')` paraissait plus fin, mais il suffit qu'un
     navigateur réponde mal — c'est le cas de certains environnements sans
     souris déclarée — pour que la fonction disparaisse entièrement. Et sur
     un écran tactile, un appui déclenche `mouseenter` juste avant `click` :
     comme les deux font exactement la même chose ici, ça ne gêne pas. */
  function initFormules() {
    var bloc = document.querySelector('.formulas');
    if (!bloc) return;
    var panneaux = [].slice.call(bloc.querySelectorAll('.formula'));
    if (panneaux.length < 2) return;

    function ouvrir(p) {
      if (p.classList.contains('on')) return;
      panneaux.forEach(function (autre) {
        var actif = autre === p;
        autre.classList.toggle('on', actif);
        var tete = autre.querySelector('.f-head');
        if (tete) tete.setAttribute('aria-expanded', actif ? 'true' : 'false');
      });
    }

    panneaux.forEach(function (p) {
      p.addEventListener('mouseenter', function () { ouvrir(p); });
      // Le clic vaut partout : c'est le seul geste disponible au doigt, et il
      // reste utile à la souris pour figer un choix.
      p.addEventListener('click', function (e) {
        if (e.target.closest('.offer-btn, .fav')) return; // ces boutons ont leur propre rôle
        ouvrir(p);
      });
      var tete = p.querySelector('.f-head');
      if (tete) tete.addEventListener('focus', function () { ouvrir(p); });
    });

    // Flèches gauche/droite pour parcourir les formules au clavier.
    bloc.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = panneaux.indexOf(e.target.closest('.formula'));
      if (i < 0) return;
      e.preventDefault();
      var j = (i + (e.key === 'ArrowRight' ? 1 : panneaux.length - 1)) % panneaux.length;
      var tete = panneaux[j].querySelector('.f-head');
      if (tete) tete.focus();
      ouvrir(panneaux[j]);
    });
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(function () { applyUniversFilter(); initFormules(); init(); });
})();
