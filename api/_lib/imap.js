// Lecture de la boite du domaine, en IMAP.
//
// La boite reste chez l'hebergeur (OVH / Zimbra) : le back-office ne fait que
// s'y connecter, comme le ferait un client mail. Rien n'est recopie ailleurs,
// et le webmail comme le telephone continuent de fonctionner normalement.
//
// Variables d'environnement :
//   IMAP_HOST  (defaut : SMTP_HOST, soit ssl0.ovh.net)
//   IMAP_PORT  (defaut : 993)
//   IMAP_USER  (defaut : SMTP_USER)
//   IMAP_PASS  (defaut : SMTP_PASS)
//
// En pratique, si l'envoi SMTP est deja configure, la lecture l'est aussi :
// il n'y a aucune variable supplementaire a ajouter.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

/* La connexion est conservee entre deux appels d'une meme instance chaude :
   c'est ce qui evite de repayer la poignee de main TLS + LOGIN (~500 ms) a
   chaque clic. Elle se ferme d'elle-meme apres une periode d'inactivite. */
let _client = null;
let _connecting = null;
let _idleTimer = null;
let _inFlight = 0;
const IDLE_MS = 90 * 1000;

function conf() {
  return {
    host: process.env.IMAP_HOST || process.env.SMTP_HOST || '',
    port: Number(process.env.IMAP_PORT) || 993,
    user: process.env.IMAP_USER || process.env.SMTP_USER || '',
    pass: process.env.IMAP_PASS || process.env.SMTP_PASS || ''
  };
}

function imapReady() {
  if (global.__solMockImap) return true;
  const c = conf();
  return Boolean(c.host && c.user && c.pass);
}

function scheduleClose() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    _idleTimer = null;
    // Une autre requete peut s'etre glissee entre-temps : on ne ferme jamais
    // une connexion en cours d'utilisation.
    if (_inFlight > 0) { scheduleClose(); return; }
    const c = _client;
    _client = null;
    if (c) c.logout().catch(() => c.close && c.close());
  }, IDLE_MS);
  if (_idleTimer.unref) _idleTimer.unref();
}

/* Ferme une connexion donnee. On ne touche a l'etat partage que si c'est bien
   la connexion courante : sinon deux requetes concurrentes se voleraient
   mutuellement la leur. */
function dropClient(c) {
  if (!c || c === _client) {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    _client = null;
  }
  if (c) { try { c.close(); } catch (e) { /* deja fermee */ } }
}

async function connect() {
  const c = conf();
  if (!c.host || !c.user || !c.pass) throw new Error('imap_not_configured');
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.port === 993,
    auth: { user: c.user, pass: c.pass },
    logger: false,
    // Sur une fonction serverless, mieux vaut echouer vite que faire patienter.
    socketTimeout: 20000,
    greetingTimeout: 10000,
    connectionTimeout: 12000
  });
  client.on('error', () => { /* gere par le retry de withClient */ });
  await client.connect();
  return client;
}

/* Obtient la connexion partagee. La promesse d'ouverture est memorisee : deux
   requetes qui arrivent ensemble sur une instance froide attendent la MEME
   poignee de main au lieu d'en ouvrir chacune une — dont une seule serait
   ensuite refermee. */
async function acquire() {
  if (_client && _client.usable) return { client: _client, reused: true };
  if (_client) dropClient(_client);
  if (!_connecting) {
    _connecting = connect().then(
      (c) => { _client = c; _connecting = null; return c; },
      (e) => { _connecting = null; throw e; }
    );
  }
  return { client: await _connecting, reused: false };
}

/* Execute `fn` avec une connexion ouverte. Une instance figee par la
   plateforme peut se reveiller avec une socket morte : on retente donc une
   fois, avec une connexion neuve, avant d'abandonner. */
