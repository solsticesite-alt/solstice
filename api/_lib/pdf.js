// Genere le PDF du devis avec pdfkit (polices integrees, aucun asset externe).
const PDFDocument = require('pdfkit');
const { computeQuote } = require('./quote');

const GOLD = '#B08A54';
const GOLD_DEEP = '#8C6C3D';
const INK = '#221C15';
const SOFT = '#6F6455';
const LINE = '#E2D6BF';

function fmt(n) {
  return Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function dstr(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function buildDevisPdf(request, settings, reply) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
        Title: 'Devis ' + (reply.quoteNumber || request.ref || ''), Author: settings.companyName || 'Solstice'
      } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const q = computeQuote(reply.lines, reply.depositPct);
      const L = 50, R = 545, W = R - L;
      const client = request.client || {};
      const ev = request.event || {};

      // Saut de page si le contenu qui suit ne tient plus.
      function ensure(space) {
        if (y + space > 792) { doc.addPage(); y = 50; }
      }

      // ---------- En-tete ----------
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(settings.companyName || 'Solstice', L, 52, { width: 300 });
      doc.font('Helvetica').fontSize(8.5).fillColor(SOFT)
        .text('Location de mobilier & décoration d\'événements', L, 80, { width: 300 });

      doc.font('Helvetica-Bold').fontSize(26).fillColor(GOLD_DEEP).text('DEVIS', 350, 50, { width: 195, align: 'right' });
      doc.font('Helvetica').fontSize(9.5).fillColor(INK);
      const num = reply.quoteNumber || request.ref || '';
      const dateStr = dstr(reply.sentAt || Date.now());
      const valid = dstr(reply.validUntil);
      doc.text('N° ' + num, 350, 84, { width: 195, align: 'right' });
      doc.text('Date : ' + dateStr, 350, 98, { width: 195, align: 'right' });
      if (valid) doc.text('Valable jusqu\'au ' + valid, 350, 112, { width: 195, align: 'right' });

      doc.moveTo(L, 132).lineTo(R, 132).lineWidth(1.4).strokeColor(GOLD).stroke();

      // ---------- Emetteur / Client ----------
      let y = 148;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('PRESTATAIRE', L, y);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('CLIENT', 320, y);
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      const emitter = [
        settings.companyName, settings.legalForm,
        settings.address, [settings.postcode, settings.city].filter(Boolean).join(' '),
        settings.siret ? 'SIRET ' + settings.siret : '',
        settings.email, settings.phone
      ].filter(Boolean).join('\n');
      const cl = [client.name, client.email, client.phone].filter(Boolean).join('\n');
      const eH = doc.heightOfString(emitter, { width: 230 });
      const cH = doc.heightOfString(cl || '—', { width: 225 });
      doc.text(emitter, L, y + 13, { width: 230 });
      doc.text(cl || '—', 320, y + 13, { width: 225 });
      y = y + 13 + Math.max(eH, cH) + 20;

      // ---------- Mot d'accompagnement (message au client) ----------
      // Le message du client (request.message) n'apparait volontairement PAS
      // ici : c'est le mot de l'atelier (reply.message) qui figure sur le devis.
      if (reply.message) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('MESSAGE', L, y);
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(reply.message, L, y + 13, { width: W });
        y = doc.y + 18;
      }

      // ---------- Details evenement ----------
      const evLines = [];
      if (ev.type) evLines.push('Type : ' + ev.type);
      if (ev.date) evLines.push('Date : ' + dstr(ev.date));
      if (ev.location) evLines.push('Lieu : ' + ev.location);
      if (ev.guests) evLines.push('Invités : ' + ev.guests);
      if (evLines.length) {
        ensure(40);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('ÉVÉNEMENT', L, y);
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(evLines.join('    '), L, y + 13, { width: W });
        y = doc.y + 18;
      }

      // ---------- Tableau ----------
      const cQty = 330, cUnit = 390, cTot = 470; // x de debut des colonnes chiffres
      const wLabel = cQty - L - 10;
      function tableHeader(yy) {
        doc.rect(L, yy, W, 22).fill('#F3EBDB');
        doc.fillColor(GOLD_DEEP).font('Helvetica-Bold').fontSize(8.5);
        doc.text('DÉSIGNATION', L + 8, yy + 7, { width: wLabel });
        doc.text('QTÉ', cQty, yy + 7, { width: cUnit - cQty - 6, align: 'right' });
        doc.text('P.U. HT', cUnit, yy + 7, { width: cTot - cUnit - 6, align: 'right' });
        doc.text('TOTAL HT', cTot, yy + 7, { width: R - cTot - 4, align: 'right' });
        return yy + 22;
      }
      ensure(60);
      y = tableHeader(y);

      doc.font('Helvetica').fontSize(9.5).fillColor(INK);
      if (!q.items.length) {
        doc.fillColor(SOFT).text('(aucune ligne)', L + 8, y + 8, { width: wLabel });
        y += 26;
      }
      q.items.forEach((it, i) => {
        const lh = doc.heightOfString(it.label, { width: wLabel, lineGap: 1 });
        const rowH = Math.max(22, lh + 12);
        if (y + rowH > 760) { doc.addPage(); y = 50; y = tableHeader(y); }
        if (i % 2 === 1) doc.rect(L, y, W, rowH).fill('#FBF6EC');
        doc.fillColor(INK).font('Helvetica').fontSize(9.5);
        doc.text(it.label, L + 8, y + 6, { width: wLabel, lineGap: 1 });
        doc.text(String(it.qty), cQty, y + 6, { width: cUnit - cQty - 6, align: 'right' });
        doc.text(fmt(it.unit), cUnit, y + 6, { width: cTot - cUnit - 6, align: 'right' });
        doc.font('Helvetica-Bold').text(fmt(it.total), cTot, y + 6, { width: R - cTot - 4, align: 'right' });
        y += rowH;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
      });

      // ---------- Totaux ----------
      y += 12;
      ensure(80);
      const boxX = 320;
      function totalRow(label, value, bold) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(bold ? INK : SOFT);
        doc.text(label, boxX, y, { width: cTot - boxX - 6, align: 'right' });
        doc.fillColor(INK).text(value, cTot, y, { width: R - cTot - 4, align: 'right' });
        y += bold ? 20 : 16;
      }
      totalRow('Sous-total HT', fmt(q.subtotal));
      totalRow('TVA', 'Non applicable');
      totalRow('TOTAL', fmt(q.subtotal), true);
      if (q.depositPct > 0) totalRow('Acompte (' + q.depositPct + '%)', fmt(q.deposit));

      // ---------- Notes ----------
      y += 8;
      if (reply.notes) {
        ensure(50);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('NOTE', L, y);
        doc.font('Helvetica').fontSize(9).fillColor(INK).text(reply.notes, L, y + 12, { width: W });
        y = doc.y + 14;
      }

      // ---------- Conditions ----------
      if (settings.conditions) {
        ensure(60);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('CONDITIONS', L, y);
        doc.font('Helvetica').fontSize(8).fillColor(SOFT).text(settings.conditions, L, y + 12, { width: W });
        y = doc.y + 6;
      }

      // ---------- Bon pour accord (valeur contractuelle) ----------
      y += 14;
      ensure(90);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GOLD_DEEP).text('BON POUR ACCORD', L, y);
      doc.font('Helvetica').fontSize(8).fillColor(SOFT).text(
        'Pour confirmer votre réservation, retournez ce devis daté et signé, précédé de la mention manuscrite « Bon pour accord ».',
        L, y + 12, { width: W });
      y = doc.y + 16;
      doc.font('Helvetica').fontSize(9).fillColor(INK);
      doc.text('Date :', L, y);
      doc.text('Signature :', 320, y);
      doc.moveTo(L + 36, y + 11).lineTo(270, y + 11).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.moveTo(320 + 52, y + 11).lineTo(R, y + 11).lineWidth(0.6).strokeColor(LINE).stroke();
      y += 34;

      // ---------- Pied de page legal ----------
      const foot = [
        settings.companyName, settings.legalForm,
        settings.siret ? 'SIRET ' + settings.siret : '',
        settings.tvaMention
      ].filter(Boolean).join(' · ');
      ensure(30);
      doc.font('Helvetica').fontSize(7).fillColor(SOFT).text(foot, L, Math.max(y + 12, 60), { width: W, align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { buildDevisPdf };
