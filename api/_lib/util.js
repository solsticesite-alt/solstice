// Petites fonctions utilitaires partagees par les fonctions serverless.

function readJson(req, limitBytes = 1024 * 512) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string' && req.body.length) {
      try { return resolve(JSON.parse(req.body)); } catch (e) { return reject(new Error('invalid_json')); }
    }
    let data = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limitBytes) { reject(new Error('payload_too_large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function parseCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; } }
  });
  return out;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clean(v, max = 2000) {
  if (v == null) return '';
  let s = String(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function cleanMultiline(v, max = 4000) {
  if (v == null) return '';
  let s = String(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

function toNumber(v, def = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : def;
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

function euros(n) {
  const v = toNumber(n, 0);
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function slugify(s) {
  const base = clean(s, 80).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
  return base || 'piece';
}

module.exports = { readJson, send, parseCookies, escapeHtml, clean, cleanMultiline, isEmail, toNumber, euros, slugify };
