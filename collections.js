/* Maison Solstice — collections : pop-up « nombre d'invités », quantités
   ajustées automatiquement et ajout à la sélection (panier).
   Partagé par collections.html, collection-*.html et nos-univers.html.
   Le pop-up est injecté automatiquement dès qu'un bouton .offer-btn existe. */
(function () {
  'use strict';

  var MAX_GUESTS = 60;
  var GUEST_STEPS = [2, 4, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  var DEFAULT_GUESTS = 20;

  /* `per` définit l'ajustement selon le nombre d'invités :
     g = par invité · t = par tablée de 8 · d = par tranche de 12
     v = par tranche de 20 · f = quantité fixe */
  function tableItems(signature) {
    return [
      { n: 'Nappe en lin', per: 't', q: 1 },
      { n: 'Chemin de table', per: 't', q: 1 },
      { n: 'Assiettes', s: 'service 2 pièces', per: 'g', q: 1 },
      { n: 'Verres', s: 'eau + vin', per: 'g', q: 2 },
      { n: 'Couverts', s: 'parure complète', per: 'g', q: 1 },
      { n: 'Serviettes en tissu', per: 'g', q: 1 },
      { n: 'Marque-places', per: 'g', q: 1 },
      { n: 'Centre de table', s: 'vase + fleurs de saison', per: 't', q: 1 },
      { n: 'Photophores & bougies', per: 't', q: 3 },
      { n: signature, s: 'touche signature', per: 't', q: 1 }
    ];
  }
  function packItems(signature) {
    return [{ n: 'Table (8 couverts)', per: 't', q: 1 }, { n: 'Chaises', per: 'g', q: 1 }]
      .concat(tableItems(signature))
      .concat([
        { n: 'Mange-debout', s: 'espace apéritif', per: 'd', q: 1 },
        { n: 'Guirlande lumineuse', per: 'v', q: 1 },
        { n: 'Arche décor photo', per: 'f', q: 1 },
        { n: 'Coin lounge', s: 'fauteuils & table basse', per: 'f', q: 1 }
      ]);
  }

  var COLS = {
    dolce: {
      name: 'Dolce Vita', uni: "Solstice d'Été", univers: 'ete', sig: "Citrons & branches d'olivier",
      desc: "Un dîner d'été sous les citronniers : lin naturel, citrons et lumière dorée.",
      page: '/collection-dolce-vita'
    },
    garden: {
      name: 'Garden Party', uni: "Solstice d'Été", univers: 'ete', sig: 'Bouquet champêtre',
      desc: 'Verdure douce, guinguette chic et vaisselle champêtre. Recevoir au jardin.',
      page: '/collection-garden-party'
    },
    black: {
      name: 'Black & Gold', uni: "Solstice d'Hiver", univers: 'hiver', sig: 'Chandeliers dorés',
      desc: "Noir profond, dorures et éclat des grands soirs. L'élégance des fêtes.",
      page: '/collection-black-gold'
    },
    white: {
      name: 'White Party', uni: "Solstice d'Hiver", univers: 'hiver', sig: 'Photophores givrés',
      desc: 'Total look immaculé, épuré et givré. La clarté d’un hiver lumineux.',
      page: '/collection-white-party'
    }
  };

  /* Suggestions — exemples, à remplacer par les vraies pièces plus tard. */
  var SUGGESTIONS = [
    { n: 'Mange-debout + housse', d: "Pour l'apéritif d'accueil" },
    { n: 'Arche fleurie', d: 'Le coin photo des invités' },
    { n: 'Coin lounge', d: 'Fauteuils, tapis et table basse' },
    { n: 'Brasero', d: 'Pour prolonger la soirée dehors' }
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
    '<div class="om-also" id="omAlso" hidden><h4>Ceux qui ont choisi cette table ont aussi ajouté</h4>' +
    '<div class="om-alsogrid" id="omAlsoGrid"></div></div>' +
    '</div>' +
    '<div class="om-foot"><button type="button" class="btn btn-ink om-add" id="omAdd">Ajouter au panier</button></div>' +
    '</div></div>';

  function init() {
    if (!document.querySelector('.offer-btn')) return;

    var host = document.createElement('div');
    host.innerHTML = MODAL_HTML;
    var root = host.firstChild;
    document.body.appendChild(root);

    var elKicker = root.querySelector('#omKicker'),
        elTitle = root.querySelector('#omTitle'),
        elDesc = root.querySelector('#omDesc'),
        elGuests = root.querySelector('#omGuests'),
        elList = root.querySelector('#omList'),
        elTotal = root.querySelector('#omTotal'),
        elAlso = root.querySelector('#omAlso'),
        elAlsoGrid = root.querySelector('#omAlsoGrid'),
        elAdd = root.querySelector('#omAdd');

    var state = { col: null, kind: 'pack', guests: DEFAULT_GUESTS, extras: [] };
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
      return state.kind === 'pack' ? packItems(c.sig) : tableItems(c.sig);
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
    function renderExtras() {
      if (state.kind !== 'table') { elAlso.hidden = true; elAlsoGrid.innerHTML = ''; return; }
      elAlso.hidden = false;
      elAlsoGrid.innerHTML = SUGGESTIONS.map(function (s, i) {
        var on = state.extras.indexOf(i) !== -1;
        return '<div class="om-sug"><span class="sn">' + esc(s.n) + '</span>' +
          '<span class="sd">' + esc(s.d) + '</span>' +
          '<button type="button" class="' + (on ? 'on' : '') + '" data-sug="' + i + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          (on ? 'Ajouté ✓' : '+ Ajouter') + '</button></div>';
      }).join('');
    }
    function syncAddLabel() {
      var n = state.kind === 'table' ? state.extras.length : 0;
      elAdd.textContent = n ? 'Ajouter au panier (' + (n + 1) + ' lots)' : 'Ajouter au panier';
    }
    function open(colKey, kind) {
      var c = COLS[colKey];
      if (!c) return;
      state.col = colKey; state.kind = kind; state.extras = [];
      state.guests = parseInt(elGuests.value, 10) || DEFAULT_GUESTS;
      elKicker.textContent = c.uni + ' · ' + c.name;
      elTitle.textContent = kind === 'pack' ? 'Le pack complet' : 'Les tables';
      elDesc.textContent = kind === 'pack'
        ? c.desc + ' Le décor entier : mobilier, art de la table, décoration et lumière.'
        : c.desc + ' Ici, uniquement la décoration de table.';
      renderList(); renderExtras(); syncAddLabel();
      lastFocus = document.activeElement;
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      elGuests.focus();
    }
    function close() {
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
      var b = e.target.closest('.offer-btn');
      if (b) { e.preventDefault(); open(b.getAttribute('data-col'), b.getAttribute('data-kind')); }
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-om-close]')) { close(); return; }
      var s = e.target.closest('[data-sug]');
      if (s) {
        var i = parseInt(s.getAttribute('data-sug'), 10);
        var at = state.extras.indexOf(i);
        if (at === -1) state.extras.push(i); else state.extras.splice(at, 1);
        renderExtras(); syncAddLabel();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('open')) close();
    });
    elGuests.addEventListener('change', function () {
      var g = parseInt(elGuests.value, 10) || DEFAULT_GUESTS;
      state.guests = Math.min(MAX_GUESTS, Math.max(1, g));
      renderList();
    });
    elAdd.addEventListener('click', function () {
      if (!window.SolCart) return;
      var c = COLS[state.col];
      var label = (state.kind === 'pack' ? 'Pack complet' : 'Les tables') + ' · ' + c.name;
      var prefix = state.col + '-' + state.kind + '-';
      currentItems().forEach(function (it) {
        window.SolCart.add({
          name: it.n, ref: slug(prefix + it.n),
          qty: qtyFor(it, state.guests),
          priceHint: label + ' · ' + state.guests + ' invités'
        });
      });
      state.extras.forEach(function (i) {
        var s = SUGGESTIONS[i];
        window.SolCart.add({ name: s.n, ref: slug('option-' + s.n), qty: 1, priceHint: 'Option · ' + c.name });
      });
      close();
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
        ? "Les deux collections du Solstice d'Été. Chacune se prend en pack complet ou en décoration de table seule."
        : "Les deux collections du Solstice d'Hiver. Chacune se prend en pack complet ou en décoration de table seule.";
    }
    var h1 = document.getElementById('collTitle');
    if (h1) h1.textContent = u === 'ete' ? "Les collections d'Été" : "Les collections d'Hiver";
    var all = document.getElementById('collAll');
    if (all) all.hidden = false;
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(function () { applyUniversFilter(); init(); });
})();
