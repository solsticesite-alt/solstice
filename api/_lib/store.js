// Acces a la base de donnees (Upstash Redis / Vercel KV, via API REST HTTP).
// Compatible avec les variables d'environnement Vercel KV (KV_REST_API_*)
// ou Upstash directes (UPSTASH_REDIS_REST_*).

let _redis = null;

function storeReady() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return Boolean(url && token);
}

function getRedis() {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('store_not_configured');
  // Permet l'injection d'un client mock en test.
  if (process.env.__SOL_MOCK_REDIS__ && global.__solMockRedis) {
    _redis = global.__solMockRedis;
    return _redis;
  }
  const { Redis } = require('@upstash/redis');
  _redis = new Redis({ url, token });
  return _redis;
}

const K_SEQ = 'sol:seq';
const K_INDEX = 'sol:index';
const K_REQ = (id) => `sol:req:${id}`;
const K_SETTINGS = 'sol:settings';

// Upstash (de)serialise le JSON automatiquement, mais on securise si une
// valeur revient sous forme de chaine.
function asObj(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
  return v;
}

async function nextId() {
  const r = getRedis();
  const n = await r.incr(K_SEQ);
  return Number(n);
}

async function saveNewRequest(obj) {
  const r = getRedis();
  await r.set(K_REQ(obj.id), obj);
  await r.lpush(K_INDEX, obj.id);
  return obj;
}

async function getRequest(id) {
  const r = getRedis();
  return asObj(await r.get(K_REQ(id)));
}

async function updateRequest(obj) {
  const r = getRedis();
  await r.set(K_REQ(obj.id), obj);
  return obj;
}

async function listRequests(limit = 300) {
  const r = getRedis();
  const ids = await r.lrange(K_INDEX, 0, limit - 1);
  if (!ids || !ids.length) return [];
  const keys = ids.map((id) => K_REQ(id));
  const vals = await r.mget(...keys);
  return (vals || []).map(asObj).filter(Boolean);
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
  quotePrefix: 'D',
  validityDays: 30,
  depositPct: 30,
  cautionNote: 'Une caution peut être demandée selon les pièces louées.',
  conditions:
    'Devis gratuit et sans engagement, valable 30 jours. La réservation est confirmée à réception de l\'acompte. Retrait à l\'atelier ou livraison à Amiens et ses alentours (frais selon distance).'
};

async function getSettings() {
  const r = getRedis();
  const s = asObj(await r.get(K_SETTINGS));
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
}

async function saveSettings(obj) {
  const r = getRedis();
  const merged = Object.assign({}, DEFAULT_SETTINGS, obj || {});
  await r.set(K_SETTINGS, merged);
  return merged;
}

module.exports = {
  storeReady, getRedis, nextId, saveNewRequest, getRequest, updateRequest,
  listRequests, getSettings, saveSettings, DEFAULT_SETTINGS
};