async function withClient(fn) {
  if (global.__solMockImap) return fn(global.__solMockImap);
  for (let attempt = 0; attempt < 2; attempt++) {
    const acq = await acquire();
    const client = acq.client;
    _inFlight++;
    try {
      const out = await fn(client);
      return out;
    } catch (err) {
      // Ne jeter la connexion que si c'est elle qui est en cause : un message
      // introuvable n'a aucune raison de couper la session.
      if (!client.usable) dropClient(client);
      if (!acq.reused || attempt === 1 || client.usable) throw err;
    } finally {
      _inFlight--;
      scheduleClose();
    }
  }
  throw new Error('imap_unreachable');
}

/* ---------- Dossiers ---------- */

const SPECIAL = { sent: '\\Sent', trash: '\\Trash', junk: '\\Junk' };

/* La liste des dossiers ne bouge pas : on la garde le temps de vie de la
   connexion, sinon chaque passage dans « Envoyés » relance un LIST complet. */
async function folders(client) {
  if (client.__solFolders) return client.__solFolders;
  const list = await client.list();
  const out = { inbox: 'INBOX' };
  Object.keys(SPECIAL).forEach((key) => {
    const found = list.find((m) => m.specialUse === SPECIAL[key]);
    if (found) out[key] = found.path;
  });
  // Repli sur les noms usuels quand le serveur n'annonce pas SPECIAL-USE.
  const byName = (names) => (list.find((m) => names.indexOf(m.path) >= 0) || {}).path;
  out.sent = out.sent || byName(['Sent', 'Sent Messages', 'Envoyés', 'Éléments envoyés']);
  out.trash = out.trash || byName(['Trash', 'Corbeille', 'Deleted Items']);
  out.junk = out.junk || byName(['Junk', 'Spam', 'Indésirables']);
  client.__solFolders = out;
  return out;
}

/* Traduit un nom logique ('inbox', 'sent'...) en chemin reel sur le serveur. */
async function resolveBox(client, box) {
  if (!box || box === 'inbox') return 'INBOX';
  const f = await folders(client);
  // Replier sur INBOX afficherait la reception sous l'etiquette « Corbeille ».
  if (!f[box]) throw new Error('folder_not_found');
  return f[box];
}

/* ---------- Decodage ---------- */

function decodeQuotedPrintable(str) {
  return Buffer.from(
    str.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))),
    'binary'
  );
}

function toText(buf, encoding, charset) {
  if (!buf) return '';
  let raw = buf;
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'base64') raw = Buffer.from(buf.toString('ascii'), 'base64');
  else if (enc === 'quoted-printable') raw = decodeQuotedPrintable(buf.toString('binary'));
  const cs = String(charset || 'utf-8').toLowerCase();
  if (cs === 'utf-8' || cs === 'utf8' || cs === 'us-ascii' || cs === 'ascii') return raw.toString('utf8');
  try {
    const iconv = require('iconv-lite');
    if (iconv.encodingExists(cs)) return iconv.decode(raw, cs);
  } catch (e) { /* jeu de caracteres exotique : on retombe sur utf-8 */ }
  return raw.toString('utf8');
}

