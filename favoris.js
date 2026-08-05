/* Maison Solstice — page « Mes coups de cœur ».
   Affiche la liste enregistrée par fav.js. Deux types de coups de cœur :
   - une pièce du catalogue : elle s'ajoute directement à la sélection ;
   - une formule (pack ou table) : elle ouvre le choix du nombre d'invités,
     géré par collections.js.
   Un lien de partage permet de retrouver sa liste sur un autre appareil,
   sans compte. */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Encodage du lien de partage : JSON compact -> base64 sûr pour une URL. */
  function encodeList(items) {
    var compact = items.map(function (i) {
      return i.type === 'formule'
        ? { t: 'f', c: i.col, k: i.kind, n: i.name, g: i.glyph, h: i.priceHint }
        : { t: 'p', n: i.name, g: i.glyph, h: i.priceHint, p: i.price, u: i.unit, d: i.caution };
    });
    var json = JSON.stringify(compact);
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeList(s) {
    try {
      var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var arr = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!Array.isArray(arr)) return [];
      return arr.map(function (o) {
        return o.t === 'f'
          ? { type: 'formule', col: o.c, kind: o.k, name: o.n, glyph: o.g, priceHint: o.h }
          : { type: 'piece', name: o.n, glyph: o.g, priceHint: o.h, price: o.p, unit: o.u, caution: o.d };
      });
    } catch (e) { return []; }
  }

  var grid, empty, tools, countEl, shareBtn, statusEl;

  function render() {
    var items = window.SolFav ? window.SolFav.items() : [];
    var n = items.length;
    empty.hidden = n > 0;
    tools.hidden = n === 0;
    grid.hidden = n === 0;
    countEl.textContent = n + (n > 1 ? ' coups de cœur enregistrés sur cet appareil.' : ' coup de cœur enregistré sur cet appareil.');

    grid.innerHTML = items.map(function (i) {
      var isF = i.type === 'formule';
      var sub = isF
        ? esc(i.priceHint || 'Collection')
        : (typeof i.price === 'number' ? esc(i.priceHint) : 'Tarif au devis');
      /* Pour une formule on réutilise le bouton de collections.js, qui ouvre
         le choix du nombre d'invités. */
      var action = isF
        ? '<button type="button" class="fv-add offer-btn" data-col="' + esc(i.col) + '" data-kind="' + esc(i.kind) + '">Choisir mes invités</button>'
        : '<button type="button" class="fv-add" data-add="' + esc(i.id) + '">Ajouter au panier</button>';
      return '<article class="fv" data-id="' + esc(i.id) + '">' +
        '<div class="fv-img"><span class="fv-tag">' + (isF ? 'Collection' : 'Pièce') + '</span>' +
        '<svg viewBox="0 0 120 120" aria-hidden="true"><use href="#' + esc(i.glyph) + '"/></svg></div>' +
        '<div class="fv-b"><span class="fv-n">' + esc(i.name) + '</span>' +
        '<span class="fv-p">' + sub + '</span>' +
        '<div class="fv-act">' + action +
        '<button type="button" class="fv-rm" data-rm="' + esc(i.id) + '">Retirer</button></div></div></article>';
    }).join('');
  }

  function flash(msg) {
    statusEl.textContent = msg;
    clearTimeout(statusEl._t);
    statusEl._t = setTimeout(function () { statusEl.textContent = ''; }, 3500);
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    grid = document.getElementById('favGrid');
    if (!grid) return;
    empty = document.getElementById('favEmpty');
    tools = document.getElementById('favTools');
    countEl = document.getElementById('favCount');
    shareBtn = document.getElementById('favShare');
    statusEl = document.getElementById('favStatus');

    /* Liste reçue par lien : on la fusionne puis on nettoie l'adresse. */
    var shared = new URLSearchParams(location.search).get('l');
    if (shared && window.SolFav) {
      var added = window.SolFav.merge(decodeList(shared));
      history.replaceState(null, '', location.pathname);
      if (added) flash(added + (added > 1 ? ' coups de cœur ajoutés à votre liste.' : ' coup de cœur ajouté à votre liste.'));
      else flash('Ces coups de cœur étaient déjà dans votre liste.');
    }

    grid.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-rm]');
      if (rm) { window.SolFav.remove(rm.getAttribute('data-rm')); return; }
      var add = e.target.closest('[data-add]');
      if (add && window.SolCart) {
        var id = add.getAttribute('data-add');
        var it = window.SolFav.items().filter(function (x) { return x.id === id; })[0];
        if (!it) return;
        window.SolCart.add({
          name: it.name, qty: 1, price: it.price, unit: it.unit,
          caution: it.caution, priceHint: it.priceHint
        });
        add.textContent = 'Ajouté ✓';
        add.classList.add('on');
        setTimeout(function () { add.textContent = 'Ajouter au panier'; add.classList.remove('on'); }, 1600);
      }
    });

    shareBtn.addEventListener('click', function () {
      var items = window.SolFav.items();
      if (!items.length) return;
      var url = location.origin + '/favoris?l=' + encodeList(items);
      var done = function () {
        shareBtn.textContent = 'Lien copié ✓';
        shareBtn.classList.add('ok');
        flash('Collez ce lien où vous voulez : il rouvre votre liste sur n’importe quel appareil.');
        setTimeout(function () { shareBtn.textContent = 'Copier le lien de ma liste'; shareBtn.classList.remove('ok'); }, 2600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copiez ce lien :', url); });
      } else {
        window.prompt('Copiez ce lien :', url);
      }
    });

    if (window.SolFav) window.SolFav.onChange(render);
    render();
  });
})();
