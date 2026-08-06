// Envoi d'e-mails en SMTP.
//
// Configuration recommandee — la boite Zimbra du domaine, chez OVH :
//   SMTP_HOST = ssl0.ovh.net
//   SMTP_PORT = 587
//   SMTP_USER = contact@maison-solstice.fr   (l'adresse complete)
//   SMTP_PASS = le mot de passe de la boite
//   OWNER_EMAIL = l'adresse qui recoit les notifications de commande
//
// A defaut, l'ancienne configuration Gmail (GMAIL_USER + GMAIL_APP_PASSWORD)
// reste acceptee : rien ne casse tant que la bascule n'est pas faite.
const nodemailer = require('nodemailer');
const { escapeHtml, euros } = require('./util');
const { computeInvoice } = require('./invoice');

let _transport = null;

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function mailReady() {
  return smtpConfigured() || Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/* L'adresse d'expedition reelle, celle qui authentifie la connexion SMTP. */
function senderAddress() {
  return (smtpConfigured() ? process.env.SMTP_USER : process.env.GMAIL_USER) || '';
}

function ownerAddress() {
  return process.env.OWNER_EMAIL || senderAddress();
}

function getTransport() {
  // Injection d'un transport mock en test.
  if (global.__solMockTransport) return global.__solMockTransport;
  if (_transport) return _transport;
  if (!mailReady()) throw new Error('mail_not_configured');
  if (smtpConfigured()) {
    const port = Number(process.env.SMTP_PORT) || 587;
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // 465 = SSL implicite ; 587 = STARTTLS, negocie apres la connexion.
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  } else {
    _transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
  }
  return _transport;
}

function fromHeader(settings) {
  const name = (settings && settings.companyName && !/COMPLÉTER/.test(settings.companyName)) ? settings.companyName : 'Maison Solstice';
  return `"${name.replace(/"/g, '')}" <${senderAddress()}>`;
}

/* Compose le message puis l'envoie, et renvoie sa source brute — de quoi le
   recopier ensuite dans le dossier « Envoyés » de la boite, pour qu'il s'y
   retrouve depuis le webmail ou le telephone comme n'importe quel envoi. */
async function sendAndBuild(message) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  const raw = await new Promise((resolve, reject) => {
    new MailComposer(message).compile().build((err, buf) => (err ? reject(err) : resolve(buf)));
  });
  const envelope = {
    from: senderAddress(),
    to: [].concat(message.to || [], message.cc || [], message.bcc || []).filter(Boolean)
  };
  await getTransport().sendMail({ envelope, raw });
  return raw;
}

function wrap(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#F5EEE1;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#221C15;">
  <div style="max-width:560px;margin:0 auto;background:#FBF8F2;border:1px solid #E6DCCB;border-radius:16px;overflow:hidden;">
    <div style="background:#221C15;color:#E9DFCB;padding:16px 24px;font-size:13px;letter-spacing:.28em;text-transform:uppercase;">Maison Solstice</div>
    <div style="padding:24px 26px;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:22px;margin:0 0 14px;color:#221C15;">${escapeHtml(title)}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:14px 26px;border-top:1px solid #E6DCCB;color:#8d836f;font-size:11px;">Maison Solstice — Location de mobilier &amp; décoration, Amiens et ses alentours.</div>
  </div></body></html>`;
}

async function sendOwnerNotification(request, baseUrl) {
  const c = request.client || {};
  const ev = request.event || {};
  const items = (request.items || []).map((i) =>
    `<li>${escapeHtml(i.name)} ${i.qty ? '× ' + escapeHtml(String(i.qty)) : ''}</li>`).join('');
  const rows = [
    ['Client', escapeHtml(c.name || '')],
    ['E-mail', escapeHtml(c.email || '')],
    ['Téléphone', escapeHtml(c.phone || '—')],
    ['Événement', escapeHtml(ev.type || '—')],
    ['Date', escapeHtml(ev.date || '—')],
    ['Lieu', escapeHtml(ev.location || '—')],
    ['Invités', escapeHtml(String(ev.guests || '—'))]
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6F6455;">${k}</td><td style="padding:4px 0;"><b>${v}</b></td></tr>`).join('');
  const link = baseUrl ? `${baseUrl}/admin` : '/admin';
  const body = `
    <p style="margin:0 0 12px;">Nouvelle demande <b>${escapeHtml(request.ref || '')}</b>.</p>
    <table style="font-size:14px;border-collapse:collapse;margin-bottom:14px;">${rows}</table>
    ${items ? `<p style="margin:0 0 6px;color:#6F6455;">Sélection :</p><ul style="margin:0 0 14px;padding-left:18px;">${items}</ul>` : ''}
    ${request.message ? `<p style="margin:0 0 14px;color:#6F6455;">Message :</p><blockquote style="margin:0 0 14px;padding:10px 14px;background:#F5EEE1;border-radius:10px;">${escapeHtml(request.message)}</blockquote>` : ''}
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#221C15;color:#FBF8F2;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:13px;">Ouvrir le back-office</a>`;
  await getTransport().sendMail({
    from: fromHeader(null),
    to: ownerAddress(),
    replyTo: c.email || undefined,
    subject: `Nouvelle demande — ${c.name || 'client'} (${request.ref || ''})`,
    html: wrap('Nouvelle demande', body)
  });
}

