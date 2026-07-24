/* Solstice — sélection (panier) + demande de devis.
   Autonome : injecte son propre style, se branche sur toutes les pages
   (y compris index.html qui n'utilise pas site.js). */
(function () {
  'use strict';

  var LS_KEY = 'sol_cart_v1';
  var MAX_QTY = 999;
  var listeners = [];

  /* ---------------------------------------------------------------- store */
  function read() {
    try {
      var a = JSON.parse(localStorage.getItem(LS_KEY));
      if (!Array.isArray(a)) return [];
      return a.filter(function (i) { return i && i.name; }).map(function (i) {
        return {
          name: String(i.name).slice(0, 160),
          ref: String(i.ref || slugify(i.name)).slice(0, 80),
          qty: clampQty(i.qty),
          priceHint: String(i.priceHint || '').slice(0, 40)
        };
      });
    } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (e) {}
    emit();
  }
  function emit() {
    var it = read();
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](it); } catch (e) {} }
  }
  function clampQty(q) { q = Math.round(Number(q) || 1); return Math.max(1, Math.min(MAX_QTY, q)); }
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'piece';
  }

  var SolCart = {
    items: function () { return read(); },
    count: function () { return read().reduce(function (n, i) { return n + i.qty; }, 0); },
    lines: function () { return read().length; },
    add: function (p) {
      if (!p || !p.name) return;
      var items = read();
      var ref = p.ref || slugify(p.name);
      var q = clampQty(p.qty || 1);
      var found = null;
      for (var i = 0; i < items.length; i++) { if (items[i].ref === ref) { found = items[i]; break; } }
      if (found) found.qty = clampQty(found.qty + q);
      else items.push({ name: String(p.name).slice(0, 160), ref: ref, qty: q, priceHint: String(p.priceHint || '').slice(0, 40) });
      write(items);
    },
    setQty: function (ref, qty) {
      var items = read(), out = [];
      qty = Math.round(Number(qty) || 0);
      for (var i = 0; i < items.length; i++) {
        if (items[i].ref === ref) { if (qty > 0) { items[i].qty = Math.min(MAX_QTY, qty); out.push(items[i]); } }
        else out.push(items[i]);
      }
      write(out);
    },
    remove: function (ref) { write(read().filter(function (i) { return i.ref !== ref; })); },
    clear: function () { write([]); },
    onChange: function (fn) { if (typeof fn === 'function') { listeners.push(fn); fn(read()); } return fn; }
  };
  window.SolCart = SolCart;

  /* ----------------------------------------------------------------- utils */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ------------------------------------------------------------------ style */
  function injectStyle() {
    if (document.getElementById('sol-cart-style')) return;
    var css = [
      '.sol-cart-root{position:fixed;inset:0;z-index:80;display:none;}',
      '.sol-cart-root.open{display:block;}',
      '.sol-cart-scrim{position:absolute;inset:0;background:rgba(34,28,21,.42);backdrop-filter:blur(3px);opacity:0;transition:opacity .35s ease;}',
      '.sol-cart-root.open .sol-cart-scrim{opacity:1;}',
      '.sol-cart-panel{position:absolute;top:0;right:0;height:100%;width:min(420px,100%);background:var(--paper,#FBF8F2);color:var(--ink,#221C15);',
      'display:flex;flex-direction:column;box-shadow:-30px 0 70px -40px rgba(34,28,21,.6);transform:translateX(100%);transition:transform .42s cubic-bezier(.2,.7,.2,1);}',
      '.sol-cart-root.open .sol-cart-panel{transform:none;}',
      '.sol-cart-head{display:flex;align-items:center;justify-content:space-between;padding:1.5rem 1.5rem 1.15rem;border-bottom:1px solid var(--line,#E6DCCB);}',
      '.sol-cart-head .eyebrow{font-family:var(--sans,inherit);font-size:.7rem;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--gold-deep,#8C6C3D);}',
      '.sol-cart-x{width:38px;height:38px;border-radius:99px;font-size:1.5rem;line-height:1;color:var(--ink,#221C15);display:grid;place-items:center;transition:background .3s,color .3s;}',
      '.sol-cart-x:hover{background:rgba(176,138,84,.12);color:var(--gold-deep,#8C6C3D);}',
      '.sol-cart-body{flex:1;overflow-y:auto;padding:.5rem 1.5rem 1rem;}',
      '.sol-cart-empty{color:var(--stone,#6F6455);font-size:.95rem;line-height:1.6;padding:2.2rem 0;text-align:center;}',
      '.sol-cart-empty a{color:var(--gold-deep,#8C6C3D);border-bottom:1px solid var(--gold,#B08A54);}',
      '.sol-ci{display:flex;align-items:center;gap:.7rem;padding:1rem 0;border-bottom:1px solid var(--line-soft,#EFE7D8);}',
      '.sol-ci-main{flex:1;min-width:0;}',
      '.sol-ci-name{display:block;font-family:var(--serif,Georgia,serif);font-size:1rem;line-height:1.3;color:var(--ink,#221C15);}',
      '.sol-ci-price{display:block;font-size:.74rem;letter-spacing:.03em;color:var(--stone,#6F6455);margin-top:.2rem;}',
      '.sol-ci-qty{display:inline-flex;align-items:center;border:1px solid var(--line,#E6DCCB);border-radius:99px;overflow:hidden;flex:none;}',
      '.sol-ci-qty button{width:30px;height:30px;font-size:1.05rem;line-height:1;color:var(--ink-soft,#5B5142);display:grid;place-items:center;transition:background .25s,color .25s;}',
      '.sol-ci-qty button:hover{background:var(--sand,#EEE4D3);color:var(--ink,#221C15);}',
      '.sol-ci-n{min-width:30px;text-align:center;font-size:.85rem;font-weight:600;font-variant-numeric:tabular-nums;}',
      '.sol-ci-rm{width:26px;height:26px;border-radius:99px;font-size:1.05rem;line-height:1;color:var(--stone,#6F6455);flex:none;display:grid;place-items:center;transition:background .25s,color .25s;}',
      '.sol-ci-rm:hover{background:rgba(176,60,50,.1);color:#a23b30;}',
      '.sol-cart-foot{border-top:1px solid var(--line,#E6DCCB);padding:1.15rem 1.5rem 1.5rem;background:var(--paper-2,#F5EEE1);}',
      '.sol-cart-note{font-size:.78rem;line-height:1.55;color:var(--stone,#6F6455);margin:0 0 1rem;}',
      '.sol-cart-cta{width:100%;}',
      '.sol-cart-count{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-deep,#8C6C3D);margin:.2rem 0 .6rem;}',
      /* toast */
      '.sol-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);z-index:90;background:var(--ink,#221C15);color:var(--paper,#FBF8F2);',
      'font-size:.8rem;letter-spacing:.02em;padding:.8em 1.3em;border-radius:99px;box-shadow:0 20px 40px -18px rgba(34,28,21,.6);opacity:0;pointer-events:none;transition:opacity .3s ease,transform .3s ease;}',
      '.sol-toast.show{opacity:1;transform:translate(-50%,0);}',
      /* selection dans le formulaire contact */
      '.sol-sel{margin:0 0 .4rem;}',
      '.sol-sel .sol-sel-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;margin-bottom:.4rem;}',
      '.sol-sel .sol-sel-head .link-more{cursor:pointer;background:none;}',
      '.sol-sel-box{border:1px solid var(--line,#E6DCCB);border-radius:clamp(12px,1.4vw,18px);background:var(--paper,#FBF8F2);padding:.4rem 1.1rem;}',
      '.sol-sel-box .sol-cart-empty{padding:1.3rem 0;font-size:.9rem;}',
      '.sol-sel-box .sol-ci{padding:.85rem 0;}',
      /* honeypot */
      '.sol-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden;}',
      /* feedback bouton d\'ajout */
      '.card-add.added{background:var(--gold,#B08A54)!important;color:#fff!important;}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'sol-cart-style';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ----------------------------------------------------------- item render */
  function itemRowHtml(it) {
    return '<div class="sol-ci" data-ref="' + esc(it.ref) + '">' +
      '<div class="sol-ci-main"><span class="sol-ci-name">' + esc(it.name) + '</span>' +
      (it.priceHint ? '<span class="sol-ci-price">' + esc(it.priceHint) + '</span>' : '') + '</div>' +
      '<div class="sol-ci-qty"><button type="button" data-act="dec" aria-label="Diminuer la quantité">−</button>' +
      '<span class="sol-ci-n">' + it.qty + '</span>' +
      '<button type="button" data-act="inc" aria-label="Augmenter la quantité">+</button></div>' +
      '<button type="button" class="sol-ci-rm" data-act="rm" aria-label="Retirer">×</button></div>';
  }
  function bindRows(container, opts) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var row = btn.closest('.sol-ci'); if (!row) return;
      var ref = row.getAttribute('data-ref');
      var cur = 0;
      SolCart.items().forEach(function (i) { if (i.ref === ref) cur = i.qty; });
      var act = btn.getAttribute('data-act');
      if (act === 'inc') SolCart.setQty(ref, cur + 1);
      else if (act === 'dec') SolCart.setQty(ref, cur - 1);
      else if (act === 'rm') SolCart.remove(ref);
    });
  }
  function renderList(container, emptyHtml) {
    var items = SolCart.items();
    if (!items.length) { container.innerHTML = emptyHtml; return; }
    container.innerHTML = items.map(itemRowHtml).join('');
  }

  /* --------------------------------------------------------------- drawer */
  var drawer, drawerBody;
  function buildDrawer() {
    var onContact = /(^|\/)contact($|[/?#.])/.test(location.pathname);
    var ctaHtml = onContact
      ? '<button type="button" class="btn btn-ink sol-cart-cta" data-goform>Compléter ma demande <svg aria-hidden="true" width="16" height="16"><use href="#i-arrow"/></svg></button>'
      : '<a class="btn btn-ink sol-cart-cta" href="/contact">Demander mon devis <svg aria-hidden="true" width="16" height="16"><use href="#i-arrow"/></svg></a>';
    drawer = el(
      '<div class="sol-cart-root" id="solCartRoot" aria-hidden="true">' +
      '<div class="sol-cart-scrim" data-close></div>' +
      '<aside class="sol-cart-panel" role="dialog" aria-modal="true" aria-label="Votre sélection">' +
      '<div class="sol-cart-head"><span class="eyebrow">Votre sélection</span>' +
      '<button type="button" class="sol-cart-x" data-close aria-label="Fermer">×</button></div>' +
      '<div class="sol-cart-body" id="solCartBody"></div>' +
      '<div class="sol-cart-foot"><p class="sol-cart-note">Aucun paiement en ligne. Ajoutez les pièces qui vous font envie : nous revenons vers vous avec un devis sur mesure sous 24 à 48 h.</p>' +
      ctaHtml + '</div></aside></div>'
    );
    document.body.appendChild(drawer);
    drawerBody = drawer.querySelector('#solCartBody');

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) { closeDrawer(); return; }
      if (e.target.closest('[data-goform]')) {
        closeDrawer();
        var f = document.getElementById('devis-form');
        if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    });
    bindRows(drawerBody);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

    var emptyHtml = '<p class="sol-cart-empty">Votre sélection est vide.<br>Parcourez le <a href="/catalogue">catalogue</a> et ajoutez vos pièces favorites.</p>';
    SolCart.onChange(function () { renderList(drawerBody, emptyHtml); });
  }
  function openDrawer() { if (!drawer) return; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
  function closeDrawer() { if (!drawer) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }

  /* ------------------------------------------------------------ badges/nav */
  function syncBadges() {
    var n = SolCart.count();
    document.querySelectorAll('.nav-tools .count').forEach(function (b) {
      b.textContent = n;
      b.style.display = n > 0 ? '' : 'none';
    });
  }
  function wireCartButtons() {
    document.querySelectorAll('.nav-tools [aria-label="Panier"]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); openDrawer(); });
    });
  }

  /* --------------------------------------------------------- add-to-cart */
  function productFromCard(card) {
    if (!card) return null;
    var h3 = card.querySelector('.card-info h3, h3');
    var name = h3 ? h3.textContent.trim() : '';
    if (!name) return null;
    var priceEl = card.querySelector('.card-price');
    var priceHint = priceEl ? priceEl.textContent.replace(/\s+/g, ' ').trim() : '';
    return { name: name, ref: slugify(name), priceHint: priceHint };
  }
  function wireAddButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.card-add');
      if (!btn) return;
      e.preventDefault();
      var p = productFromCard(btn.closest('.card'));
      if (!p) return;
      SolCart.add(p);
      var original = btn.getAttribute('data-label') || btn.textContent;
      if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', original.trim());
      btn.classList.add('added');
      btn.textContent = 'Ajouté ✓';
      clearTimeout(btn._solT);
      btn._solT = setTimeout(function () {
        btn.classList.remove('added');
        btn.textContent = btn.getAttribute('data-label');
      }, 1400);
      toast('Ajouté à votre sélection');
    });
  }

  /* ---------------------------------------------------------------- toast */
  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = el('<div class="sol-toast" role="status" aria-live="polite"></div>'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 1900);
  }

  /* --------------------------------------------------- contact : sélection */
  function mountContactSelection() {
    var mount = document.getElementById('cart-selection');
    if (!mount) return;
    mount.classList.add('sol-sel');
    mount.innerHTML =
      '<div class="sol-sel-head"><span class="eyebrow">Votre sélection</span>' +
      '<a class="link-more" href="/catalogue">Ajouter des pièces <svg aria-hidden="true" width="14" height="14"><use href="#i-arrow"/></svg></a></div>' +
      '<div class="sol-sel-box" id="solSelBox"></div>';
    var box = mount.querySelector('#solSelBox');
    bindRows(box);
    var emptyHtml = '<p class="sol-cart-empty">Aucune pièce sélectionnée pour l’instant. Décrivez votre projet ci-dessous, ou parcourez le <a href="/catalogue">catalogue</a>.</p>';
    SolCart.onChange(function () { renderList(box, emptyHtml); });
  }

  /* --------------------------------------------------- contact : formulaire */
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; }
  function selectedText(id) {
    var e = document.getElementById(id);
    if (!e || e.selectedIndex < 0) return '';
    var o = e.options[e.selectedIndex];
    return (o && o.value) ? o.text.trim() : '';
  }
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }

  function wireContactForm() {
    var form = document.getElementById('devis-form');
    if (!form) return;
    var status = document.getElementById('form-status');
    var btn = form.querySelector('.btn-submit');

    function setStatus(msg, kind) {
      if (!status) return;
      status.textContent = msg || '';
      status.className = 'form-status' + (kind ? ' ' + kind : '');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = val('c-nom'), email = val('c-email');
      var message = val('c-message'), items = SolCart.items();
      var consent = document.getElementById('c-consent');

      if (!name) { setStatus('Merci d’indiquer votre nom.', 'err'); focus('c-nom'); return; }
      if (!isEmail(email)) { setStatus('Merci d’indiquer un e-mail valide.', 'err'); focus('c-email'); return; }
      if (!message && !items.length) { setStatus('Ajoutez un message ou quelques pièces à votre sélection.', 'err'); focus('c-message'); return; }
      if (consent && !consent.checked) { setStatus('Merci d’accepter le traitement de vos données pour que nous puissions vous répondre.', 'err'); return; }

      var hp = document.getElementById('c-website');
      var payload = {
        name: name, email: email, phone: val('c-tel'),
        eventType: selectedText('c-type'), date: val('c-date'),
        location: val('c-lieu'), guests: val('c-invites'),
        message: message,
        items: items.map(function (i) { return { name: i.name, ref: i.ref, qty: i.qty, priceHint: i.priceHint }; }),
        website: hp ? hp.value : ''
      };

      if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
      setStatus('Envoi en cours…', '');

      fetch('/api/devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().catch(function () { return { ok: r.ok }; }).then(function (j) { return { status: r.status, json: j }; });
      }).then(function (res) {
        if (res.status === 200 && res.json && res.json.ok) {
          SolCart.clear();
          showSuccess(form, res.json.ref);
        } else {
          var m = errorMessage(res.json && res.json.error);
          setStatus(m, 'err');
          if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
        }
      }).catch(function () {
        setStatus('La connexion a échoué. Réessayez dans un instant, ou écrivez-nous directement par e-mail.', 'err');
        if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
      });
    });
  }
  function focus(id) { var e = document.getElementById(id); if (e) e.focus(); }
  function errorMessage(code) {
    switch (code) {
      case 'email_invalid': return 'Merci d’indiquer un e-mail valide.';
      case 'name_required': return 'Merci d’indiquer votre nom.';
      case 'empty_request': return 'Ajoutez un message ou quelques pièces à votre sélection.';
      case 'store_not_configured': return 'Le service de demande n’est pas encore activé. Écrivez-nous directement par e-mail en attendant.';
      default: return 'Une erreur est survenue. Réessayez, ou écrivez-nous directement par e-mail.';
    }
  }
  function showSuccess(form, ref) {
    var card = el(
      '<div class="form-success" role="status" aria-live="polite">' +
      '<div class="form-success-mark"><svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6"/></svg></div>' +
      '<h3>Votre demande est bien partie ✨</h3>' +
      '<p>Merci ! Nous avons reçu votre demande' + (ref ? ' (réf. <b>' + esc(ref) + '</b>)' : '') +
      '. Notre atelier revient vers vous avec une proposition sur mesure sous 24 à 48 heures.</p>' +
      '<a class="btn btn-ghost" href="/catalogue">Continuer à explorer le catalogue</a></div>'
    );
    form.parentNode.replaceChild(card, form);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    injectSuccessStyle();
  }
  function injectSuccessStyle() {
    if (document.getElementById('sol-success-style')) return;
    var css = '.form-success{text-align:center;padding:1rem 0 .5rem;}' +
      '.form-success-mark{width:64px;height:64px;border-radius:99px;margin:.4rem auto 1.1rem;display:grid;place-items:center;color:#fff;background:var(--gold,#B08A54);box-shadow:0 18px 34px -18px rgba(176,138,84,.7);}' +
      '.form-success h3{font-size:clamp(1.4rem,3vw,1.9rem);margin:0 0 .6rem;}' +
      '.form-success p{color:var(--ink-soft,#5B5142);max-width:44ch;margin:0 auto 1.5rem;line-height:1.7;}' +
      '.form-status{margin-top:1rem;font-size:.85rem;line-height:1.5;min-height:1em;}' +
      '.form-status.err{color:#a23b30;}';
    var s = document.createElement('style'); s.id = 'sol-success-style'; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ init */
  onReady(function () {
    injectStyle();
    buildDrawer();
    wireCartButtons();
    wireAddButtons();
    mountContactSelection();
    wireContactForm();
    SolCart.onChange(syncBadges);
  });
})();
