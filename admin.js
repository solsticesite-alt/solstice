(function(){
  "use strict";
  var $=function(s,r){return (r||document).querySelector(s);};
  var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');};
  var euros=function(n){return (Number(n)||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';};
  var num=function(v){var n=parseFloat(String(v==null?'':v).replace(',','.'));return isFinite(n)?n:0;};
  function fdate(v){ if(!v) return ''; var d=new Date(v); if(isNaN(d)) return String(v); return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'}); }

  var toastT;
  function toast(msg,bad){ var t=$('#toast'); t.textContent=msg; t.className='toast show'+(bad?' bad':''); clearTimeout(toastT); toastT=setTimeout(function(){t.className='toast';},3200); }

  function api(path,opts){
    opts=opts||{};
    return fetch(path,{method:opts.method||'GET',headers:opts.body?{'Content-Type':'application/json'}:undefined,body:opts.body?JSON.stringify(opts.body):undefined,credentials:'same-origin'})
      .then(function(r){return r.json().catch(function(){return {ok:false,error:'bad_response',status:r.status};}).then(function(j){j.__status=r.status;return j;});});
  }

  var state={me:null,settings:null,list:[],filter:'all',tri:'recu',q:'',current:null,tab:'orders',
             unreadTimer:null,bounces:{}};

  // ---------- Boot ----------
  function boot(){
    api('/api/admin/me').then(function(me){
      state.me=me;
      $('#boot').classList.add('hidden');
      if(!me.authed){ showLogin(); return; }
      majPastilleSecurite();
      showDash();
    }).catch(function(){ $('#boot').textContent='Erreur de connexion au serveur.'; });
  }

  // Rafraichit l'etat renvoye par /me sans repasser par tout le demarrage :
  // le panneau Securite en a besoin apres chaque action.
  function loadMe(){
    return api('/api/admin/me').then(function(me){
      state.me=me; majPastilleSecurite(); return me;
    });
  }

  // Une pastille sur le bouton Securite tant que le second facteur n'est pas
  // en place : c'est la seule protection qui manque encore par defaut.
  function majPastilleSecurite(){
    var p=$('#pastille-2fa'); if(!p) return;
    var s=(state.me&&state.me.securite)||{};
    var c=(state.me&&state.me.config)||{};
    var aFaire = state.me && state.me.authed && (!s.deuxFacteurs || !c.adminPasswordHache);
    p.classList.toggle('hidden', !aFaire);
    p.title = !s.deuxFacteurs ? 'Double authentification non activée' : 'Mot de passe encore en clair';
  }

  function showLogin(){
    if(state.unreadTimer){ clearInterval(state.unreadTimer); state.unreadTimer=null; }
    $('#topbar').classList.add('hidden'); $('#dash').classList.add('hidden'); $('#login').classList.remove('hidden');
    setTimeout(function(){ try{$('#pw').focus();}catch(e){} },50);
  }

  function configBanner(){
    var c=(state.me&&state.me.config)||{}; var miss=[];
    if(!c.store) miss.push('la base de données (variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    if(!c.mail) miss.push("l'envoi d'e-mail (SMTP_HOST / SMTP_USER / SMTP_PASS)");
    if(!c.adminPassword) miss.push('le mot de passe admin (ADMIN_PASSWORD)');
    if(!miss.length) return '';
    return '<div class="banner"><b>Configuration à finir sur Vercel.</b> Il manque : <ul>'+miss.map(function(m){return '<li>'+esc(m)+'</li>';}).join('')+'</ul></div>';
  }

  function showDash(){
    $('#login').classList.add('hidden'); $('#topbar').classList.remove('hidden');
    switchTab(state.tab||'orders');
    loadSettings();
    loadList();
    if(state.unreadTimer){ clearInterval(state.unreadTimer); state.unreadTimer=null; }
    if(state.me&&state.me.config&&state.me.config.imap){ pollUnread(true); state.unreadTimer=setInterval(pollUnread,60000); }
  }

  function switchTab(tab){
    state.tab=tab;
    $('#dash').classList.toggle('hidden',tab!=='orders');
    $('#mailview').classList.toggle('hidden',tab!=='mail');
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'),function(b){
      b.classList.toggle('on',b.getAttribute('data-tab')===tab);
    });
    if(tab==='mail') initMail();
  }

  function loadSettings(){ api('/api/admin/settings').then(function(r){ if(r.ok) state.settings=r.settings; }); }

  function loadList(){
    api('/api/admin/requests').then(function(r){
      if(r.__status===401){ state.me.authed=false; showLogin(); return; }
      if(!r.ok){ $('#reqs').innerHTML='<li class="empty">Erreur : '+esc(r.error||'')+'</li>'; return; }
      state.list=r.items||[]; renderList();
      // Le ménage des données périmées est automatique, mais jamais silencieux.
      if(r.purged>0) toast(r.purged+' demande'+(r.purged>1?'s':'')+' au-delà de la durée de conservation, effacée'+(r.purged>1?'s':''));
      loadBounces();
    });
  }

  /* Une facture qui n'arrive pas revient en rapport de non-remise. Sans ce
     rapprochement, elle ressemblerait a une facture simplement impayee. */
  function loadBounces(){
    if(!(state.me&&state.me.config&&state.me.config.imap)) return;
    api('/api/admin/mail?action=bounces').then(function(r){
      if(!r||!r.ok||!r.items||!r.items.length) return;
      var chgt=false;
      r.items.forEach(function(b){
        if(!b.address) return;
        // On ne garde que le rebond le plus recent par adresse.
        var vu=state.bounces[b.address];
        if(!vu||String(b.date||'')>String(vu.date||'')){ state.bounces[b.address]=b; chgt=true; }
      });
      if(chgt){ renderList(); if(state.current) renderDetail(); }
    }).catch(function(){});
  }

  function bounceFor(email){
    return email?state.bounces[String(email).toLowerCase()]||null:null;
  }

  /* Où en est l'événement par rapport à aujourd'hui ?
     On compare des JOURS, pas des instants : sinon un événement du soir même
     serait annoncé « passé » dès le matin. */
  function delai(dateStr){
    if(!dateStr) return null;
    var d=new Date(dateStr); if(isNaN(d)) return null;
    var jour=function(x){ return Date.UTC(x.getFullYear(),x.getMonth(),x.getDate()); };
    var n=Math.round((jour(d)-jour(new Date()))/86400000);
    if(n<0) return {n:n,classe:'passe',texte:'passé'};
    if(n===0) return {n:0,classe:'proche',texte:"aujourd'hui"};
    if(n===1) return {n:1,classe:'proche',texte:'demain'};
    if(n<=14) return {n:n,classe:'proche',texte:'dans '+n+' jours'};
    if(n<=60) return {n:n,classe:'venir',texte:'dans '+Math.round(n/7)+' semaines'};
    return {n:n,classe:'venir',texte:'dans '+Math.round(n/30.5)+' mois'};
  }

  function renderList(){
    var ul=$('#reqs'); var q=state.q.toLowerCase();
    var items=state.list.filter(function(it){
      if(state.filter==='avenir'){
        var d=delai(it.date);
        if(!d || d.n<0) return false;
      } else if(state.filter!=='all' && it.status!==state.filter) return false;
      if(!q) return true;
      return ((it.clientName||'')+' '+(it.location||'')+' '+(it.ref||'')+' '+(it.eventType||'')).toLowerCase().indexOf(q)>=0;
    });
    /* Tri par date d'événement : le plus proche d'abord, et les dates déjà
       passées rejetées à la fin — leur ordre entre elles reste chronologique
       inverse, la plus récente en tête. Une date illisible ne remonte jamais
       en haut de liste par accident. */
    if(state.tri==='event'){
      items=items.slice().sort(function(a,b){
        var da=delai(a.date), db=delai(b.date);
        if(!da&&!db) return b.id-a.id;
        if(!da) return 1;
        if(!db) return -1;
        var pa=da.n<0, pb=db.n<0;
        if(pa!==pb) return pa?1:-1;
        return pa ? db.n-da.n : da.n-db.n;
      });
    }
    if(!items.length){ ul.innerHTML='<li class="empty">Aucune demande.</li>'; return; }
    ul.innerHTML=items.map(function(it){
      var b=it.status==='replied'?'<span class="badge b-replied">Facturée</span>':(it.status==='new'?'<span class="badge b-new">Nouvelle</span>':'<span class="badge b-read">Lue</span>');
      if(bounceFor(it.clientEmail)) b+=' <span class="badge b-bounce">Non distribué</span>';
      else if(it.notified===false) b+=' <span class="badge b-bounce">Alerte non partie</span>';
      var sub=[it.eventType,fdate(it.date),it.location].filter(Boolean).join(' · ');
      var d=delai(it.date);
      var quand=d?'<span class="req-when '+d.classe+'">'+d.texte+'</span>':'';
      return '<li><button class="req'+(state.current&&state.current.id===it.id?' sel':'')+
        (d&&d.n<0?' est-passe':'')+'" data-id="'+it.id+'">'+
        '<div class="req-top"><span class="req-name">'+esc(it.clientName||'—')+'</span>'+b+'</div>'+
        '<div class="req-sub">'+esc(sub||'—')+'</div>'+
        '<div class="req-ref">'+esc(it.ref||'')+' · '+it.itemCount+' pièce(s)'+
        (quand?' · ':'')+quand+'</div>'+
      '</button></li>';
    }).join('');
    Array.prototype.forEach.call(ul.querySelectorAll('.req'),function(btn){
      btn.addEventListener('click',function(){ openRequest(parseInt(btn.getAttribute('data-id'),10)); });
    });
  }

  function openRequest(id){
    api('/api/admin/request?id='+id).then(function(r){
      if(r.__status===401){ showLogin(); return; }
      if(!r.ok){ toast('Erreur : '+(r.error||''),true); return; }
      state.current=r.request;
      // maj du statut dans la liste locale
      var li=state.list.filter(function(x){return x.id===id;})[0]; if(li&&li.status==='new') li.status='read';
      renderList(); renderDetail();
    });
  }

  function defaultMessage(req){
    var first=(req.client&&req.client.name?String(req.client.name).trim().split(' ')[0]:'')||'';
    var ev=(req.event&&req.event.type)?req.event.type.toLowerCase():'événement';
    var d=(req.event&&req.event.date)?' du '+fdate(req.event.date):'';
    return 'Bonjour'+(first?' '+first:'')+',\n\nMerci pour votre demande. Ravis de pouvoir vous accompagner pour votre '+ev+d+'. Vous trouverez notre proposition détaillée ci-dessous.\n\nNous restons à votre entière disposition,\nMaison Solstice';
  }

  function renderDetail(){
    var req=state.current; if(!req){ $('#detail').innerHTML='<div class="empty">Sélectionnez une demande.</div>'; return; }
    var c=req.client||{}, ev=req.event||{};
    var info=[
      ['Client',esc(c.name||'—')],
      ['E-mail',c.email?'<a href="mailto:'+esc(c.email)+'">'+esc(c.email)+'</a>':'—'],
      ['Téléphone',esc(c.phone||'—')],
      ['Événement',esc(ev.type||'—')],
      ['Date',esc(fdate(ev.date)||'—')],
      ['Lieu',esc(ev.location||'—')],
      ['Invités',esc(ev.guests||'—')]
    ].map(function(kv){return '<div><div class="k">'+kv[0]+'</div><div class="v">'+kv[1]+'</div></div>';}).join('');

    var msg = req.message ? '<div class="section-title">Message</div><blockquote class="blockquote">'+esc(req.message)+'</blockquote>' : '';

    var li = state.list.filter(function(x){ return x.id===req.id; })[0] || {};
    var repliedNote = req.reply ? '<div class="sent-note">✓ Facture déjà envoyée le '+esc(fdate(req.reply.sentAt))+' — total '+euros(req.reply.subtotal)+'. Vous pouvez la renvoyer / modifier ci-dessous.</div>' : '';

    $('#detail').innerHTML=
      '<div class="d-head"><div><h2>'+esc(c.name||'Demande')+'</h2><div class="muted">'+esc(req.ref||'')+' · reçue le '+esc(fdate(req.createdAt))+'</div></div>'+
        (c.email?'<button class="btn btn-sm" id="d-mail">Écrire un e-mail</button>':'')+'</div>'+
      '<div class="info-grid">'+info+'</div>'+ msg +
      bounceNote(c.email) +
      (li&&li.notified===false?'<div class="alert-note"><span><b>L\'alerte de nouvelle commande n\'a pas pu être envoyée.</b> La demande est bien enregistrée — vous la voyez ici — mais aucun e-mail ne vous a prévenu.</span></div>':'')+
      repliedNote +
      (req.payment ? '<div class="sent-note">Règlement choisi par le client : <b>'+(req.payment==='full'?'paiement intégral à la commande':'acompte de 50 %, solde à la livraison')+'</b></div>' : '')+
      '<div class="section-title">Facture à envoyer</div>'+
      '<div class="devis" id="devis"></div>'+
      '<div class="rgpd-zone">'+
        '<button class="btn btn-sm danger" id="d-del">Supprimer cette demande</button>'+
        '<span class="muted">Efface définitivement les données de ce client. À utiliser s\'il exerce son droit à l\'effacement.</span>'+
      '</div>';

    var del=$('#d-del');
    if(del) del.addEventListener('click',function(){ confirmerSuppression(req); });

    var dm=$('#d-mail');
    if(dm) dm.addEventListener('click',function(){ mailWith(c.email); });
    var vb=$('#detail [data-bounce]');
    if(vb) vb.addEventListener('click',function(){
      switchTab('mail');
      Array.prototype.forEach.call(document.querySelectorAll('#mboxes .chip'),function(x){ x.classList.toggle('on',x.getAttribute('data-box')==='inbox'); });
      M.q=''; $('#msearch').value='';
      loadBox('inbox'); openMessage(parseInt(vb.getAttribute('data-bounce'),10));
    });

    renderDevis(req);
  }

  /* Bandeau rouge quand un e-mail a cette adresse est revenu en erreur. */
  function bounceNote(email){
    var b=bounceFor(email); if(!b) return '';
    return '<div class="alert-note"><span><b>Un e-mail à cette adresse n\'est pas arrivé.</b> '+
      'Rapport de non-remise reçu le '+esc(fdate(b.date))+
      (b.reason?' — <i>'+esc(b.reason)+'</i>':'')+
      '. Vérifiez l\'adresse du client avant de renvoyer la facture.</span>'+
      '<button class="btn btn-sm" data-bounce="'+b.uid+'" style="margin-left:auto;">Voir le rapport</button></div>';
  }

  // ------- Composeur de facture -------
  /* Les lignes de la facture, pre-remplies.
     Le prix unitaire vient de ce que le CLIENT A VU au moment de sa demande :
     le serveur l'a retrouve dans le catalogue et conserve avec la commande.
     Auparavant l'unite repartait vide, il fallait tout retaper — et rien ne
     garantissait que la facture corresponde a ce qui avait ete affiche. */
  function buildInitialLines(req){
    if(req.reply&&req.reply.lines&&req.reply.lines.length){
      return req.reply.lines.map(function(l){return {label:l.label,qty:l.qty,unit:l.unit};});
    }
    if(req.items&&req.items.length){
      return req.items.map(function(it){
        return {
          label:it.name,
          qty:it.qty||1,
          // Une piece encore non chiffree au catalogue reste a saisir a la main.
          unit: typeof it.price==='number' ? it.price : ''
        };
      });
    }
    return [{label:'',qty:1,unit:''}];
  }

  function renderDevis(req){
    var lines=buildInitialLines(req);
    var st=state.settings||{};
    var choixClient = req.payment==='full' ? 100 : null;
    var deposit = req.reply&&req.reply.depositPct!=null ? req.reply.depositPct
      : (choixClient!=null ? choixClient : (st.depositPct!=null?st.depositPct:50));
    var message = req.reply&&req.reply.message ? req.reply.message : defaultMessage(req);
    var notes = req.reply&&req.reply.notes ? req.reply.notes : '';

    var host=$('#devis');
    host.innerHTML=
      '<table class="lines"><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">P.U. HT</th><th class="num">Total</th><th></th></tr></thead><tbody id="lines-body"></tbody></table>'+
      '<button class="btn btn-sm" id="add-line" style="margin-top:8px;">+ Ajouter une ligne</button>'+
      '<div class="tots" id="tots"></div>'+
      '<div class="field"><label>Message au client</label><textarea id="d-msg" rows="5"></textarea></div>'+
      '<div class="row2">'+
        '<div><label>Note sur la facture (optionnel)</label><input id="d-notes" placeholder="Livraison incluse, etc."></div>'+
        '<div><label>Acompte à la commande (%)</label><input id="d-deposit" class="num" type="number" min="0" max="100" step="1"></div>'+
      '</div>'+
      '<div class="devis-actions"><button class="btn btn-gold" id="send-devis">Envoyer la facture (PDF + e-mail)</button>'+
        '<span class="muted" id="send-hint"></span></div>';

    $('#d-msg').value=message; $('#d-notes').value=notes; $('#d-deposit').value=deposit;

    var body=$('#lines-body');
    function rowHtml(l,i){
      return '<tr data-i="'+i+'">'+
        '<td class="cell-label"><input class="l-label" value="'+esc(l.label)+'" placeholder="Désignation"></td>'+
        '<td class="cell-qty"><input class="l-qty num" type="number" min="0" step="1" value="'+esc(l.qty)+'"></td>'+
        '<td class="cell-unit"><input class="l-unit num" type="number" min="0" step="0.5" value="'+esc(l.unit)+'" placeholder="0"></td>'+
        '<td class="cell-tot" data-tot>—</td>'+
        '<td class="cell-x"><button class="lx" title="Retirer">×</button></td>'+
      '</tr>';
    }
    function draw(){ body.innerHTML=lines.map(rowHtml).join(''); wire(); recalc(); }
    function readLines(){
      lines=Array.prototype.map.call(body.querySelectorAll('tr'),function(tr){
        return {label:$('.l-label',tr).value,qty:num($('.l-qty',tr).value),unit:num($('.l-unit',tr).value)};
      });
    }
    function recalc(){
      var sub=0;
      Array.prototype.forEach.call(body.querySelectorAll('tr'),function(tr){
        var q=num($('.l-qty',tr).value), u=num($('.l-unit',tr).value), t=Math.round(q*u*100)/100;
        $('[data-tot]',tr).textContent=euros(t); sub+=t;
      });
      sub=Math.round(sub*100)/100;
      var dp=Math.max(0,Math.min(100,num($('#d-deposit').value)));
      var dep=Math.round(sub*dp/100*100)/100;
      $('#tots').innerHTML='<div>Sous-total HT : <b>'+euros(sub)+'</b></div>'+
        '<div class="muted">TVA : non applicable</div>'+
        '<div class="big">Total : '+euros(sub)+'</div>'+
        (dp>0?'<div class="muted">Acompte '+dp+'% à la commande : <b>'+euros(dep)+'</b></div>'+
             '<div class="muted">Solde '+(100-dp)+'% à la livraison : '+euros(Math.round((sub-dep)*100)/100)+'</div>':'');
    }
    function wire(){
      Array.prototype.forEach.call(body.querySelectorAll('input'),function(inp){ inp.addEventListener('input',recalc); });
      Array.prototype.forEach.call(body.querySelectorAll('.lx'),function(b){ b.addEventListener('click',function(){ readLines(); var i=parseInt(b.closest('tr').getAttribute('data-i'),10); lines.splice(i,1); if(!lines.length) lines=[{label:'',qty:1,unit:''}]; draw(); }); });
    }
    $('#add-line').addEventListener('click',function(){ readLines(); lines.push({label:'',qty:1,unit:''}); draw(); });
    $('#d-deposit').addEventListener('input',recalc);
    $('#send-devis').addEventListener('click',function(){ readLines(); sendDevis(req,lines); });
    draw();
  }

  function sendDevis(req,lines){
    var valid=lines.filter(function(l){return String(l.label).trim();});
    if(!valid.length){ toast('Ajoutez au moins une ligne à la facture.',true); return; }
    var btn=$('#send-devis'); btn.disabled=true; $('#send-hint').textContent='Envoi en cours…';
    api('/api/admin/reply',{method:'POST',body:{
      id:req.id, message:$('#d-msg').value, notes:$('#d-notes').value,
      depositPct:num($('#d-deposit').value), lines:valid
    }}).then(function(r){
      // Le volet a pu être remplacé pendant l'envoi : accès conditionnels.
      var b2=$('#send-devis'); if(b2) b2.disabled=false;
      var h2=$('#send-hint'); if(h2) h2.textContent='';
      if(r.__status===401){ showLogin(); return; }
      if(!r.ok){ toast('Échec de l\'envoi : '+(r.detail||r.error||''),true); return; }
      toast('Facture envoyée à '+(req.client&&req.client.email||'')+' ✓');
      openRequest(req.id); loadList();
    }).catch(function(){
      var b3=$('#send-devis'); if(b3) b3.disabled=false;
      var h3=$('#send-hint'); if(h3) h3.textContent='';
      toast('Erreur réseau.',true);
    });
  }

  // =====================================================================
  //  Messagerie — branchée sur la boîte du domaine, en IMAP.
  // =====================================================================
  var M={box:'inbox',items:[],nextSeq:0,total:0,sel:0,msg:null,q:'',
         reqId:0,images:false,unread:0,msgs:{},msgOrder:[],booted:false,
         composing:null,sending:false,prefetching:{},hoverT:null};
  var CACHE_MAX=20;

  /* Les corps de messages, images incorporées comprises, peuvent peser lourd :
     le cache garde les plus récents et laisse partir les autres. */
  function cachePut(k,msg){
    if(!M.msgs[k]) M.msgOrder.push(k);
    M.msgs[k]=msg;
    while(M.msgOrder.length>CACHE_MAX){ delete M.msgs[M.msgOrder.shift()]; }
  }
  function cacheClear(){ M.msgs={}; M.msgOrder=[]; }

  function mapi(qs,opts){ return api('/api/admin/mail'+(qs?'?'+qs:''),opts); }

  function mdate(iso){
    if(!iso) return '';
    var d=new Date(iso); if(isNaN(d.getTime())) return '';
    var now=new Date();
    if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    if(d.getFullYear()===now.getFullYear()) return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
    return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
  }
  function fdatetime(iso){
    if(!iso) return '';
    var d=new Date(iso); if(isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  }
  function who(a){ return a?(a.name||a.address||'—'):'—'; }
  function whoFull(a){ return a?((a.name?a.name+' ':'')+'<'+(a.address||'')+'>'):'—'; }
  function poids(n){ n=Number(n)||0; return n<1024?n+' o':(n<1048576?Math.round(n/1024)+' Ko':(n/1048576).toFixed(1)+' Mo'); }

  function initMail(){
    if(M.booted) return;
    if(!(state.me&&state.me.config&&state.me.config.imap)){
      $('#mail-banner').innerHTML='<div class="banner"><b>Messagerie non configurée.</b> Ajoutez les variables <code>SMTP_HOST</code>, <code>SMTP_USER</code> et <code>SMTP_PASS</code> dans Vercel : la lecture de la boîte utilise les mêmes identifiants que l\'envoi.</div>';
      $('#mlist').innerHTML=''; $('#mdetail').innerHTML='<div class="empty">Messagerie non configurée.</div>';
      M.booted=true; return;
    }
    M.booted=true; loadBox('inbox');
  }

  function skeleton(){
    var one='<li class="skel-row"><div class="skel" style="width:45%"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:60%"></div></li>';
    $('#mlist').innerHTML=new Array(7).join(one)+one;
  }

  /* Un jeton de séquence remplace le verrou : un changement de dossier n'est
     jamais ignoré, c'est la réponse devenue obsolète qu'on écarte. */
  function loadBox(box,more){
    var mine=++M.reqId;
    if(!more){ M.box=box; M.items=[]; M.sel=0; M.msg=null; renderMailDetail(); skeleton(); }
    var qs='action='+(M.q?'search':'list')+'&box='+encodeURIComponent(M.box)+'&limit=40';
    if(M.q) qs+='&q='+encodeURIComponent(M.q);
    else if(more&&M.nextSeq) qs+='&beforeSeq='+M.nextSeq;
    mapi(qs).then(function(r){
      if(mine!==M.reqId) return;
      if(r.__status===401){ showLogin(); return; }
      if(!r.ok){ $('#mlist').innerHTML='<li class="empty">'+esc(mailError(r))+'</li>'; return; }
      M.items=more?M.items.concat(r.items||[]):(r.items||[]);
      M.nextSeq=r.nextSeq||0; M.total=r.total||0;
      renderMailList();
    }).catch(function(){ if(mine===M.reqId) $('#mlist').innerHTML='<li class="empty">Erreur réseau.</li>'; });
  }

  function mailError(r){
    if(r.error==='imap_not_configured') return 'Messagerie non configurée.';
    if(r.error==='not_found') return 'Ce dossier n\'existe pas sur le serveur.';
    if(r.error==='too_large') return 'Les pièces jointes dépassent la taille autorisée (3 Mo au total).';
    if(r.error==='imap_auth_failed') return 'Identifiants refusés par le serveur de messagerie.';
    return 'Erreur : '+(r.detail||r.error||'inconnue');
  }

  function renderMailList(){
    var ul=$('#mlist');
    if(!M.items.length){ ul.innerHTML='<li class="empty">'+(M.q?'Aucun message trouvé.':'Aucun message.')+'</li>'; return; }
    var html=M.items.map(function(m){
      var marks='<span class="m-marks">'+(m.seen?'':'<span class="m-dot" title="Non lu"></span>')+
        (m.flagged?'<span class="m-star on">★</span>':'')+(m.attachments?'<span class="m-clip" title="Pièce jointe">📎</span>':'')+'</span>';
      return '<li><button class="mrow'+(m.seen?'':' unseen')+(M.sel===m.uid?' sel':'')+'" data-uid="'+m.uid+'">'+
        '<div class="m-top"><span class="m-from">'+marks+esc(who(M.box==='sent'?(m.to&&m.to[0]):m.from))+'</span><span class="m-date">'+esc(mdate(m.date))+'</span></div>'+
        '<div class="m-subj">'+esc(m.subject||'(sans objet)')+'</div>'+
        (m.preview?'<div class="m-prev">'+esc(m.preview)+'</div>':'')+
      '</button></li>';
    }).join('');
    if(!M.q&&M.nextSeq) html+='<li class="more-row"><button class="btn btn-sm" id="mmore">Charger les messages plus anciens</button></li>';
    else if(M.total>M.items.length) html+='<li class="more-row"><span class="muted" style="font-size:.78rem;">'+M.items.length+' sur '+M.total+' messages</span></li>';
    ul.innerHTML=html;
    Array.prototype.forEach.call(ul.querySelectorAll('.mrow'),function(b){
      var uid=parseInt(b.getAttribute('data-uid'),10);
      b.addEventListener('click',function(){ openMessage(uid); });
      // Pré-chargement au survol : le message est souvent déjà là au clic.
      b.addEventListener('mouseenter',function(){ hoverPrefetch(uid); });
      b.addEventListener('mouseleave',function(){ clearTimeout(M.hoverT); });
    });
    var more=$('#mmore'); if(more) more.addEventListener('click',function(){ loadBox(M.box,true); });
  }

  function cacheKey(uid){ return M.box+':'+uid; }

  /* Pré-chargement au survol : seulement après une intention réelle (un quart
     de seconde d'arrêt), un seul à la fois, et jamais marqué comme lu. */
  function hoverPrefetch(uid){
    clearTimeout(M.hoverT);
    M.hoverT=setTimeout(function(){ prefetch(uid); },250);
  }
  function prefetch(uid){
    var k=cacheKey(uid);
    if(M.msgs[k]||M.prefetching[k]) return;
    var enCours=0; for(var x in M.prefetching) if(M.prefetching[x]) enCours++;
    if(enCours>=1) return;
    M.prefetching[k]=true;
    mapi('action=message&peek=1&box='+encodeURIComponent(M.box)+'&uid='+uid).then(function(r){
      delete M.prefetching[k];
      if(r&&r.ok) cachePut(k,r.message);
    }).catch(function(){ delete M.prefetching[k]; });
  }

  function openMessage(uid){
    M.sel=uid; M.images=false;
    var row=M.items.filter(function(x){return x.uid===uid;})[0];
    var etaitNonLu=row&&!row.seen;
    // La pastille ne compte que la Réception : ne la toucher qu'ici.
    if(etaitNonLu){ row.seen=true; if(M.box==='inbox'&&M.unread>0) setUnread(M.unread-1); }
    renderMailList();
    $('#mail-grid').classList.add('reading');
    var k=cacheKey(uid);
    if(M.msgs[k]){
      M.msg=M.msgs[k]; renderMailDetail();
      // Servi depuis le cache : c'est au navigateur de poser le drapeau, sans
      // quoi le message ressortirait non lu au prochain rafraîchissement.
      if(etaitNonLu&&M.box==='inbox') mapi('',{method:'POST',body:{action:'seen',box:M.box,uid:uid,value:true}});
      return;
    }
    M.msg=null;
    $('#mdetail').innerHTML=backBtn()+'<div class="skel-row"><div class="skel" style="width:60%;height:16px"></div><div class="skel" style="width:40%"></div><div class="skel" style="width:100%;height:140px;margin-top:14px"></div></div>';
    wireBack();
    mapi('action=message&box='+encodeURIComponent(M.box)+'&uid='+uid).then(function(r){
      if(M.sel!==uid) return;
      if(r.__status===401){ showLogin(); return; }
      if(!r.ok){ echecLecture(uid,mailError(r)); return; }
      cachePut(k,r.message);
      M.msg=r.message; renderMailDetail();
    }).catch(function(){ if(M.sel===uid) echecLecture(uid,'Erreur réseau.'); });
  }

  /* Un échec de lecture doit toujours laisser une porte de sortie : sur mobile
     la liste est masquée, sans bouton on resterait coincé. */
  function echecLecture(uid,msg){
    $('#mdetail').innerHTML=backBtn()+'<div class="empty">'+esc(msg)+
      '<div style="margin-top:12px;"><button class="btn btn-sm" id="mretry">Réessayer</button></div></div>';
    wireBack();
    var r=$('#mretry'); if(r) r.addEventListener('click',function(){ delete M.msgs[cacheKey(uid)]; openMessage(uid); });
  }

  function backBtn(){ return '<button class="btn btn-sm hidden-desk" id="mback" style="margin-bottom:12px;">← Retour à la liste</button>'; }
  function wireBack(){ var b=$('#mback'); if(b) b.addEventListener('click',function(){ $('#mail-grid').classList.remove('reading'); }); }

  /* Le corps du message s'affiche dans une iframe cloisonnée : sans script,
     sans accès à cette page, et sans pouvoir aller chercher quoi que ce soit
     sur le réseau tant que les images ne sont pas autorisées. */
  function viewerDoc(html,images){
    var csp="default-src 'none'; img-src data:"+(images?" https: http:":"")+"; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";
    var body=images?String(html).replace(/data-osrc=/g,'src='):html;
    return '<!doctype html><html><head><meta charset="utf-8">'+
      '<meta http-equiv="Content-Security-Policy" content="'+csp+'">'+
      '<style>html,body{margin:0;padding:14px 16px;}'+
      'body{font:15px/1.6 -apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#221C15;word-wrap:break-word;overflow-wrap:break-word;}'+
      'img{max-width:100%;height:auto;}table{max-width:100%;}'+
      'a{color:#8C6C3D;}blockquote.q{margin:.4em 0;padding-left:.9em;border-left:2px solid #E6DCCB;color:#6F6455;}'+
      'pre{white-space:pre-wrap;}</style></head><body>'+body+'</body></html>';
  }

  function fitFrame(fr){
    try{
      var d=fr.contentDocument; if(!d||!d.body) return;
      var h=Math.max(d.body.scrollHeight,d.documentElement.scrollHeight);
      fr.style.height=Math.min(4000,Math.max(160,h+24))+'px';
    }catch(e){ /* rien de grave : la hauteur par défaut s'applique */ }
  }

  function renderMailDetail(){
    var host=$('#mdetail');
    if(!M.msg){ if(!M.sel) host.innerHTML='<div class="empty">Sélectionnez un message.</div>'; return; }
    var m=M.msg;
    var linked=findRequestFor(m.from&&m.from.address);
    var atts=(m.attachments||[]).map(function(a){
      return '<a class="att" href="/api/admin/mail?action=attachment&box='+encodeURIComponent(m.box)+'&uid='+m.uid+'&index='+a.index+'" download>'+
        '📎 '+esc(a.filename)+' <span class="sz">'+poids(a.size)+'</span></a>';
    }).join('');

    host.innerHTML=
      backBtn()+
      '<div class="mh-top">'+
        '<div style="min-width:0;"><div class="mh-subject">'+esc(m.subject||'(sans objet)')+'</div>'+
          '<div class="mh-meta"><b>'+esc(whoFull(m.from))+'</b><br>à '+esc((m.to||[]).map(whoFull).join(', ')||'—')+
          ((m.cc&&m.cc.length)?'<br>copie : '+esc(m.cc.map(whoFull).join(', ')):'')+
          '<br>'+esc(fdatetime(m.date))+'</div></div>'+
        '<div class="mh-actions">'+
          '<button class="btn btn-sm btn-gold" id="mreply">Répondre</button>'+
          '<button class="btn btn-sm" id="munseen">Marquer non lu</button>'+
          '<button class="btn btn-sm" id="mstar">★</button>'+
          (M.box!=='trash'?'<button class="btn btn-sm" id="mtrash">Supprimer</button>':'')+
        '</div>'+
      '</div>'+
      (linked?'<div class="linkreq">Commande <b>'+esc(linked.ref||'')+'</b> de ce client'+
        '<button class="btn btn-sm" id="mgoreq" style="margin-left:auto;">Ouvrir la facture</button></div>':'')+
      (m.blockedImages?'<div class="mbody"><div class="imgbar"><span>'+m.blockedImages+' image(s) distante(s) bloquée(s) — elles signalent la lecture à l\'expéditeur.</span><button class="btn btn-sm" id="mimg">Afficher les images</button></div><iframe id="mframe" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>'
        :'<div class="mbody"><iframe id="mframe" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe></div>')+
      (atts?'<div class="atts">'+atts+'</div>':'')+
      '<div id="thread-slot"></div>'+
      '<div id="compose-slot"></div>';

    var fr=$('#mframe');
    fr.addEventListener('load',function(){ fitFrame(fr); setTimeout(function(){fitFrame(fr);},300); setTimeout(function(){fitFrame(fr);},1200); });
    fr.srcdoc=viewerDoc(m.body||'',M.images);

    wireBack();
    $('#mreply').addEventListener('click',function(){ openCompose('reply'); });
    $('#munseen').addEventListener('click',function(){ markSeen(m.uid,false); });
    $('#mstar').addEventListener('click',function(){ toggleStar(m.uid); });
    var tr=$('#mtrash'); if(tr) tr.addEventListener('click',function(){ trash(m.uid); });
    var im=$('#mimg'); if(im) im.addEventListener('click',function(){ M.images=true; fr.srcdoc=viewerDoc(m.body||'',true); im.parentNode.style.display='none'; });
    if(M.autoReply){ var dest=M.autoReply; M.autoReply=null; openCompose('reply',dest); }
    else if(M.composing&&M.composing.uid===m.uid) openCompose(M.composing.mode);
    loadThread(m);
    var go=$('#mgoreq'); if(go) go.addEventListener('click',function(){ switchTab('orders'); openRequest(linked.id); });
  }

  /* Le fil complet : les réponses qu'on a envoyées vivent dans « Envoyés »,
     elles n'apparaîtraient jamais sous le message reçu sans cette requête. */
  function loadThread(m){
    var pour=m.box+':'+m.uid;
    mapi('action=thread&box='+encodeURIComponent(m.box)+'&uid='+m.uid).then(function(r){
      if(!M.msg||(M.msg.box+':'+M.msg.uid)!==pour) return;   // on a change de message
      if(!r||!r.ok||!r.items) return;
      renderThread(r.items,m);
    }).catch(function(){});
  }

  function renderThread(items,m){
    var slot=$('#thread-slot'); if(!slot) return;
    var autres=items.filter(function(it){ return !(it.box===m.box&&it.uid===m.uid); });
    if(!autres.length){ slot.innerHTML=''; return; }
    slot.innerHTML='<div class="thread"><div class="thread-h">Conversation — '+items.length+' message'+(items.length>1?'s':'')+'</div>'+
      items.map(function(it){
        var courant=(it.box===m.box&&it.uid===m.uid);
        var qui=it.outgoing?'Vous':who(it.from);
        return '<div class="tmsg'+(it.outgoing?' out':'')+(courant?' cur':'')+'" data-box="'+esc(it.box)+'" data-uid="'+it.uid+'">'+
          '<button class="tmsg-head" type="button"'+(courant?' disabled':'')+'>'+
            '<span class="tmsg-who">'+esc(qui)+'</span>'+
            (courant?'<span class="tag">affiché</span>':'')+
            '<span class="tmsg-prev">'+esc(it.preview||it.subject||'')+'</span>'+
            '<span class="tmsg-date">'+esc(mdate(it.date))+'</span>'+
          '</button><div class="tmsg-body hidden"></div></div>';
      }).join('')+'</div>';

    Array.prototype.forEach.call(slot.querySelectorAll('.tmsg-head'),function(btn){
      if(btn.disabled) return;
      btn.addEventListener('click',function(){ toggleThreadMsg(btn.parentNode); });
    });
  }

  function toggleThreadMsg(card){
    var body=card.querySelector('.tmsg-body');
    if(!body.classList.contains('hidden')){ body.classList.add('hidden'); return; }
    body.classList.remove('hidden');
    if(body.getAttribute('data-loaded')) return;
    body.setAttribute('data-loaded','1');
    body.innerHTML='<div class="skel-row"><div class="skel" style="width:70%"></div><div class="skel" style="width:90%"></div></div>';
    var box=card.getAttribute('data-box'), uid=parseInt(card.getAttribute('data-uid'),10);
    // « peek » : consulter le fil ne doit rien marquer comme lu.
    mapi('action=message&peek=1&box='+encodeURIComponent(box)+'&uid='+uid).then(function(r){
      if(!r||!r.ok){ body.innerHTML='<div class="empty">'+esc(mailError(r||{}))+'</div>'; body.removeAttribute('data-loaded'); return; }
      body.innerHTML='<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>';
      var fr=body.querySelector('iframe');
      fr.addEventListener('load',function(){ fitFrame(fr); setTimeout(function(){fitFrame(fr);},300); });
      fr.srcdoc=viewerDoc(r.message.body||'',false);
    }).catch(function(){ body.innerHTML='<div class="empty">Erreur réseau.</div>'; body.removeAttribute('data-loaded'); });
  }

  /* Depuis une commande : reprendre l'échange s'il existe, l'ouvrir sinon. */
  function mailWith(address){
    if(!address) return;
    if(!(state.me&&state.me.config&&state.me.config.imap)){ location.href='mailto:'+address; return; }
    switchTab('mail');
    mapi('action=find&address='+encodeURIComponent(address)).then(function(r){
      if(r&&r.ok&&r.found){
        var box=r.box||'inbox';
        Array.prototype.forEach.call(document.querySelectorAll('#mboxes .chip'),function(x){
          x.classList.toggle('on',x.getAttribute('data-box')===box);
        });
        M.q=''; $('#msearch').value='';
        M.autoReply=address;
        loadBox(box);
        openMessage(r.uid);
      } else {
        newMessage(address);
      }
    }).catch(function(){ newMessage(address); });
  }

  /* Rapproche un e-mail d'une commande, par l'adresse du client. */
  function findRequestFor(address){
    if(!address) return null;
    var a=String(address).toLowerCase();
    return state.list.filter(function(r){ return r.clientEmail&&r.clientEmail===a; })[0]||null;
  }

  function markSeen(uid,seen){
    mapi('',{method:'POST',body:{action:'seen',box:M.box,uid:uid,value:seen}}).then(function(r){
      if(!r.ok){ toast(mailError(r),true); return; }
      var row=M.items.filter(function(x){return x.uid===uid;})[0];
      if(row){ row.seen=seen; renderMailList(); }
      if(M.box==='inbox') setUnread(M.unread+(seen?-1:1));
      if(!seen){ M.sel=0; M.msg=null; $('#mail-grid').classList.remove('reading'); $('#mdetail').innerHTML='<div class="empty">Message marqué non lu.</div>'; }
    });
  }

  function toggleStar(uid){
    var row=M.items.filter(function(x){return x.uid===uid;})[0]; if(!row) return;
    var next=!row.flagged;
    row.flagged=next; renderMailList();
    mapi('',{method:'POST',body:{action:'flag',box:M.box,uid:uid,value:next}}).then(function(r){
      if(!r.ok){ row.flagged=!next; renderMailList(); toast(mailError(r),true); }
    });
  }

  function trash(uid){
    mapi('',{method:'POST',body:{action:'trash',box:M.box,uid:uid}}).then(function(r){
      if(!r.ok){ toast(mailError(r),true); return; }
      M.items=M.items.filter(function(x){return x.uid!==uid;});
      delete M.msgs[cacheKey(uid)];
      M.sel=0; M.msg=null; $('#mail-grid').classList.remove('reading');
      renderMailList(); renderMailDetail();
      toast('Message déplacé à la corbeille ✓');
    });
  }

  function quoted(m){
    var head='\n\nLe '+fdatetime(m.date)+', '+who(m.from)+' a écrit :\n';
    var src=(m.text||'').replace(/\r\n/g,'\n');
    if(!src&&m.body) src=String(m.body).replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'');
    return head+src.split('\n').map(function(l){return '> '+l;}).join('\n');
  }

  /* Message neuf : le volet de lecture devient une feuille blanche. */
  function newMessage(prefillTo){
    M.sel=0; M.msg=null;
    $('#mail-grid').classList.add('reading');
    Array.prototype.forEach.call(document.querySelectorAll('#mlist .mrow'),function(b){b.classList.remove('sel');});
    $('#mdetail').innerHTML=
      backBtn()+'<div class="mh-subject">Nouveau message</div><div id="compose-slot"></div>';
    wireBack();
    openCompose('new',prefillTo);
  }

  function openCompose(mode,prefillTo){
    var m=M.msg;
    var to=prefillTo||(mode==='reply'?((m&&m.from&&m.from.address)||''):'');
    var subject=mode==='reply'?(/^re\s*:/i.test(m.subject||'')?m.subject:'Re : '+(m.subject||'')):'';
    var sig='\n\n-- \n'+(((state.settings&&state.settings.signature)||'Maison Solstice').trim())+'\n';
    var text=mode==='reply'?sig+quoted(m):sig;
    // Un brouillon deja commence sur ce meme message est repris tel quel.
    var repris=M.composing&&M.composing.uid===M.sel&&M.composing.mode===mode;
    if(repris){ to=M.composing.to; subject=M.composing.subject; text=M.composing.text; }
    else M.composing={mode:mode,uid:M.sel,to:to,subject:subject,text:text,
      inReplyTo:(mode==='reply'&&m)?(m.messageId||''):'',
      references:(mode==='reply'&&m)?[].concat(m.references||[],[m.messageId||'']).filter(Boolean):[]};

    $('#compose-slot').innerHTML=
      '<div class="compose">'+
        '<div class="to"><label for="c-to">À</label><input id="c-to" value="'+esc(to)+'" placeholder="adresse@exemple.fr"></div>'+
        '<div class="to"><label for="c-subj">Objet</label><input id="c-subj" value="'+esc(subject)+'"></div>'+
        '<textarea id="c-text"></textarea>'+
        '<div class="c-files" id="c-files"></div>'+
        '<div class="compose-actions">'+
          '<button class="btn btn-gold" id="c-send">Envoyer</button>'+
          '<label class="btn" for="c-file" style="margin:0;">📎 Joindre un fichier</label>'+
          '<input type="file" id="c-file" multiple hidden>'+
          '<button class="btn" id="c-cancel">Annuler</button><span class="muted" id="c-hint"></span></div>'+
      '</div>';
    var ta=$('#c-text'); ta.value=text; ta.focus(); ta.setSelectionRange(0,0);
    // Chaque frappe est recopiee dans l'etat : un rafraichissement de la vue
    // ne peut plus emporter le brouillon.
    ['c-to','c-subj','c-text'].forEach(function(id){
      var el=document.getElementById(id);
      el.addEventListener('input',function(){
        if(!M.composing) return;
        M.composing.to=$('#c-to').value; M.composing.subject=$('#c-subj').value; M.composing.text=$('#c-text').value;
      });
    });
    if(!M.composing.files) M.composing.files=[];
    renderFiles();
    $('#c-file').addEventListener('change',function(e){ addFiles(e.target.files); e.target.value=''; });
    $('#c-cancel').addEventListener('click',function(){
      if(($('#c-text').value||'').trim()&&!confirm('Abandonner ce message ?')) return;
      $('#compose-slot').innerHTML=''; M.composing=null;
    });
    $('#c-send').addEventListener('click',sendMailNow);
    $('#compose-slot').scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  /* Les fichiers voyagent en base64 dans le corps de la requête : la
     plateforme plafonne celui-ci, d'où la limite annoncée à l'utilisateur. */
  var MAX_PIECES=3*1024*1024;

  function addFiles(liste){
    if(!M.composing) return;
    var restants=Array.prototype.slice.call(liste||[]);
    (function suivant(){
      if(!restants.length){ renderFiles(); return; }
      var f=restants.shift();
      var deja=M.composing.files.reduce(function(n,x){return n+x.size;},0);
      if(deja+f.size>MAX_PIECES){ toast('« '+f.name+' » dépasse la limite de 3 Mo au total.',true); suivant(); return; }
      var fr=new FileReader();
      fr.onload=function(){
        var b64=String(fr.result||'').split(',')[1]||'';
        M.composing.files.push({filename:f.name,contentType:f.type||'application/octet-stream',size:f.size,content:b64});
        suivant();
      };
      fr.onerror=function(){ toast('Impossible de lire « '+f.name+' ».',true); suivant(); };
      fr.readAsDataURL(f);
    })();
  }

  function renderFiles(){
    var host=$('#c-files'); if(!host||!M.composing) return;
    var fs=M.composing.files||[];
    host.innerHTML=fs.map(function(f,i){
      return '<span class="c-file">📎 '+esc(f.filename)+' <span class="sz">'+poids(f.size)+'</span>'+
        '<button type="button" data-i="'+i+'" title="Retirer">×</button></span>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('button'),function(b){
      b.addEventListener('click',function(){
        M.composing.files.splice(parseInt(b.getAttribute('data-i'),10),1); renderFiles();
      });
    });
  }

  /* Le composeur peut disparaître pendant l'envoi (clic sur un autre message) :
     tous les accès au DOM sont donc conditionnels, et le résultat est annoncé
     par un toast, qui lui survit à tout. */
  function setHint(t){ var h=$('#c-hint'); if(h) h.textContent=t; }
  function sendBtn(on){ var b=$('#c-send'); if(b) b.disabled=!on; }

  function sendMailNow(){
    if(M.sending) return;
    var to=$('#c-to').value.trim(), subject=$('#c-subj').value.trim(), text=$('#c-text').value;
    if(!to){ toast('Indiquez au moins un destinataire.',true); return; }
    if(!text.trim()){ toast('Le message est vide.',true); return; }
    M.sending=true; sendBtn(false); setHint('Envoi en cours…');
    var c=M.composing||{};
    mapi('',{method:'POST',body:{action:'send',to:to,subject:subject,text:text,
      inReplyTo:c.inReplyTo,references:c.references,box:M.box,uid:c.uid||M.sel,
      attachments:(c.files||[]).map(function(f){return {filename:f.filename,contentType:f.contentType,content:f.content};})
    }}).then(function(r){
      M.sending=false; sendBtn(true); setHint('');
      if(r.__status===401){ showLogin(); return; }
      if(!r.ok){ toast(mailError(r),true); return; }
      M.composing=null;
      var slot=$('#compose-slot'); if(slot) slot.innerHTML='';
      var row=M.items.filter(function(x){return x.uid===(c.uid||M.sel);})[0];
      if(row){ row.answered=true; renderMailList(); }
      toast('Message envoyé ✓'+(r.archived?'':' (non classé dans « Envoyés »)'));
    }).catch(function(){ M.sending=false; sendBtn(true); setHint(''); toast('Erreur réseau.',true); });
  }

  function setUnread(n){
    M.unread=Math.max(0,n|0);
    var p=$('#unread-pill');
    p.textContent=M.unread; p.classList.toggle('hidden',M.unread===0);
  }

  function pollUnread(force){
    if(document.hidden&&!force) return;
    mapi('action=unread').then(function(r){
      if(!r||!r.ok) return;
      var before=M.unread;
      setUnread(r.unread);
      // Un message vient d'arriver pendant qu'on regarde la boîte : on rafraîchit.
      // Jamais pendant une rédaction : le rafraîchissement réécrirait la vue.
      if(r.unread>before && state.tab==='mail' && !M.q && M.box==='inbox' && !M.composing) loadBox('inbox');
    }).catch(function(){});
  }

  /* ---------- Effacement d'une demande (droit à l'effacement) ----------
     Irréversible et sans corbeille : on demande donc de recopier la référence,
     et on dit franchement ce que la suppression NE couvre pas. */
  function confirmerSuppression(req){
    var ref=req.ref||String(req.id);
    var c=req.client||{};
    var bg=document.createElement('div'); bg.className='modal-bg';
    bg.innerHTML='<div class="modal"><h2>Supprimer la demande '+esc(ref)+'&nbsp;?</h2>'+
      '<div class="avert"><b>Cette suppression est définitive.</b> Toutes les données de '+
        esc(c.name||'ce client')+(c.email?' ('+esc(c.email)+')':'')+
        ' disparaissent de la base : coordonnées, événement, sélection'+
        (req.reply?', et la facture déjà envoyée':'')+'. Il n\'y a pas de corbeille.</div>'+
      (req.reply
        ? '<div class="avert"><b>Attention : une facture a été émise pour cette demande.</b> '+
          'Les pièces comptables doivent être conservées 10 ans (obligation légale). '+
          'Le droit à l\'effacement ne prime pas sur cette obligation : ne supprimez que si vous êtes sûr·e.</div>'
        : '')+
      '<p class="muted" style="font-size:.84rem;line-height:1.5;">Les e-mails échangés avec ce client restent dans votre boîte '+
        '<b>contact@maison-solstice.fr</b>. Pour un effacement complet, supprimez-les aussi depuis l\'onglet Messages ou le webmail.</p>'+
      '<div class="field"><label>Recopiez <b>'+esc(ref)+'</b> pour confirmer</label>'+
        '<input id="del-ref" autocomplete="off" placeholder="'+esc(ref)+'"></div>'+
      '<div class="devis-actions"><button class="btn btn-sm danger" id="del-go" disabled>Supprimer définitivement</button>'+
        '<button class="btn btn-sm" id="del-no">Annuler</button>'+
        '<span class="muted" id="del-hint"></span></div></div>';
    document.body.appendChild(bg);

    var champ=bg.querySelector('#del-ref');
    var go=bg.querySelector('#del-go');
    var fermer=function(){ bg.remove(); };
    champ.addEventListener('input',function(){ go.disabled = champ.value.trim()!==ref; });
    bg.querySelector('#del-no').addEventListener('click',fermer);
    bg.addEventListener('click',function(e){ if(e.target===bg) fermer(); });
    champ.focus();

    go.addEventListener('click',function(){
      if(go.disabled) return;
      go.disabled=true; bg.querySelector('#del-hint').textContent='Suppression…';
      api('/api/admin/request?id='+encodeURIComponent(req.id),{method:'DELETE'}).then(function(r){
        if(!r||!r.ok){
          bg.querySelector('#del-hint').textContent='Échec : '+esc((r&&r.error)||'inconnu');
          go.disabled=false; return;
        }
        fermer();
        state.current=null;
        $('#detail').innerHTML='<div class="empty">Demande '+esc(ref)+' supprimée.</div>';
        toast('Demande '+ref+' supprimée ✓');
        loadList();
      }).catch(function(){
        bg.querySelector('#del-hint').textContent='Erreur réseau.';
        go.disabled=false;
      });
    });
  }

  // ---------- Réglages (settings) ----------
  function openSettings(){
    var s=state.settings||{};
    var f=function(k){return esc(s[k]!=null?s[k]:'');};
    var bg=document.createElement('div'); bg.className='modal-bg';
    bg.innerHTML='<div class="modal"><h2>Réglages de facturation</h2><p class="muted" style="margin:.2rem 0 1rem;">Ces informations pré-remplissent l\'en-tête et le bas de vos factures. À compléter dès la création de votre entreprise.</p>'+
      '<div class="grid2">'+
        fld('companyName','Nom / dénomination',f('companyName'))+
        fld('legalForm','Statut juridique',f('legalForm'))+
        fld('siret','SIRET',f('siret'))+
        fld('tvaMention','Mention TVA',f('tvaMention'))+
        fld('address','Adresse',f('address'))+
        fld('postcode','Code postal',f('postcode'))+
        fld('city','Ville',f('city'))+
        fld('email','E-mail (contact facturation)',f('email'))+
        fld('phone','Téléphone',f('phone'))+
        fld('quotePrefix','Préfixe des factures',f('quotePrefix'))+
        fld('depositPct','Acompte par défaut (%)',f('depositPct'),'number')+
      '</div>'+
      '<div class="field"><label>Signature des e-mails</label><textarea id="s-signature" rows="3" placeholder="Maison Solstice&#10;Location de mobilier &amp; décoration — Amiens">'+f('signature')+'</textarea></div>'+
      '<div class="field"><label>Conditions (bas de facture)</label><textarea id="s-conditions" rows="4">'+f('conditions')+'</textarea></div>'+
      '<div class="devis-actions"><button class="btn btn-gold" id="s-save">Enregistrer</button><button class="btn" id="s-cancel">Annuler</button></div>'+
    '</div>';
    document.body.appendChild(bg);
    function fldGet(k){ var el=bg.querySelector('#s-'+k); return el?el.value:''; }
    bg.querySelector('#s-cancel').addEventListener('click',function(){ document.body.removeChild(bg); });
    bg.addEventListener('click',function(e){ if(e.target===bg) document.body.removeChild(bg); });
    bg.querySelector('#s-save').addEventListener('click',function(){
      var payload={};['companyName','legalForm','siret','tvaMention','address','postcode','city','email','phone','quotePrefix','depositPct'].forEach(function(k){payload[k]=fldGet(k);});
      payload.conditions=bg.querySelector('#s-conditions').value;
      payload.signature=bg.querySelector('#s-signature').value;
      api('/api/admin/settings',{method:'POST',body:payload}).then(function(r){
        if(r.ok){ state.settings=r.settings; toast('Réglages enregistrés ✓'); document.body.removeChild(bg); }
        else toast('Erreur : '+(r.error||''),true);
      });
    });
  }
  function fld(id,label,val,type){ return '<div class="field"><label>'+esc(label)+'</label><input id="s-'+id+'" type="'+(type||'text')+'" value="'+val+'"></div>'; }

  // ---------- Events ----------
  // « 90 s », « 4 min », « 2 h » : plus lisible qu'un nombre de secondes.
  function duree(s){
    s=Math.max(1,Math.round(Number(s)||0));
    if(s<60) return s+' seconde'+(s>1?'s':'');
    if(s<3600){ var m=Math.max(1,Math.round(s/60)); return m+' minute'+(m>1?'s':''); }
    var h=Math.max(1,Math.round(s/3600)); return h+' heure'+(h>1?'s':'');
  }
  // ---------- Sécurité (double authentification, sessions) ----------
  function ligneInfo(etiquette,valeur,ton){
    var couleur = ton==='ok' ? '#5C7A5A' : (ton==='alerte' ? '#A2543C' : 'var(--stone)');
    return '<div style="display:flex;justify-content:space-between;gap:1rem;padding:.55rem 0;border-bottom:1px solid var(--line);">'+
           '<span style="color:var(--stone);font-size:.85rem;">'+etiquette+'</span>'+
           '<strong style="font-size:.85rem;color:'+couleur+';">'+valeur+'</strong></div>';
  }

  function fermer(bg){ if(bg && bg.parentNode) document.body.removeChild(bg); }

  function montrerCodesSecours(codes,bg){
    var html='<div class="modal"><h2>Vos codes de secours</h2>'+
      '<p class="muted" style="margin:.2rem 0 1rem;">Notez-les <strong>maintenant</strong> et rangez-les ailleurs que dans votre téléphone. '+
      'Chacun ne sert qu\'une fois, et ils ne seront plus jamais affichés.</p>'+
      '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1rem;letter-spacing:.08em;line-height:2;'+
      'background:var(--paper-2);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem;column-count:2;">'+
      codes.map(function(c){ return '<div>'+c+'</div>'; }).join('')+'</div>'+
      '<div style="display:flex;gap:.6rem;margin-top:1.2rem;">'+
      '<button class="btn btn-sm" id="sec-copier">Copier</button>'+
      '<button class="btn btn-gold btn-sm" id="sec-fini" style="margin-left:auto;">C\'est noté</button></div></div>';
    bg.innerHTML=html;
    bg.querySelector('#sec-copier').addEventListener('click',function(){
      try{ navigator.clipboard.writeText(codes.join('\n')); toast('Codes copiés ✓'); }catch(e){ toast('Copie impossible'); }
    });
    bg.querySelector('#sec-fini').addEventListener('click',function(){ fermer(bg); openSecurite(); });
  }

  function ecranActivation(bg){
    api('/api/admin/security',{method:'POST',body:{action:'start'}}).then(function(r){
      if(!r.ok){
        if(r.error==='security_table_missing'){
          bg.innerHTML='<div class="modal"><h2>Table manquante</h2><p class="muted">La table <code>admin_security</code> n\'existe pas encore. '+
            'Rejouez <code>supabase-schema.sql</code> dans Supabase (SQL Editor → coller → Run), puis revenez ici.</p>'+
            '<div style="margin-top:1.2rem;text-align:right;"><button class="btn btn-sm" id="sec-fermer">Fermer</button></div></div>';
          bg.querySelector('#sec-fermer').addEventListener('click',function(){ fermer(bg); });
          return;
        }
        toast('Impossible de démarrer'); fermer(bg); return;
      }
      bg.innerHTML='<div class="modal"><h2>Activer la double authentification</h2>'+
        '<p class="muted" style="margin:.2rem 0 1rem;">Dans votre application d\'authentification (Google Authenticator, 1Password, Authy…), '+
        'ajoutez un compte <strong>par saisie manuelle</strong> et entrez cette clé :</p>'+
        '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:1.05rem;letter-spacing:.12em;text-align:center;'+
        'background:var(--paper-2);border:1px solid var(--line);border-radius:12px;padding:1rem;">'+r.secretLisible+'</div>'+
        '<p class="muted" style="margin:.8rem 0 0;font-size:.78rem;">Compte : '+r.compte+' — Émetteur : Maison Solstice</p>'+
        '<p style="margin:.5rem 0 1.1rem;"><a href="'+r.uri+'" style="color:var(--gold-deep);font-size:.8rem;text-decoration:underline;">Ouvrir directement dans l\'application (depuis un téléphone)</a></p>'+
        '<label for="sec-code">Entrez le code affiché pour confirmer</label>'+
        '<input type="text" id="sec-code" inputmode="numeric" maxlength="7" placeholder="123456" style="letter-spacing:.3em;text-align:center;font-size:1.2rem;">'+
        '<div class="err" id="sec-err"></div>'+
        '<div style="display:flex;gap:.6rem;margin-top:1.2rem;">'+
        '<button class="btn btn-sm" id="sec-annuler">Annuler</button>'+
        '<button class="btn btn-gold btn-sm" id="sec-valider" style="margin-left:auto;">Activer</button></div></div>';
      bg.querySelector('#sec-code').focus();
      bg.querySelector('#sec-annuler').addEventListener('click',function(){
        api('/api/admin/security',{method:'POST',body:{action:'cancel'}}); fermer(bg);
      });
      bg.querySelector('#sec-valider').addEventListener('click',function(){
        var err=bg.querySelector('#sec-err'); err.textContent='';
        api('/api/admin/security',{method:'POST',body:{action:'confirm',code:bg.querySelector('#sec-code').value}}).then(function(c){
          if(c.ok){ loadMe().then(function(){ montrerCodesSecours(c.recovery,bg); }); }
          else if(c.error==='too_many_attempts'){ err.textContent='Trop de tentatives. Réessayez dans '+duree(c.retryAfter)+'.'; }
          else { err.textContent='Code incorrect.'; bg.querySelector('#sec-code').value=''; }
        }).catch(function(){ err.textContent='Erreur réseau.'; });
      });
    });
  }

  function demanderMotDePasse(bg,titre,texte,champsSup,action,apres){
    bg.innerHTML='<div class="modal"><h2>'+titre+'</h2><p class="muted" style="margin:.2rem 0 1rem;">'+texte+'</p>'+
      '<label for="sec-mdp">Mot de passe</label><input type="password" id="sec-mdp" autocomplete="current-password">'+
      (champsSup||'')+
      '<div class="err" id="sec-err"></div>'+
      '<div style="display:flex;gap:.6rem;margin-top:1.2rem;">'+
      '<button class="btn btn-sm" id="sec-annuler">Annuler</button>'+
      '<button class="btn btn-gold btn-sm" id="sec-ok" style="margin-left:auto;">Confirmer</button></div></div>';
    bg.querySelector('#sec-mdp').focus();
    bg.querySelector('#sec-annuler').addEventListener('click',function(){ fermer(bg); openSecurite(); });
    bg.querySelector('#sec-ok').addEventListener('click',function(){
      var err=bg.querySelector('#sec-err'); err.textContent='';
      var corps={action:action,password:bg.querySelector('#sec-mdp').value};
      var c=bg.querySelector('#sec-code2'); if(c) corps.code=c.value;
      var s=bg.querySelector('#sec-secours2'); if(s) corps.recovery=s.value;
      api('/api/admin/security',{method:'POST',body:corps}).then(function(r){
        if(r.ok){ apres(r,bg); return; }
        if(r.error==='bad_password'){ err.textContent='Mot de passe incorrect.'; }
        else if(r.error==='bad_code'){ err.textContent='Code incorrect ou déjà utilisé.'; }
        else if(r.error==='security_table_missing'){ err.textContent='La table admin_security manque : rejouez supabase-schema.sql.'; }
        else { err.textContent='Action impossible.'; }
      }).catch(function(){ err.textContent='Erreur réseau.'; });
    });
  }

  function openSecurite(){
    var s=(state.me&&state.me.securite)||{};
    var c=(state.me&&state.me.config)||{};
    var bg=document.createElement('div'); bg.className='modal-bg';
    bg.innerHTML='<div class="modal"><h2>Sécurité</h2>'+
      '<div style="margin:.8rem 0 1.2rem;">'+
        ligneInfo('Double authentification', s.deuxFacteurs?'Activée':'Désactivée', s.deuxFacteurs?'ok':'alerte')+
        (s.deuxFacteurs?ligneInfo('Codes de secours restants', String(s.secoursRestants), s.secoursRestants>2?'ok':'alerte'):'')+
        ligneInfo('Mot de passe', c.adminPasswordHache?'Stocké en empreinte':'En clair dans la configuration', c.adminPasswordHache?'ok':'alerte')+
        (s.durable===false?ligneInfo('État des sessions','Table admin_security manquante','alerte'):'')+
      '</div>'+
      '<div style="display:flex;flex-direction:column;gap:.6rem;">'+
        (s.deuxFacteurs
          ? '<button class="btn btn-sm" id="sec-nouveaux">Refaire des codes de secours</button>'+
            '<button class="btn btn-sm" id="sec-retirer">Retirer la double authentification</button>'
          : '<button class="btn btn-gold btn-sm" id="sec-activer">Activer la double authentification</button>')+
        '<button class="btn btn-sm" id="sec-revoquer">Déconnecter partout</button>'+
      '</div>'+
      (c.adminPasswordHache?'':'<p class="muted" style="margin:1rem 0 0;font-size:.78rem;">Le mot de passe est encore stocké en clair dans les variables Vercel. '+
        'Lancez <code>npm run motdepasse</code> pour produire une empreinte, posez-la dans <code>ADMIN_PASSWORD_HASH</code> et supprimez <code>ADMIN_PASSWORD</code>.</p>')+
      '<div style="margin-top:1.3rem;text-align:right;"><button class="btn btn-sm" id="sec-fermer">Fermer</button></div></div>';
    document.body.appendChild(bg);
    bg.addEventListener('click',function(e){ if(e.target===bg) fermer(bg); });
    bg.querySelector('#sec-fermer').addEventListener('click',function(){ fermer(bg); });

    var bA=bg.querySelector('#sec-activer');
    if(bA) bA.addEventListener('click',function(){ ecranActivation(bg); });

    var bR=bg.querySelector('#sec-retirer');
    if(bR) bR.addEventListener('click',function(){
      demanderMotDePasse(bg,'Retirer la double authentification',
        'Votre mot de passe et un code valide sont demandés : sans cela, un ordinateur laissé ouvert suffirait à désarmer le compte. Toutes les autres sessions seront fermées.',
        '<label for="sec-code2" style="margin-top:.8rem;display:block;">Code de l\'application</label>'+
        '<input type="text" id="sec-code2" inputmode="numeric" maxlength="7" placeholder="123456" style="letter-spacing:.3em;text-align:center;">'+
        '<label for="sec-secours2" style="margin-top:.8rem;display:block;">…ou un code de secours</label>'+
        '<input type="text" id="sec-secours2" maxlength="12" placeholder="ABCDE-FGHIJ" style="letter-spacing:.14em;text-align:center;">',
        'disable', function(r,bgx){ fermer(bgx); loadMe().then(function(){ toast('Double authentification retirée'); }); });
    });

    var bN=bg.querySelector('#sec-nouveaux');
    if(bN) bN.addEventListener('click',function(){
      demanderMotDePasse(bg,'Refaire des codes de secours',
        'Les anciens codes cesseront immédiatement de fonctionner.','','recovery',
        function(r,bgx){ loadMe().then(function(){ montrerCodesSecours(r.recovery,bgx); }); });
    });

    bg.querySelector('#sec-revoquer').addEventListener('click',function(){
      demanderMotDePasse(bg,'Déconnecter partout',
        'Toutes les sessions ouvertes seront fermées — téléphone, autre ordinateur, navigateur oublié quelque part. La vôtre reste ouverte.',
        '','revoke-all', function(r,bgx){ fermer(bgx); toast('Toutes les autres sessions sont fermées ✓'); });
    });
  }

  // La connexion se fait en un ou deux temps selon que la double
  // authentification est active. Le serveur decide : il repond `need2fa`.
  var etapeConnexion='mdp';

  function montrerEtape(nom){
    etapeConnexion=nom;
    $('#etape-mdp').classList.toggle('hidden', nom!=='mdp');
    $('#etape-code').classList.toggle('hidden', nom!=='code');
    $('#etape-secours').classList.toggle('hidden', nom!=='secours');
    $('#login-submit').textContent = nom==='mdp' ? 'Entrer' : 'Valider';
    var champ = nom==='mdp' ? $('#pw') : (nom==='code' ? $('#code2fa') : $('#codesecours'));
    if(champ) setTimeout(function(){ champ.focus(); },30);
  }

  $('#lien-secours').addEventListener('click',function(){
    $('#login-err').textContent=''; montrerEtape('secours');
  });

  $('#login-form').addEventListener('submit',function(e){
    e.preventDefault(); var err=$('#login-err'); err.textContent='';
    var corps;
    if(etapeConnexion==='mdp'){ corps={password:$('#pw').value}; }
    else if(etapeConnexion==='code'){ corps={code:$('#code2fa').value}; }
    else { corps={recovery:$('#codesecours').value}; }

    api('/api/admin/login',{method:'POST',body:corps}).then(function(r){
      if(r.ok && r.need2fa){
        $('#pw').value='';
        montrerEtape('code');
        return;
      }
      if(r.ok){
        if(r.usedRecovery){
          alert('Connexion par code de secours. Il vous en reste '+r.recoveryLeft+
                '.\n\nSi vous avez perdu votre téléphone, refaites la double authentification depuis Sécurité.');
        }
        boot(); return;
      }
      if(r.error==='admin_password_not_set'){ err.textContent="Le mot de passe admin n'est pas encore configuré sur le serveur."; }
      else if(r.error==='too_many_attempts'){ err.textContent='Trop de tentatives. Réessayez dans '+duree(r.retryAfter)+'.'; }
      else if(r.error==='step_expired'){
        err.textContent='La session de connexion a expiré. Reprenez au mot de passe.';
        montrerEtape('mdp');
      }
      else if(r.error==='bad_code'){
        err.textContent = etapeConnexion==='secours' ? 'Code de secours invalide ou déjà utilisé.' : 'Code incorrect.';
        var c=$('#code2fa'); if(c) c.value='';
      }
      else if(typeof r.remaining==='number' && r.remaining<=2){
        err.textContent='Mot de passe incorrect. '+(r.remaining>0
          ? 'Encore '+r.remaining+' essai'+(r.remaining>1?'s':'')+' avant une mise en attente.'
          : 'Prochaine erreur : mise en attente.');
      }
      else { err.textContent='Mot de passe incorrect.'; }
    }).catch(function(){ err.textContent='Erreur réseau.'; });
  });
  $('#btn-logout').addEventListener('click',function(){ api('/api/admin/logout',{method:'POST'}).then(function(){ location.reload(); }); });
  $('#btn-settings').addEventListener('click',openSettings);
  $('#btn-securite').addEventListener('click',openSecurite);
  $('#tri').addEventListener('change',function(e){ state.tri=e.target.value; renderList(); });
  $('#search').addEventListener('input',function(e){ state.q=e.target.value; renderList(); });
  Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'),function(ch){
    ch.addEventListener('click',function(){ Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'),function(x){x.classList.remove('on');}); ch.classList.add('on'); state.filter=ch.getAttribute('data-f'); renderList(); });
  });

  // ----- Messagerie -----
  Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'),function(b){
    b.addEventListener('click',function(){ switchTab(b.getAttribute('data-tab')); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#mboxes .chip'),function(ch){
    ch.addEventListener('click',function(){
      Array.prototype.forEach.call(document.querySelectorAll('#mboxes .chip'),function(x){x.classList.remove('on');});
      ch.classList.add('on');
      $('#msearch').value=''; M.q='';
      $('#mail-grid').classList.remove('reading');
      loadBox(ch.getAttribute('data-box'));
    });
  });
  var mq;
  $('#msearch').addEventListener('input',function(e){
    clearTimeout(mq);
    var v=e.target.value.trim();
    mq=setTimeout(function(){ if(v===M.q) return; M.q=v; loadBox(M.box); },350);
  });
  $('#mrefresh').addEventListener('click',function(){ cacheClear(); loadBox(M.box); });
  $('#mnew').addEventListener('click',function(){ newMessage(''); });
  document.addEventListener('visibilitychange',function(){ if(!document.hidden&&state.tab==='mail') pollUnread(); });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&state.tab==='mail'&&M.composing){ $('#compose-slot').innerHTML=''; M.composing=null; }
  });

  boot();
})();