/* Apercu d'une ligne, comme dans n'importe quel client mail. */
function preview(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/^\s*>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/* imapflow renvoie la chaine brute de l'en-tete quand la date est illisible :
   new Date(...).toISOString() leverait alors une RangeError, et c'est TOUT le
   dossier qui deviendrait impossible a lister. */
function isoDate(v) {
  if (!v) return null;
  const d = (v instanceof Date) ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function addr(a) {
  if (!a) return null;
  return { name: a.name || '', address: (a.address || '').toLowerCase() };
}
function addrList(list) {
  return (Array.isArray(list) ? list : []).map(addr).filter(Boolean);
}

/* La premiere partie textuelle d'un message, pour l'apercu de la liste.
   text/plain d'abord ; a defaut text/html, dont preview() otera les balises. */
function firstTextNode(node, type) {
  if (!node) return null;
  if (node.type === type) return node;
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const found = firstTextNode(kids[i], type);
    if (found) return found;
  }
  return null;
}

function textNodeOf(structure) {
  return firstTextNode(structure, 'text/plain') || firstTextNode(structure, 'text/html');
}

/* Les images de mise en page d'un e-mail sont jointes au message et
   referencees par « cid: ». On les incorpore directement dans le HTML : elles
   s'affichent alors sans aller chercher quoi que ce soit sur le reseau.
   Plafonne, pour ne pas renvoyer une reponse de plusieurs megaoctets. */
const INLINE_BUDGET = 2 * 1024 * 1024;

/* Le « cid: » vient de l'expediteur : decodeURIComponent y leverait une
   URIError sur un simple « % », et le message deviendrait illisible. */
function safeDecode(v) {
  try { return decodeURIComponent(v); } catch (e) { return v; }
}

function inlineCidImages(html, attachments) {
  const used = new Set();
  if (!html || !attachments.length) return { html: html, used };
  let budget = INLINE_BUDGET;
  const byCid = new Map();
  attachments.forEach((a) => {
    if (!a.cid || !a.content) return;
    if (!/^image\//i.test(a.contentType || '')) return;
    if (a.content.length > budget) return;
    budget -= a.content.length;
    byCid.set(String(a.cid).replace(/^<|>$/g, ''), {
      cid: a.cid,
      url: 'data:' + a.contentType + ';base64,' + a.content.toString('base64')
    });
  });
  if (!byCid.size) return { html: html, used };
  const out = html.replace(/(["'(])cid:([^"')\s]+)/gi, (m, q, cid) => {
    const hit = byCid.get(safeDecode(cid)) || byCid.get(cid);
    if (!hit) return m;
    used.add(hit.cid);
    return q + hit.url;
  });
  return { html: out, used };
}

function hasAttachment(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  return (node.childNodes || []).some(hasAttachment);
}

/* ---------- Lecture ---------- */

/* Resume d'un message pour la liste : ce que le serveur renvoie en une seule
   requete, sans avoir a telecharger le corps entier. */
function summarize(msg) {
  const env = msg.envelope || {};
  const textNode = textNodeOf(msg.bodyStructure);
  // Le tampon et l'encodage doivent decrire la MEME partie, sinon l'apercu est
  // decode de travers (base64 lu comme du texte, par exemple).
  const partKey = textNode ? (textNode.part || '1') : null;
  const partBuf = partKey && msg.bodyParts ? msg.bodyParts.get(partKey) : null;
  return {
    uid: msg.uid,
    seq: msg.seq,
    from: addrList(env.from)[0] || null,
    to: addrList(env.to),
    subject: env.subject || '',
    date: isoDate(env.date),
    messageId: env.messageId || '',
    seen: (msg.flags && msg.flags.has('\\Seen')) || false,
    flagged: (msg.flags && msg.flags.has('\\Flagged')) || false,
    answered: (msg.flags && msg.flags.has('\\Answered')) || false,
    attachments: hasAttachment(msg.bodyStructure),
    preview: preview(toText(partBuf, textNode && textNode.encoding, textNode && textNode.parameters && textNode.parameters.charset))
  };
}

/* Emplacements usuels de la partie textuelle : demandes en une seule requete,
   summarize ne retient que celui qui correspond a la structure du message. */
const FETCH_FIELDS = {
  uid: true, envelope: true, flags: true, bodyStructure: true,
  bodyParts: ['1', '1.1', '1.2', '2']
};

/* Recherche cote serveur : c'est l'IMAP qui cherche, pas le navigateur — sinon
   on ne trouverait que dans les messages deja charges. */
async function searchMessages(opts) {
  const box = (opts && opts.box) || 'inbox';
  const q = String((opts && opts.q) || '').trim().slice(0, 200);
  const limit = Math.min(100, Math.max(1, Number(opts && opts.limit) || 40));
  if (!q) return { items: [], total: 0, nextSeq: 0, box, search: true };

  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      const uids = await client.search({ or: [{ from: q }, { to: q }, { subject: q }, { body: q }] }, { uid: true });
      if (!uids || !uids.length) return { items: [], total: 0, nextSeq: 0, box, search: true };
      const take = uids.slice(-limit);
      const items = [];
      for await (const msg of client.fetch(take.join(','), FETCH_FIELDS, { uid: true })) items.push(summarize(msg));
      items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      return { items, total: uids.length, nextSeq: 0, box, search: true };
    } finally {
      lock.release();
    }
  });
}

