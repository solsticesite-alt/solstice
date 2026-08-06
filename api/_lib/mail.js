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
  const lignes = [
    `Nouvelle demande ${request.ref || ''}.`, '',
    `Client   : ${c.name || ''}`,
    `E-mail   : ${c.email || ''}`,
    `Téléphone: ${c.phone || '—'}`,
    `Événement: ${ev.type || '—'}`,
    `Date     : ${ev.date || '—'}`,
    `Lieu     : ${ev.location || '—'}`,
    `Invités  : ${ev.guests || '—'}`
  ];
  if ((request.items || []).length) {
    lignes.push('', 'Sélection :');
    (request.items || []).forEach((i) => lignes.push(`  - ${i.name}${i.qty ? ' x ' + i.qty : ''}`));
  }
  if (request.message) lignes.push('', 'Message :', request.message);
  lignes.push('', `Ouvrir le back-office : ${link}`);

  await getTransport().sendMail({
    from: fromHeader(null),
    to: ownerAddress(),
    replyTo: c.email || undefined,
    subject: `Nouvelle demande — ${c.name || 'client'} (${request.ref || ''})`,
    text: lignes.join('\n'),
    html: wrap('Nouvelle demande', body)
  });
}

/* `opts.bccOwner` : copie cachee au gerant. Inutile quand la messagerie IMAP
   est branchee — l'envoi se retrouve alors dans « Envoyés », sans encombrer
   la boite de reception.

   Le corps ne reproduit PAS la facture : elle est en piece jointe, et la
   recopier ligne a ligne dans le message la rendait illisible et faisait
   doublon. Le message explique, le PDF fait foi. */
async function sendFactureEmail(request, settings, reply, pdfBuffer, opts) {
  const c = request.client || {};
  const q = computeInvoice(reply.lines, reply.depositPct);
  const numero = reply.invoiceNumber || reply.quoteNumber || request.ref || '';
  const prenom = String(c.name || '').trim().split(/\s+/)[0] || '';
  const fichier = `Facture-Maison-Solstice-${numero || 'facture'}.pdf`;

  const reglement = q.depositPct > 0 && q.depositPct < 100
    ? `Pour confirmer votre réservation, un acompte de ${euros(q.deposit)} (${q.depositPct} %) est à régler dès maintenant. Le solde, ${euros(q.balance)}, sera dû à la livraison.`
    : `Le montant est à régler en totalité pour confirmer votre réservation.`;

  const paragraphes = [
    reply.message || `Bonjour${prenom ? ' ' + prenom : ''},`,
    `Vous trouverez votre facture ${numero} en pièce jointe, au format PDF. Elle détaille l'ensemble des pièces retenues.`,
    `Son montant total s'élève à ${euros(q.subtotal)}. ${reglement}`,
    `Votre réservation devient ferme à réception du règlement. Pour toute question, il vous suffit de répondre à cet e-mail.`
  ];

  const html = wrap('Votre facture', paragraphes.map((t, i) =>
    `<p style="margin:0 0 ${i === paragraphes.length - 1 ? '0' : '14px'};line-height:1.65;${i > 0 ? 'color:#5B5142;' : ''}">${escapeHtml(t).replace(/\n/g, '<br>')}</p>`
  ).join('') +
    `<p style="margin:20px 0 0;padding:11px 14px;background:#F5EEE1;border-radius:10px;font-size:13px;color:#5B5142;">
       📎 Pièce jointe : <b style="color:#221C15;">${escapeHtml(fichier)}</b></p>`);

  return sendAndBuild({
    from: fromHeader(settings),
    to: c.email,
    bcc: (opts && opts.bccOwner) ? (ownerAddress() || undefined) : undefined,
    replyTo: (settings && settings.email) || ownerAddress() || undefined,
    subject: `Votre facture Maison Solstice — ${numero}`,
    // Une version texte accompagne toujours le HTML : sans elle, le message
    // est mal note par les filtres et illisible dans un client sans HTML.
    text: paragraphes.join('\n\n') + `\n\nPièce jointe : ${fichier}\n\n-- \nMaison Solstice — location de mobilier et décoration, Amiens et alentours.`,
    html,
    attachments: [{ filename: fichier, content: pdfBuffer, contentType: 'application/pdf' }]
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
