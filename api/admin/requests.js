const { send } = require('../_lib/util');
const auth = require('../_lib/auth');
const store = require('../_lib/store');

/*
 * Les chiffres du tableau de bord, calcules ICI plutot que dans le navigateur.
 *
 * Deux raisons : le detail des pieces de chaque demande n'a pas a traverser le
 * reseau pour qu'on compte les plus demandees, et la liste est plafonnee a 400
 * entrees — un comptage cote navigateur porterait donc sur un echantillon sans
 * le dire. Ici on compte sur ce qu'on a lu, et on annonce sur quoi.
 */
function statistiques(all) {
  const now = Date.now();
  const jour = 24 * 3600 * 1000;
  const anneeCourante = new Date(now).getFullYear();

  const dateEvent = (r) => {
    const t = Date.parse((r.event || {}).date || '');
    return Number.isFinite(t) ? t : NaN;
  };
  const montantDe = (r) =>
    r.reply && typeof r.reply.total === 'number'
      ? r.reply.total
      : (typeof r.montant === 'number' ? r.montant : 0);

  let nouvelles = 0, aVenir = 0, enAttente = 0, montantAttente = 0;
  let factureAnnee = 0, nbFactures = 0, invitesTotal = 0, nbAvecInvites = 0;
  const parType = Object.create(null);
  const parMois = Object.create(null);
  const parPiece = Object.create(null);
  let prochain = null;

  for (const r of all) {
    if (r.status === 'new') nouvelles++;

    const te = dateEvent(r);
    const futur = Number.isFinite(te) && te >= now - jour; // le jour meme compte
    if (futur) {
      aVenir++;
      if (!prochain || te < dateEvent(prochain)) prochain = r;
      if (!r.reply) { enAttente++; montantAttente += montantDe(r); }
    }

    if (r.reply && typeof r.reply.total === 'number') {
      nbFactures++;
      const tf = Date.parse(r.reply.sentAt || r.createdAt || '');
      if (Number.isFinite(tf) && new Date(tf).getFullYear() === anneeCourante) {
        factureAnnee += r.reply.total;
      }
    }

    const type = ((r.event || {}).type || '').trim();
    if (type) parType[type] = (parType[type] || 0) + 1;

    const g = Number((r.event || {}).guests);
    if (Number.isFinite(g) && g > 0) { invitesTotal += g; nbAvecInvites++; }

    // Douze derniers mois, cle « AAAA-MM » pour un tri lexicographique sur.
    const tc = Date.parse(r.createdAt || '');
    if (Number.isFinite(tc) && now - tc < 366 * jour) {
      const d = new Date(tc);
      const cle = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      parMois[cle] = (parMois[cle] || 0) + 1;
    }

    for (const it of r.items || []) {
      const nom = (it.name || '').trim();
      if (!nom) continue;
      const q = Number(it.qty) || 0;
      if (!parPiece[nom]) parPiece[nom] = { nom, demandes: 0, quantite: 0 };
      parPiece[nom].demandes++;
      parPiece[nom].quantite += q;
    }
  }

  const classer = (obj, cle) =>
    Object.keys(obj).map((k) => (cle ? obj[k] : { nom: k, n: obj[k] }))
      .sort((a, b) => (b.n || b.demandes) - (a.n || a.demandes));

  // Les douze derniers mois, y compris ceux sans aucune demande : un trou dans
  // l'annee est une information, l'omettre ferait mentir la courbe.
  const mois = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const cle = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    mois.push({ cle, n: parMois[cle] || 0 });
  }

  return {
    total: all.length,
    nouvelles,
    aVenir,
    enAttente,
    montantAttente: Math.round(montantAttente * 100) / 100,
    factureAnnee: Math.round(factureAnnee * 100) / 100,
    nbFactures,
    // Part des demandes qui ont abouti a une facture.
    transformation: all.length ? Math.round((nbFactures / all.length) * 100) : 0,
    invitesMoyen: nbAvecInvites ? Math.round(invitesTotal / nbAvecInvites) : 0,
    prochainJours: prochain ? Math.round((dateEvent(prochain) - now) / jour) : null,
    prochainNom: prochain ? ((prochain.client || {}).name || '') : '',
    types: classer(parType).slice(0, 6),
    mois,
    /* Classees par NOMBRE DE DEMANDES, pas par quantite : une piece commandee
       par 80 se comparerait mal a une piece commandee par 2, et la plus
       courante passerait pour la plus demandee. */
    pieces: Object.keys(parPiece).map((k) => parPiece[k])
      .sort((a, b) => b.demandes - a.demandes || b.quantite - a.quantite).slice(0, 6)
  };
}

module.exports = async (req, res) => {
  if (!(await auth.requireAdmin(req, res))) return;
  if (!store.storeReady()) return send(res, 503, { ok: false, error: 'store_not_configured' });

  // Les durees de conservation annoncees dans la politique de confidentialite
  // doivent etre APPLIQUEES, pas seulement promises. Le balayage a lieu au plus
  // une fois par jour et ne doit jamais empecher la liste de s'afficher.
  let purgees = 0;
  try { purgees = await store.purgerPerimees(); } catch (e) { purgees = 0; }

  try {
    const all = await store.listRequests(400);
    const items = all.map((r) => ({
      id: r.id,
      ref: r.ref,
      createdAt: r.createdAt,
      status: r.status,
      clientName: (r.client || {}).name || '',
      // Sert a rapprocher une commande d'un e-mail recu, cote navigateur.
      clientEmail: ((r.client || {}).email || '').toLowerCase(),
      eventType: (r.event || {}).type || '',
      date: (r.event || {}).date || '',
      location: (r.event || {}).location || '',
      itemCount: (r.items || []).length,
      /* Le montant, pour que la liste dise en un coup d'oeil ce que pese une
         demande. Une facture deja emise fait foi sur l'estimation : c'est elle
         qui a ete envoyee au client. */
      montant: r.reply && typeof r.reply.total === 'number'
        ? r.reply.total
        : (typeof r.montant === 'number' ? r.montant : null),
      // Nombre de pieces encore sans tarif : le montant n'est alors qu'un minimum.
      aChiffrer: typeof r.aChiffrer === 'number'
        ? r.aChiffrer
        : (r.items || []).filter((it) => typeof it.price !== 'number').length,
      replied: Boolean(r.reply),
      // false uniquement si la notification a echoue ; absent = envoyee.
      notified: r.notified !== false
    }));
    return send(res, 200, { ok: true, items, stats: statistiques(all), purged: purgees });
  } catch (e) {
    return send(res, 500, { ok: false, error: 'store_error' });
  }
};

// Exposee pour les tests : le tableau de bord affiche des chiffres qu'on ne
// peut pas verifier a l'oeil, il faut pouvoir les eprouver.
module.exports.statistiques = statistiques;
