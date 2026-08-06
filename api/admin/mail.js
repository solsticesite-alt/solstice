// Messagerie du back-office : lecture et reponse sur la boite du domaine.
//
// Un seul point d'entree pour toutes les actions, afin de ne pas multiplier
// les fonctions serverless :
//   GET  ?action=list        &box=inbox&limit=40&beforeSeq=0
//   GET  ?action=search      &box=inbox&q=texte&limit=40   (sans q -> list)
//   GET  ?action=message     &box=inbox&uid=12[&peek=1]
//   GET  ?action=thread      &box=inbox&uid=12   -> le fil complet
//   GET  ?action=find        &address=x@y.fr     -> ou reprendre l'echange
//   GET  ?action=bounces     &limit=15           -> les non-remises recentes
//   GET  ?action=attachment  &box=inbox&uid=12&index=0     -> fichier brut
//   GET  ?action=unread
//   POST {action:'send'|'seen'|'flag'|'trash', ...}

const { readJson, send, clean, cleanMultiline, isEmail } = require('../_lib/util');
const auth = require('../_lib/auth');
const imap = require('../_lib/imap');
const mail = require('../_lib/mail');
const store = require('../_lib/store');
const { renderBody, textToHtml } = require('../_lib/htmlmail');

const BOXES = ['inbox', 'sent', 'trash', 'junk'];

function boxOf(v) {
  const b = String(v || 'inbox').toLowerCase();
  return BOXES.indexOf(b) >= 0 ? b : 'inbox';
}