/* Cherche dans un dossier deja resolu et renvoie les resumes correspondants. */
async function searchIn(client, path, criteria, limit) {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = await client.search(criteria, { uid: true });
    if (!uids || !uids.length) return [];
    const take = uids.slice(-limit);
    const out = [];
    for await (const msg of client.fetch(take.join(','), FETCH_FIELDS, { uid: true })) out.push(summarize(msg));
    return out;
  } finally {
    lock.release();
  }
}

/* « Re : », « TR : », « Fwd: »... : l'objet nu, pour rapprocher les messages
   d'un meme echange meme quand les en-tetes de fil sont absents. */
function baseSubject(s) {
  return String(s || '')
    .replace(/^\s*(?:(?:re|ré|rép|rep|fw|fwd|tr|transf)\s*(?:\[\d+\])?\s*:\s*)+/i, '')
    .trim();
}

/* Tous les identifiants de message cites dans un bloc d'en-tetes. */
function headerIds(buf) {
  const s = buf ? buf.toString('utf8') : '';
  return (s.match(/<[^<>\s]+>/g) || []).map((x) => x.slice(1, -1));
}

function myAddress() {
  return String(conf().user || '').toLowerCase();
}

/* Le fil complet d'un echange : le message d'origine, les reponses recues et
   celles qu'on a envoyees — ces dernieres vivent dans « Envoyés », d'ou la
   recherche dans les deux dossiers. */
async function getThread(box, uid, limitPerBox) {
  const limit = Math.min(50, Math.max(1, Number(limitPerBox) || 30));
  return withClient(async (client) => {
    const f = await folders(client);
    const path = await resolveBox(client, box);

    let env = null;
    let ids = [];
    const lock = await client.getMailboxLock(path);
    try {
      const m = await client.fetchOne(String(uid),
        { uid: true, envelope: true, headers: ['references', 'in-reply-to', 'message-id'] },
        { uid: true });
      if (!m) throw new Error('message_not_found');
      env = m.envelope || {};
      ids = headerIds(m.headers);
      if (env.messageId) ids.push(String(env.messageId).replace(/^<|>$/g, ''));
    } finally {
      lock.release();
    }

    const moi = myAddress();
    const sujet = baseSubject(env.subject);
    const expediteur = (addrList(env.from)[0] || {}).address || '';
    const destinataires = addrList(env.to).map((a) => a.address);
    const correspondant = (expediteur && expediteur !== moi)
      ? expediteur
      : destinataires.filter((a) => a && a !== moi)[0] || '';

    const parIdentifiant = [];
    Array.from(new Set(ids.filter(Boolean))).slice(0, 8).forEach((id) => {
      parIdentifiant.push({ header: { 'message-id': id } });
      parIdentifiant.push({ header: { references: id } });
      parIdentifiant.push({ header: { 'in-reply-to': id } });
    });

    const dossiers = [['inbox', 'INBOX']];
    if (f.sent) dossiers.push(['sent', f.sent]);

    const trouves = [];
    for (let i = 0; i < dossiers.length; i++) {
      const nom = dossiers[i][0];
      const chemin = dossiers[i][1];
      // Deux recherches simples plutot qu'un critere imbrique : les en-tetes
      // de fil d'abord, puis l'objet nu pour les messageries qui les omettent.
      if (parIdentifiant.length) {
        try {
          (await searchIn(client, chemin, { or: parIdentifiant }, limit))
            .forEach((it) => trouves.push(Object.assign(it, { box: nom })));
        } catch (e) { /* un dossier illisible ne doit pas casser le fil */ }
      }
      if (sujet && correspondant) {
        try {
          (await searchIn(client, chemin, { subject: sujet }, limit))
            .filter((it) => {
              const parties = [(it.from || {}).address].concat((it.to || []).map((a) => a.address));
              return parties.indexOf(correspondant) >= 0;
            })
            .forEach((it) => trouves.push(Object.assign(it, { box: nom })));
        } catch (e) { /* idem */ }
      }
    }

    const vus = new Set();
    const items = [];
    trouves.forEach((it) => {
      const cle = it.messageId || (it.box + ':' + it.uid);
      if (vus.has(cle)) return;
      vus.add(cle);
      it.outgoing = Boolean(it.from && it.from.address === moi);
      items.push(it);
    });
    items.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    return { items, correspondant };
  });
}

