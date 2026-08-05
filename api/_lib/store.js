// Accès à la base de données (Supabase / Postgres, via l'API REST PostgREST).
// Le client @supabase/supabase-js fonctionne en HTTP (fetch), donc sans
// connexion persistante : idéal pour les fonctions serverless de Vercel.
//
// Variables d'environnement attendues :
//   SUPABASE_URL                 (ex. https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY    (clé "service_role" — usage serveur uniquement)
//
// Le schéma SQL à créer une fois dans Supabase est fourni dans
// supabase-schema.sql (à la racine du dépôt).

let _backend = null;

function creds() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY;
  return { url, key };
}

function storeReady() {
  if (global.__solMockBackend) return true; // injection en test
  const { url, key } = creds();
  return Boolean(url && key);
}

// Duplique quelques champs en colonnes (pour une jolie vue tableau dans
// Supabase) tout en conservant l'objet complet dans `payload`.
function rowFromObj(obj) {
  const c = obj.client || {};
  const e = obj.event || {};
  return {
    id: obj.id,
    ref: obj.ref || null,
    created_at: obj.createdAt || null,
    status: obj.status || 'new',
    client_name: c.name || null,
    client_email: c.email || null,
    event_type: e.type || null,
    event_date: e.date || null,
    event_location: e.location || null,
    payload: obj
  };
}

// Petit backend interne (6 méthodes) : facile à mocker en test, et
// implémenté sur Supabase en production.
function supabaseBackend(sb) {
  return {
    async nextId() {
      const { data, error } = await sb.rpc('next_devis_id');
      if (error) throw new Error('store_error: ' + error.message);
      return Number(data);
    },
    async putRequest(obj) {
      const { error } = await sb.from('devis_requests').upsert(rowFromObj(obj), { onConflict: 'id' });
      if (error) throw new Error('store_error: ' + error.message);
    },
    async getRequest(id) {
      const { data, error } = await sb.from('devis_requests').select('payload').eq('id', id).maybeSingle();
      if (error) throw new Error('store_error: ' + error.message);
      return data ? data.payload : null;
    },
    async listRequests(limit) {
      const { data, error } = await sb
        .from('devis_requests').select('payload')
        .order('id', { ascending: false }).limit(limit);
      if (error) throw new Error('store_error: ' + error.message);
      return (data || []).map((r) => r.payload).filter(Boolean);
    },
    async getSettingsRow() {
      const { data, error } = await sb.from('devis_settings').select('data').eq('id', 1).maybeSingle();
      if (error) throw new Error('store_error: ' + error.message);
      return data ? data.data : null;
    },
    async putSettingsRow(dataObj) {
      const { error } = await sb.from('devis_settings').upsert({ id: 1, data: dataObj }, { onConflict: 'id' });
      if (error) throw new Error('store_error: ' + error.message);
    }
  };
}

function getBackend() {
  if (_backend) return _backend;
  if (global.__solMockBackend) { _backend = global.__solMockBackend; return _backend; }
  const { url, key } = creds();
  if (!url || !key) throw new Error('store_not_configured');
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  _backend = supabaseBackend(sb);
  return _backend;
}

async function nextId() {
  return getBackend().nextId();
}

async function saveNewRequest(obj) {
  await getBackend().putRequest(obj);
  return obj;
}

async function getRequest(id) {
  return getBackend().getRequest(id);
}

async function updateRequest(obj) {
  await getBackend().putRequest(obj);
  return obj;
}

async function listRequests(limit = 300) {
  return getBackend().listRequests(limit);
}

const DEFAULT_SETTINGS = {
  companyName: '[À COMPLÉTER — nom / dénomination]',
  legalForm: '[À COMPLÉTER — micro-entreprise / EI / société]',
  siret: '[À COMPLÉTER — SIRET]',
  address: '[À COMPLÉTER — adresse]',
  postcode: '',
  city: 'Amiens',
  email: '',
  phone: '',
  website: '',
  tvaMention: 'TVA non applicable, art. 293 B du CGI',
  quotePrefix: 'F',
  validityDays: 30,
  depositPct: 50,
  // Mentions legales obligatoires sur une facture.
  latePenalty:
    'En cas de retard de paiement, une pénalité au taux de trois fois l\'intérêt légal est exigible, ainsi qu\'une indemnité forfaitaire de 40 € pour frais de recouvrement pour les clients professionnels (art. L441-10 du Code de commerce). Pas d\'escompte pour paiement anticipé.',
  paymentNote:
    'Acompte de 50 % à la commande, solde de 50 % à la livraison.',
  cautionNote: 'Une caution peut être demandée selon les pièces louées.',
  conditions:
    'La réservation est confirmée à réception de l\'acompte. Retrait à l\'atelier ou livraison à Amiens et ses alentours (frais selon distance). Une caution peut être demandée selon les pièces louées ; elle est restituée au retour du matériel en bon état.'
};

async function getSettings() {
  const s = await getBackend().getSettingsRow();
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
}

async function saveSettings(obj) {
  const merged = Object.assign({}, DEFAULT_SETTINGS, obj || {});
  await getBackend().putSettingsRow(merged);
  return merged;
}

module.exports = {
  storeReady, nextId, saveNewRequest, getRequest, updateRequest,
  listRequests, getSettings, saveSettings, DEFAULT_SETTINGS
};