/* `opts.bccOwner` : copie cachee au gerant. Inutile quand la messagerie IMAP
   est branchee — l'envoi se retrouve alors dans « Envoyés », sans encombrer
   la boite de reception. */
async function sendFactureEmail(request, settings, reply, pdfBuffer, opts) {
  const c = request.client || {};
  const q = computeInvoice(reply.lines, reply.depositPct);
  const rows = q.items.map((it) =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #E6DCCB;">${escapeHtml(it.label)}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #E6DCCB;text-align:right;">${escapeHtml(String(it.qty))}</td>
     <td style="padding:6px 10px;border-bottom:1px solid #E6DCCB;text-align:right;">${euros(it.total)}</td></tr>`).join('');
  const msgHtml = escapeHtml(reply.message || '').replace(/\n/g, '<br>');
  const body = `
    ${reply.message ? `<p style="margin:0 0 16px;line-height:1.6;">${msgHtml}</p>` : ''}
    <p style="margin:0 0 8px;color:#6F6455;font-size:13px;">Votre facture <b>${escapeHtml(reply.invoiceNumber || reply.quoteNumber || request.ref || '')}</b> est jointe en PDF. Récapitulatif :</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:12px;">
      <thead><tr>
        <th style="text-align:left;padding:6px 10px;color:#6F6455;font-weight:600;border-bottom:2px solid #B08A54;">Désignation</th>
        <th style="text-align:right;padding:6px 10px;color:#6F6455;font-weight:600;border-bottom:2px solid #B08A54;">Qté</th>
        <th style="text-align:right;padding:6px 10px;color:#6F6455;font-weight:600;border-bottom:2px solid #B08A54;">Total HT</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:0 0 4px;text-align:right;font-size:15px;"><b>Total : ${euros(q.subtotal)}</b></p>
    ${q.depositPct > 0 ? `<p style="margin:0 0 2px;text-align:right;color:#6F6455;font-size:13px;">Acompte ${q.depositPct}% à régler maintenant : <b style="color:#221C15;">${euros(q.deposit)}</b></p>
    <p style="margin:0 0 16px;text-align:right;color:#6F6455;font-size:13px;">Solde ${100 - q.depositPct}% à la livraison : ${euros(q.balance)}</p>` : ''}
    <p style="margin:16px 0 0;color:#6F6455;font-size:12px;">Votre réservation est confirmée à réception de l'acompte. Pour toute question, répondez simplement à cet e-mail.</p>`;
  return sendAndBuild({
    from: fromHeader(settings),
    to: c.email,
    bcc: (opts && opts.bccOwner) ? (ownerAddress() || undefined) : undefined,
    replyTo: (settings && settings.email) || ownerAddress() || undefined,
    subject: `Votre facture Maison Solstice — ${reply.invoiceNumber || reply.quoteNumber || request.ref || ''}`,
    html: wrap('Votre facture', body),
    attachments: [{ filename: `Facture-Maison-Solstice-${reply.invoiceNumber || reply.quoteNumber || request.ref || 'facture'}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
  });
}

/* Reponse libre a un e-mail recu, depuis la messagerie du back-office. */
async function sendReply(opts) {
  return sendAndBuild({
    from: fromHeader(opts.settings),
    to: opts.to,
    cc: opts.cc && opts.cc.length ? opts.cc : undefined,
    replyTo: (opts.settings && opts.settings.email) || undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html || undefined,
    inReplyTo: opts.inReplyTo || undefined,
    references: opts.references && opts.references.length ? opts.references : undefined,
    attachments: opts.attachments && opts.attachments.length ? opts.attachments : undefined
  });
}

module.exports = { mailReady, ownerAddress, sendOwnerNotification, sendFactureEmail, sendReply };