/* Le message le plus recent echange avec une adresse, ou qu'il se trouve.
   Sert au bouton « Écrire un e-mail » depuis une commande. */
async function findLatestWith(address) {
  const a = String(address || '').toLowerCase();
  if (!a) return null;
  return withClient(async (client) => {
    const f = await folders(client);
    const essais = [['inbox', 'INBOX', { or: [{ from: a }, { to: a }] }]];
    if (f.sent) essais.push(['sent', f.sent, { to: a }]);
    let meilleur = null;
    for (let i = 0; i < essais.length; i++) {
      try {
        const trouves = await searchIn(client, essais[i][1], essais[i][2], 5);
        trouves.forEach((it) => {
          if (!meilleur || String(it.date || '') > String(meilleur.date || '')) {
            meilleur = { box: essais[i][0], uid: it.uid, date: it.date };
          }
        });
      } catch (e) { /* dossier absent ou illisible */ }
    }
    return meilleur;
  });
}

/* Liste des messages, du plus recent au plus ancien.
   `beforeSeq` permet de charger la page suivante (messages plus anciens). */
async function listMessages(opts) {
  const box = (opts && opts.box) || 'inbox';
  const limit = Math.min(100, Math.max(1, Number(opts && opts.limit) || 40));
  const beforeSeq = Number(opts && opts.beforeSeq) || 0;

  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      const total = client.mailbox.exists || 0;
      if (!total) return { items: [], total: 0, nextSeq: 0, box };
      const top = beforeSeq ? beforeSeq - 1 : total;
      if (top < 1) return { items: [], total, nextSeq: 0, box };
      const from = Math.max(1, top - limit + 1);

      const items = [];
      for await (const msg of client.fetch(`${from}:${top}`, FETCH_FIELDS, { uid: false })) items.push(summarize(msg));
      items.reverse();
      return { items, total, nextSeq: from > 1 ? from : 0, box };
    } finally {
      lock.release();
    }
  });
}

/* Telecharge et analyse un message. Blocs d'un megaoctet plutot que de 64 Ko —
   seize fois moins d'aller-retours — et plafond de taille, pour qu'une piece
   jointe demesuree ne fasse pas expirer la fonction. */
const MAX_MESSAGE = 25 * 1024 * 1024;

async function downloadParsed(client, uid) {
  const dl = await client.download(String(uid), undefined, {
    uid: true, chunkSize: 1024 * 1024, maxBytes: MAX_MESSAGE
  });
  if (!dl || !dl.content) throw new Error('message_not_found');
  return simpleParser(dl.content);
}

