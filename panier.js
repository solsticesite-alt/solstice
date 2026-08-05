/* Maison Solstice — page panier.
   Parcours en 3 temps : sélection → informations → paiement.
   Principes retenus (recherche Baymard sur l'abandon de panier) :
   - aucun coût caché : tout est annoncé dès la première étape ;
   - pas de création de compte imposée ;
   - le moins de champs possible ;
   - un fil d'étapes visible, et un bouton toujours atteignable sur mobile. */
(function () {
  'use strict';

  var PREFS_KEY = 'sol_cart_prefs_v1';
  var DAYS = { jour: 1, weekend: 2 };

  var prefs = readPrefs();
  var undo = null;

  function readPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
      return {
        duration: p.duration === 'weekend' ? 'weekend' : 'jour',
        delivery: p.delivery === 'livraison' ? 'livraison' : 'retrait',
        date: String(p.date || ''), guests: String(p.guests || ''),
        place: String(p.place || ''),
        payment: p.payment === 'full' ? 'full' : 'deposit'
      };
    } catch (e) {
      return { duration: 'jour', delivery: 'retrait', date: '', guests: '', place: '', payment: 'deposit' };
    }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function eur(n) {
    return (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  }
  function days() { return DAYS[prefs.duration] || 1; }

  /* Une pièce facturée au week-end garde son tarif ; une pièce au jour est
     multipliée par le nombre de jours. */
  function lineTotal(it) {
    if (typeof it.price !== 'number') return null;
    return it.unit === 'week-end' ? it.price * it.qty : it.price * it.qty * days();
  }
  function totals() {
    var items = window.SolCart ? window.SolCart.items() : [];
    var t = { sub: 0, caution: 0, pieces: 0, lines: items.length, quoted: 0 };
    items.forEach(function (i) {
      t.pieces += i.qty;
      var lt = lineTotal(i);
      if (lt === null) t.quoted++; else t.sub += lt;
      if (typeof i.caution === 'number') t.caution += i.caution * i.qty;
    });
    return t;
  }

  /* Vignette : on réutilise les illustrations du site selon le nom de la pièce. */
  var GLYPHS = [
    [/chaise|assise|tabouret/i, 'g3-chair'],
    [/table|mange-debout|nappe|chemin/i, 'g3-table'],
    [/verre|verrerie|coupe|champagne/i, 'g3-glass'],
    [/couvert|ménagère|menagere|assiette|vaisselle/i, 'g3-cutlery'],
    [/arche|cérémonie|ceremonie/i, 'g3-arch'],
    [/photo|photobooth|cadre/i, 'g3-camera'],
    [/bougie|photophore|chandelier|brasero|lanterne/i, 'g3-candles'],
    [/guirlande|lumière|lumiere|lampion/i, 'g3-lights'],
    [/fleur|bouquet|centre de table|végétal|vegetal|eucalyptus|citron/i, 'g3-vase'],
    [/lounge|fauteuil|coin/i, 'g3-chair']
  ];
  function glyphFor(name) {
    for (var i = 0; i < GLYPHS.length; i++) if (GLYPHS[i][0].test(name)) return GLYPHS[i][1];
    return 'g3-vase';
  }

  /* ------------------------------------------------------------------ vues */
  var el = {};
  function $(id) { return document.getElementById(id); }

  function renderItems() {
    var items = window.SolCart ? window.SolCart.items() : [];
    el.count.textContent = items.length ? (totals().pieces + ' pièce' + (totals().pieces > 1 ? 's' : '')) : '';

    if (!items.length) {
      el.empty.hidden = false;
      el.list.innerHTML = '';
      el.layout.classList.add('is-empty');
      return;
    }
    el.empty.hidden = true;
    el.layout.classList.remove('is-empty');

    el.list.innerHTML = items.map(function (it) {
      var lt = lineTotal(it);
      var unit = typeof it.price === 'number'
        ? eur(it.price) + ' / ' + (it.unit || 'jour')
        : 'Tarif au devis';
      return '<article class="ci" data-ref="' + esc(it.ref) + '">' +
        '<div class="ci-img"><svg viewBox="0 0 120 120" aria-hidden="true"><use href="#' + glyphFor(it.name) + '"/></svg></div>' +
        '<div class="ci-main">' +
          '<h3>' + esc(it.name) + '</h3>' +
          (it.priceHint && typeof it.price !== 'number' ? '<p class="ci-ctx">' + esc(it.priceHint) + '</p>' : '') +
          '<p class="ci-unit">' + esc(unit) + '</p>' +
          '<button type="button" class="ci-rm" data-act="rm">Retirer</button>' +
        '</div>' +
        '<div class="ci-right">' +
          '<div class="qty"><button type="button" data-act="dec" aria-label="Diminuer la quantité de ' + esc(it.name) + '">−</button>' +
          '<span class="qty-n" aria-live="polite">' + it.qty + '</span>' +
          '<button type="button" data-act="inc" aria-label="Augmenter la quantité de ' + esc(it.name) + '">+</button></div>' +
          '<span class="ci-total">' + (lt === null ? '<em>au devis</em>' : eur(lt)) + '</span>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function renderSummary() {
    var t = totals();
    var liv = prefs.delivery === 'retrait';
    el.sumPieces.textContent = t.pieces;
    el.sumDuration.textContent = prefs.duration === 'weekend' ? 'Week-end (2 jours)' : '1 journée';
    el.sumSub.textContent = t.sub > 0 ? eur(t.sub) : '—';
    el.sumQuoted.hidden = t.quoted === 0;
    if (t.quoted) el.sumQuotedN.textContent = t.quoted + (t.quoted > 1 ? ' pièces à chiffrer' : ' pièce à chiffrer');
    el.sumDeliv.textContent = liv ? 'Offert' : 'Selon la distance';
    el.sumDeliv.className = 'sum-v' + (liv ? ' is-free' : '');
    el.sumDelivNote.hidden = liv;
    el.sumCaution.textContent = t.caution > 0 ? eur(t.caution) : '—';
    el.sumTotal.textContent = t.sub > 0 ? eur(t.sub) : 'Au devis';
    el.sumTotalNote.hidden = !(t.quoted || !liv);

    var empty = t.lines === 0;
    el.go.disabled = empty;
    el.stickyGo.disabled = empty;
    el.stickyTotal.textContent = t.sub > 0 ? eur(t.sub) : (empty ? '—' : 'Au devis');
    el.sticky.hidden = empty;
  }

  function renderAll() { renderItems(); renderSummary(); }

  /* ------------------------------------------------------------- étapes */
  function goStep(n) {
    [1, 2, 3].forEach(function (i) {
      $('step' + i).hidden = i !== n;
      var b = $('bc' + i);
      b.classList.toggle('is-on', i === n);
      b.classList.toggle('is-done', i < n);
    });
    el.sticky.hidden = n !== 1 || totals().lines === 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------- envoi */
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s); }

  function submitRequest() {
    var status = $('pStatus');
    var btn = $('pSend');
    var name = $('f-nom').value.trim();
    var email = $('f-email').value.trim();
    if (!name) { status.textContent = 'Merci d’indiquer votre nom.'; status.className = 'p-status err'; $('f-nom').focus(); return; }
    if (!isEmail(email)) { status.textContent = 'Merci d’indiquer un e-mail valide.'; status.className = 'p-status err'; $('f-email').focus(); return; }
    if (!$('f-consent').checked) { status.textContent = 'Merci d’accepter le traitement de vos données pour qu’on puisse vous répondre.'; status.className = 'p-status err'; return; }

    var items = window.SolCart.items();
    var t = totals();
    var s = split();
    var reglement = prefs.payment === 'full'
      ? 'paiement intégral à la commande' + (t.sub > 0 ? ' (' + eur(s.sub) + ')' : '')
      : 'acompte 50 % à la commande' + (t.sub > 0 ? ' (' + eur(s.acompte) + ') puis ' + eur(s.solde) + ' à la livraison' : '');
    var recap = 'Formule : ' + (prefs.duration === 'weekend' ? 'week-end (2 jours)' : '1 journée') +
      ' · ' + (prefs.delivery === 'retrait' ? 'retrait à l’atelier' : 'livraison souhaitée') +
      (t.sub > 0 ? ' · estimation location ' + eur(t.sub) : '') +
      (t.caution > 0 ? ' · caution ' + eur(t.caution) : '') +
      ' · Règlement : ' + reglement;

    var payload = {
      name: name, email: email, phone: $('f-tel').value.trim(),
      eventType: $('f-type').value, date: prefs.date, location: prefs.place,
      guests: prefs.guests,
      message: ($('f-message').value.trim() + '\n\n' + recap).trim(),
      payment: prefs.payment,
      items: items.map(function (i) { return { name: i.name, ref: i.ref, qty: i.qty, priceHint: i.priceHint }; }),
      website: $('f-website').value
    };

    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    status.textContent = 'Envoi en cours…'; status.className = 'p-status';

    fetch('/api/devis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: r.ok }; }).then(function (j) { return { status: r.status, json: j }; });
    }).then(function (res) {
      if (res.status === 200 && res.json && res.json.ok) {
        window.SolCart.clear();
        $('pDone').hidden = false;
        $('pForm3').hidden = true;
        if (res.json.ref) $('pRef').textContent = res.json.ref;
        else $('pRefWrap').hidden = true;
      } else {
        var code = res.json && res.json.error;
        status.textContent = code === 'store_not_configured'
          ? 'Le service de demande n’est pas encore activé. Écrivez-nous directement en attendant.'
          : 'Une erreur est survenue. Réessayez, ou écrivez-nous directement.';
        status.className = 'p-status err';
        btn.disabled = false; btn.removeAttribute('aria-busy');
      }
    }).catch(function () {
      status.textContent = 'La connexion a échoué. Réessayez dans un instant.';
      status.className = 'p-status err';
      btn.disabled = false; btn.removeAttribute('aria-busy');
    });
  }

  /* -------------------------------------------------------------- init */
  function init() {
    ['list', 'empty', 'count', 'layout', 'sticky'].forEach(function (k) { el[k] = $('p' + k.charAt(0).toUpperCase() + k.slice(1)); });
    el.list = $('pList'); el.empty = $('pEmpty'); el.count = $('pCount');
    el.layout = $('pLayout'); el.sticky = $('pSticky');
    el.sumPieces = $('sumPieces'); el.sumDuration = $('sumDuration'); el.sumSub = $('sumSub');
    el.sumQuoted = $('sumQuoted'); el.sumQuotedN = $('sumQuotedN');
    el.sumDeliv = $('sumDeliv'); el.sumDelivNote = $('sumDelivNote');
    el.sumCaution = $('sumCaution'); el.sumTotal = $('sumTotal'); el.sumTotalNote = $('sumTotalNote');
    el.go = $('pGo'); el.stickyGo = $('pStickyGo'); el.stickyTotal = $('pStickyTotal');

    /* préférences mémorisées */
    document.querySelectorAll('[name="duration"]').forEach(function (r) {
      r.checked = r.value === prefs.duration;
      r.addEventListener('change', function () { prefs.duration = r.value; savePrefs(); renderAll(); });
    });
    document.querySelectorAll('[name="delivery"]').forEach(function (r) {
      r.checked = r.value === prefs.delivery;
      r.addEventListener('change', function () { prefs.delivery = r.value; savePrefs(); renderAll(); });
    });
    var fd = $('f-date'), fg = $('f-guests'), fp = $('f-place');
    fd.value = prefs.date; fg.value = prefs.guests; fp.value = prefs.place;
    fd.addEventListener('change', function () { prefs.date = fd.value; savePrefs(); });
    fg.addEventListener('change', function () { prefs.guests = fg.value; savePrefs(); });
    fp.addEventListener('input', function () { prefs.place = fp.value; savePrefs(); });

    /* lignes du panier */
    el.list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var row = b.closest('.ci'); var ref = row.getAttribute('data-ref');
      var cur = 0, item = null;
      window.SolCart.items().forEach(function (i) { if (i.ref === ref) { cur = i.qty; item = i; } });
      var act = b.getAttribute('data-act');
      if (act === 'inc') window.SolCart.setQty(ref, cur + 1);
      else if (act === 'dec') { if (cur > 1) window.SolCart.setQty(ref, cur - 1); else removeWithUndo(item); }
      else if (act === 'rm') removeWithUndo(item);
    });

    /* ajout des suggestions */
    document.querySelectorAll('.xs-add').forEach(function (b) {
      b.addEventListener('click', function () {
        window.SolCart.add({
          name: b.getAttribute('data-name'), qty: 1,
          price: Number(b.getAttribute('data-price')) || null,
          unit: b.getAttribute('data-unit') || 'jour',
          caution: Number(b.getAttribute('data-caution')) || null,
          priceHint: b.getAttribute('data-price') ? b.getAttribute('data-price') + ' € / ' + (b.getAttribute('data-unit') || 'jour') : ''
        });
        b.textContent = 'Ajouté ✓'; b.classList.add('on');
        setTimeout(function () { b.textContent = '+ Ajouter'; b.classList.remove('on'); }, 1600);
      });
    });

    /* navigation entre les étapes */
    el.go.addEventListener('click', function () { goStep(2); });
    el.stickyGo.addEventListener('click', function () { goStep(2); });
    $('back1').addEventListener('click', function () { goStep(1); });
    $('back2').addEventListener('click', function () { goStep(2); });
    $('toStep3').addEventListener('click', function () {
      var name = $('f-nom').value.trim(), email = $('f-email').value.trim();
      var st = $('pStatus2');
      if (!name) { st.textContent = 'Merci d’indiquer votre nom.'; st.className = 'p-status err'; $('f-nom').focus(); return; }
      if (!isEmail(email)) { st.textContent = 'Merci d’indiquer un e-mail valide.'; st.className = 'p-status err'; $('f-email').focus(); return; }
      st.textContent = ''; st.className = 'p-status';
      renderRecap();
      goStep(3);
    });
    $('pSend').addEventListener('click', submitRequest);

    function renderRecap() {
      var t = totals();
      $('rcPieces').textContent = t.pieces + ' pièce' + (t.pieces > 1 ? 's' : '');
      $('rcFormule').textContent = (prefs.duration === 'weekend' ? 'Week-end (2 jours)' : '1 journée') +
        ' · ' + (prefs.delivery === 'retrait' ? 'Retrait à l’atelier' : 'Livraison');
      $('rcDate').textContent = prefs.date ? new Date(prefs.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'à préciser';
      $('rcSub').textContent = t.sub > 0 ? eur(t.sub) : 'Au devis';
      $('rcCaution').textContent = t.caution > 0 ? eur(t.caution) : '—';
      renderPayment();
    }

    /* ---------- choix du règlement (acompte ou paiement complet) ---------- */
    document.querySelectorAll('[name="payment"]').forEach(function (r) {
      r.checked = r.value === prefs.payment;
      r.addEventListener('change', function () { prefs.payment = r.value; savePrefs(); renderPayment(); });
    });

    if (window.SolCart) window.SolCart.onChange(renderAll);
    renderAll();
  }

  /* L'acompte est la moitié du total ; le solde se déduit du total pour que la
     somme des deux tombe toujours juste. */
  function split() {
    var sub = totals().sub;
    var acompte = Math.round((sub / 2) * 100) / 100;
    return { sub: sub, acompte: acompte, solde: Math.round((sub - acompte) * 100) / 100 };
  }
  function renderPayment() {
    var s = split(), known = s.sub > 0;
    var elD = $('payAmtDeposit'), elF = $('payAmtFull'), rec = $('payRecap');
    if (!elD || !rec) return;
    elD.textContent = known ? eur(s.acompte) + ' maintenant' : 'Montant à confirmer';
    elF.textContent = known ? eur(s.sub) + ' maintenant' : 'Montant à confirmer';
    var t = totals();
    var caution = t.caution > 0 ? '<div class="r"><span>Caution (restituée au retour)</span><span>' + eur(t.caution) + '</span></div>' : '';
    if (!known) {
      rec.innerHTML = '<div class="r"><span>Montant définitif</span><span>confirmé sur votre facture</span></div>' + caution;
      return;
    }
    rec.innerHTML = prefs.payment === 'full'
      ? '<div class="r"><span>À régler à la commande</span><b>' + eur(s.sub) + '</b></div>' +
        '<div class="r"><span>À la livraison</span><span>rien à payer</span></div>' + caution
      : '<div class="r"><span>À régler à la commande</span><b>' + eur(s.acompte) + '</b></div>' +
        '<div class="r"><span>Solde à la livraison</span><b>' + eur(s.solde) + '</b></div>' + caution;
  }

  function removeWithUndo(item) {
    if (!item) return;
    undo = { name: item.name, ref: item.ref, qty: item.qty, priceHint: item.priceHint, price: item.price, unit: item.unit, caution: item.caution };
    window.SolCart.remove(item.ref);
    var bar = $('pUndo');
    $('pUndoName').textContent = item.name;
    bar.hidden = false;
    clearTimeout(bar._t);
    bar._t = setTimeout(function () { bar.hidden = true; undo = null; }, 7000);
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  onReady(function () {
    if (!document.getElementById('pList')) return;
    init();
    document.getElementById('pUndoBtn').addEventListener('click', function () {
      if (!undo) return;
      window.SolCart.add(undo);
      undo = null;
      document.getElementById('pUndo').hidden = true;
    });
  });
})();