function uidOf(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* Un nom de fichier sur, pour l'en-tete Content-Disposition. */
function safeFilename(name) {
  return String(name || 'piece-jointe').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'piece-jointe';
}

function fail(res, e) {
  const msg = String((e && e.message) || e);
  if (/not_found/.test(msg)) return send(res, 404, { ok: false, error: 'not_found' });
  if (/not_configured/.test(msg)) return send(res, 503, { ok: false, error: 'imap_not_configured' });
  if (/auth|login|credentials/i.test(msg)) return send(res, 502, { ok: false, error: 'imap_auth_failed' });
  return send(res, 502, { ok: false, error: 'imap_error', detail: msg.slice(0, 200) });
}

/* ---------- Lecture ---------- */

async function handleGet(req, res, url) {
  const action = url.searchParams.get('action') || 'list';

  if (action === 'unread') {
    const unread = await imap.unreadCount();
    return send(res, 200, { ok: true, unread });
  }

  if (action === 'list' || action === 'search') {
    const box = boxOf(url.searchParams.get('box'));
    const limit = parseInt(url.searchParams.get('limit'), 10) || 40;
    const q = clean(url.searchParams.get('q'), 200);
    const out = (action === 'search' && q)
      ? await imap.searchMessages({ box, q, limit })
      : await imap.listMessages({ box, limit, beforeSeq: parseInt(url.searchParams.get('beforeSeq'), 10) || 0 });
    return send(res, 200, Object.assign({ ok: true }, out));
  }

  if (action === 'thread') {
    const box = boxOf(url.searchParams.get('box'));
    const uid = uidOf(url.searchParams.get('uid'));
    if (!uid) return send(res, 400, { ok: false, error: 'uid_required' });
    const out = await imap.getThread(box, uid);
    return send(res, 200, Object.assign({ ok: true }, out));
  }

  if (action === 'bounces') {
    const out = await imap.listBounces(parseInt(url.searchParams.get('limit'), 10) || 15);
    return send(res, 200, Object.assign({ ok: true }, out));
  }

  if (action === 'find') {
    const address = clean(url.searchParams.get('address'), 200).toLowerCase();
    if (!isEmail(address)) return send(res, 400, { ok: false, error: 'bad_address' });
    const hit = await imap.findLatestWith(address);
    return send(res, 200, { ok: true, found: Boolean(hit), box: hit ? hit.box : null, uid: hit ? hit.uid : 0 });
  }

  if (action === 'message') {
    const box = boxOf(url.searchParams.get('box'));
    const uid = uidOf(url.searchParams.get('uid'));
    if (!uid) return send(res, 400, { ok: false, error: 'uid_required' });
    const msg = await imap.getMessage(box, uid);
    const body = renderBody(msg);
    // Marquer comme lu fait partie de l'ouverture, comme dans tout client mail —
    // sauf en pre-chargement (peek), ou le message n'a pas encore ete ouvert.
    const peek = url.searchParams.get('peek') === '1';
    if (box === 'inbox' && !peek) { try { await imap.setSeen(box, uid, true); } catch (e) { /* sans consequence */ } }
    return send(res, 200, {
      ok: true,
      message: {
        uid: msg.uid, box: msg.box, subject: msg.subject, date: msg.date,
        messageId: msg.messageId, inReplyTo: msg.inReplyTo, references: msg.references,
        from: msg.from, to: msg.to, cc: msg.cc,
        attachments: msg.attachments,
        text: msg.text || '',
        body: body.html, bodyKind: body.kind, blockedImages: body.blockedImages
      }
    });
  }

  if (action === 'attachment') {
    const box = boxOf(url.searchParams.get('box'));
    const uid = uidOf(url.searchParams.get('uid'));
    const index = parseInt(url.searchParams.get('index'), 10);
    if (!uid || !Number.isFinite(index) || index < 0) return send(res, 400, { ok: false, error: 'bad_params' });
    const att = await imap.getAttachment(box, uid, index);
    res.statusCode = 200;
    res.setHeader('Content-Type', att.contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeFilename(att.filename) + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(att.content);
  }

  return send(res, 400, { ok: false, error: 'unknown_action' });
}

/* ---------- Ecriture ---------- */

/* Vercel plafonne le corps d'une requete a 4,5 Mo, et le base64 gonfle de
   33 % : on s'arrete donc a 3 Mo de fichiers, annonces comme tels. */
const MAX_PIECES = 3 * 1024 * 1024;

function piecesJointes(v) {
  if (!Array.isArray(v)) return [];
  let total = 0;
  const out = [];
  v.slice(0, 10).forEach((a) => {
    if (!a || typeof a.content !== 'string') return;
    let buf;
    try { buf = Buffer.from(a.content, 'base64'); } catch (e) { return; }
    if (!buf.length) return;
    total += buf.length;
    if (total > MAX_PIECES) throw new Error('attachments_too_large');
    out.push({
      filename: clean(a.filename, 150) || 'piece-jointe',
      contentType: clean(a.contentType, 100) || 'application/octet-stream',
      content: buf
    });
  });
  return out;
}

async function handlePost(req, res) {
  let b;
  // Le plafond par defaut de readJson (512 Ko) ne suffirait pas des qu'un
  // fichier accompagne la reponse.
  try { b = await readJson(req, 5 * 1024 * 1024); } catch (e) {
    return send(res, 413, { ok: false, error: e && e.message === 'payload_too_large' ? 'too_large' : 'invalid_body' });
  }
  const action = String(b.action || '');
  const box = boxOf(b.box);
  const uid = uidOf(b.uid);

  if (action === 'seen' || action === 'flag') {
    if (!uid) return send(res, 400, { ok: false, error: 'uid_required' });
    if (action === 'seen') await imap.setSeen(box, uid, b.value !== false);
    else await imap.setFlagged(box, uid, b.value !== false);
    return send(res, 200, { ok: true });
  }

  if (action === 'trash') {
    if (!uid) return send(res, 400, { ok: false, error: 'uid_required' });
    const moved = await imap.trashMessage(box, uid);
    return send(res, 200, { ok: true, moved });
  }

  if (action === 'send') {
    if (!mail.mailReady()) return send(res, 503, { ok: false, error: 'mail_not_configured' });

    const to = (Array.isArray(b.to) ? b.to : String(b.to || '').split(/[;,]/))
      .map((s) => clean(s, 200).trim()).filter(isEmail).slice(0, 20);
    if (!to.length) return send(res, 400, { ok: false, error: 'no_recipient' });

    const cc = (Array.isArray(b.cc) ? b.cc : String(b.cc || '').split(/[;,]/))
      .map((s) => clean(s, 200).trim()).filter(isEmail).slice(0, 20);

    const subject = clean(b.subject, 300) || '(sans objet)';
    const text = cleanMultiline(b.text, 20000);
    if (!text.trim()) return send(res, 400, { ok: false, error: 'empty_message' });

    let settings = null;
    try { settings = await store.getSettings(); } catch (e) { /* facultatif */ }

    const references = (Array.isArray(b.references) ? b.references : [])
      .map((r) => clean(r, 300)).filter(Boolean).slice(0, 30);

    let pieces;
    try { pieces = piecesJointes(b.attachments); }
    catch (e) { return send(res, 413, { ok: false, error: 'too_large' }); }

    let raw;
    try {
      raw = await mail.sendReply({
        settings, to, cc, subject, text,
        html: textToHtml(text),
        inReplyTo: clean(b.inReplyTo, 300) || '',
        references,
        attachments: pieces
      });
    } catch (e) {
      return send(res, 502, { ok: false, error: 'mail_error', detail: String((e && e.message) || e).slice(0, 200) });
    }

    // Le message part quoi qu'il arrive : le classement et le marquage ne
    // doivent jamais faire echouer un envoi deja abouti.
    let archived = false;
    try { archived = await imap.appendToSent(raw); } catch (e) { /* sans consequence */ }
    if (uid) { try { await imap.setAnswered(box, uid); } catch (e) { /* idem */ } }

    return send(res, 200, { ok: true, archived });
  }

  return send(res, 400, { ok: false, error: 'unknown_action' });
}

module.exports = async (req, res) => {
  if (!auth.requireAdmin(req, res)) return;
  if (!imap.imapReady()) return send(res, 503, { ok: false, error: 'imap_not_configured' });

  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET') return await handleGet(req, res, url);
    if (req.method === 'POST') return await handlePost(req, res);
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (e) {
    return fail(res, e);
  }
};