/* Un message complet : corps, pieces jointes, en-tetes de fil de discussion. */
async function getMessage(box, uid) {
  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      const parsed = await downloadParsed(client, uid);
      const inlined = inlineCidImages(parsed.html || '', parsed.attachments || []);
      return {
        uid: Number(uid),
        box,
        subject: parsed.subject || '',
        date: isoDate(parsed.date),
        messageId: parsed.messageId || '',
        inReplyTo: parsed.inReplyTo || '',
        references: [].concat(parsed.references || []).filter(Boolean),
        from: addrList(parsed.from && parsed.from.value)[0] || null,
        to: addrList(parsed.to && parsed.to.value),
        cc: addrList(parsed.cc && parsed.cc.value),
        html: inlined.html,
        text: parsed.text || '',
        attachments: (parsed.attachments || [])
          .map((a, i) => ({
            index: i,
            filename: a.filename || ('piece-jointe-' + (i + 1)),
            contentType: a.contentType || 'application/octet-stream',
            size: a.size || (a.content ? a.content.length : 0),
            embedded: Boolean(a.cid && inlined.used.has(a.cid))
          }))
          // On ne masque que ce qui a REELLEMENT ete incorpore au corps : une
          // piece « inline » non reprise doit rester telechargeable.
          .filter((a) => !a.embedded)
      };
    } finally {
      lock.release();
    }
  });
}

async function getAttachment(box, uid, index) {
  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      const parsed = await downloadParsed(client, uid);
      const att = (parsed.attachments || [])[Number(index)];
      if (!att) throw new Error('attachment_not_found');
      return {
        filename: att.filename || 'piece-jointe',
        contentType: att.contentType || 'application/octet-stream',
        content: att.content
      };
    } finally {
      lock.release();
    }
  });
}

/* ---------- Ecriture ---------- */

async function setSeen(box, uid, seen) {
  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      const range = { uid: String(uid) };
      if (seen) await client.messageFlagsAdd(range, ['\\Seen'], { uid: true });
      else await client.messageFlagsRemove(range, ['\\Seen'], { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

async function setFlagged(box, uid, flagged) {
  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      const range = { uid: String(uid) };
      if (flagged) await client.messageFlagsAdd(range, ['\\Flagged'], { uid: true });
      else await client.messageFlagsRemove(range, ['\\Flagged'], { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

/* Marque le message d'origine comme ayant recu une reponse : c'est ce qui
   affiche la fleche de reponse dans le webmail et sur le telephone. */
async function setAnswered(box, uid) {
  return withClient(async (client) => {
    const path = await resolveBox(client, box);
    const lock = await client.getMailboxLock(path);
    try {
      await client.messageFlagsAdd({ uid: String(uid) }, ['\\Answered', '\\Seen'], { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

/* Deplace a la corbeille — jamais de suppression definitive depuis ici. */
async function trashMessage(box, uid) {
  return withClient(async (client) => {
    const f = await folders(client);
    const path = await resolveBox(client, box);
    if (!f.trash || f.trash === path) return false;
    const lock = await client.getMailboxLock(path);
    try {
      await client.messageMove({ uid: String(uid) }, f.trash, { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

/* Recopie le message envoye dans « Envoyés », pour le retrouver depuis le
   webmail ou le telephone — comme le ferait un vrai client mail. */
async function appendToSent(raw) {
  return withClient(async (client) => {
    const f = await folders(client);
    if (!f.sent) return false;
    await client.append(f.sent, raw, ['\\Seen']);
    return true;
  });
}

/* Nombre de messages non lus, pour la pastille de l'onglet. */
async function unreadCount() {
  return withClient(async (client) => {
    const s = await client.status('INBOX', { unseen: true });
    return (s && s.unseen) || 0;
  });
}

module.exports = {
  imapReady, listMessages, searchMessages, getThread, findLatestWith, getMessage, getAttachment,
  setSeen, setFlagged, setAnswered, trashMessage, appendToSent, unreadCount,
  // Fonctions pures, couvertes par test/imap.test.js
  preview, toText, isoDate, inlineCidImages, summarize, textNodeOf, baseSubject, headerIds
};
