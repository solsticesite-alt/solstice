/* Maison Solstice — coups de cœur.
   Enregistrés dans le navigateur du visiteur (aucun compte à créer) : il les
   retrouve tel quel à sa prochaine visite, sur le même appareil. Pour passer
   d'un appareil à l'autre, la page /favoris propose un lien de partage qui
   embarque la liste. */
(function () {
  'use strict';

  var LS_KEY = 'sol_fav_v1';
  var MAX = 200;
  var listeners = [];

  function num(v) {
    var n = Number(v);
    return (isFinite(n) && n >= 0 && v !== null && v !== '' && v !== undefined) ? n : null;
  }
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';
  }
  function clean(o) {
    if (!o || !o.name) return null;
    var type = o.type === 'formule' ? 'formule' : 'piece';
    return {
      id: String(o.id || (type === 'formule' ? 'f-' + o.col + '-' + o.kind : 'p-' + slugify(o.name))).slice(0, 90),
      type: type,
      name: String(o.name).slice(0, 160),
      glyph: String(o.glyph || 'g3-vase').slice(0, 30),
      priceHint: String(o.priceHint || '').slice(0, 60),
      price: num(o.price),
      unit: String(o.unit || '').slice(0, 12),
      caution: num(o.caution),
      col: String(o.col || '').slice(0, 20),
      kind: String(o.kind || '').slice(0, 12)
    };
  }
  function read() {
    try {
      var a = JSON.parse(localStorage.getItem(LS_KEY));
      if (!Array.isArray(a)) return [];
      return a.map(clean).filter(Boolean).slice(0, MAX);
    } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (e) {}
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](items); } catch (e) {} }
  }

  var SolFav = {
    items: function () { return read(); },
    count: function () { return read().length; },
    has: function (id) { return read().some(function (i) { return i.id === id; }); },
    add: function (o) {
      var it = clean(o); if (!it) return false;
      var items = read();
      if (items.some(function (i) { return i.id === it.id; })) return false;
      items.unshift(it); write(items.slice(0, MAX)); return true;
    },
    remove: function (id) { write(read().filter(function (i) { return i.id !== id; })); },
    toggle: function (o) {
      var it = clean(o); if (!it) return false;
      if (SolFav.has(it.id)) { SolFav.remove(it.id); return false; }
      SolFav.add(it); return true;
    },
    clear: function () { write([]); },
    /* Fusionne une liste partagée (lien) sans écraser l'existant. */
    merge: function (list) {
      if (!Array.isArray(list)) return 0;
      var items = read(), added = 0;
      list.map(clean).filter(Boolean).forEach(function (it) {
        if (!items.some(function (i) { return i.id === it.id; })) { items.push(it); added++; }
      });
      if (added) write(items.slice(0, MAX));
      return added;
    },
    onChange: function (fn) { if (typeof fn === 'function') { listeners.push(fn); fn(read()); } return fn; },
    idFor: function (o) { var c = clean(o); return c ? c.id : null; }
  };
  window.SolFav = SolFav;

  /* ------------------------------------------------------------ boutons ♥ */
  /* Deux sources possibles :
     - un bouton porteur de data-fav-* (packs et tables) ;
     - un bouton dans une fiche produit du catalogue : on lit la fiche. */
  function dataFromButton(btn) {
    if (btn.hasAttribute('data-fav-name')) {
      return {
        type: btn.getAttribute('data-fav-type') || 'formule',
        name: btn.getAttribute('data-fav-name'),
        glyph: btn.getAttribute('data-fav-glyph'),
        priceHint: btn.getAttribute('data-fav-hint') || '',
        col: btn.getAttribute('data-fav-col') || '',
        kind: btn.getAttribute('data-fav-kind') || ''
      };
    }
    var card = btn.closest('.card');
    if (!card) return null;
    var h3 = card.querySelector('.card-info h3, h3');
    if (!h3) return null;
    var priceEl = card.querySelector('.card-price');
    var hint = priceEl ? priceEl.textContent.replace(/\s+/g, ' ').trim() : '';
    var cautionEl = card.querySelector('.card-caution');
    var use = card.querySelector('.card-media use, .art use');
    var amount = function (t) {
      var m = String(t || '').replace(/ | /g, ' ').match(/(\d+(?:[.,]\d+)?)\s*€/);
      return m ? Number(m[1].replace(',', '.')) : null;
    };
    return {
      type: 'piece',
      name: h3.textContent.trim(),
      glyph: use ? (use.getAttribute('href') || '').replace('#', '') : 'g3-vase',
      priceHint: hint,
      price: amount(hint),
      unit: /week-?end/i.test(hint) ? 'week-end' : (/jour/i.test(hint) ? 'jour' : ''),
      caution: cautionEl ? amount(cautionEl.textContent) : null
    };
  }

  function syncButtons() {
    document.querySelectorAll('.fav').forEach(function (btn) {
      var d = dataFromButton(btn);
      if (!d) return;
      var on = SolFav.has(SolFav.idFor(d));
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = d.name + (on ? ' — retirer de mes coups de cœur' : ' — ajouter à mes coups de cœur');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', on ? 'Retirer de mes coups de cœur' : 'Ajouter à mes coups de cœur');
    });
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.fav');
      if (!btn) return;
      e.preventDefault();
      var d = dataFromButton(btn);
      if (!d) return;
      SolFav.toggle(d);
      syncButtons();
    });
    SolFav.onChange(syncButtons);
  });
})();
