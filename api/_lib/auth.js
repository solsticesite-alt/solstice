// Authentification admin minimale : un mot de passe unique -> cookie signe (HMAC).
const crypto = require('crypto');
const { parseCookies, send } = require('./util');

const COOKIE = 'sol_admin';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 jours

function secret() {
  return (
    process.env.SESSION_SECRET ||
    (process.env.ADMIN_PASSWORD ? 'derived:' + process.env.ADMIN_PASSWORD : '') ||
    'solstice-insecure-fallback-change-me'
  );
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmac(data) {
  return b64url(crypto.createHmac('sha256', secret()).update(data).digest());
}

function makeToken() {
  const payload = b64url(JSON.stringify({ v: 1, iat: Date.now() }));
  return payload + '.' + hmac(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!data || data.v !== 1 || typeof data.iat !== 'number') return false;
    if (Date.now() - data.iat > MAX_AGE * 1000) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  return verifyToken(cookies[COOKIE]);
}

function setSession(res) {
  const parts = [
    `${COOKIE}=${makeToken()}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${MAX_AGE}`
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

// Verifie le mot de passe admin en temps constant.
function checkPassword(input) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Garde d'acces : renvoie true si autorise, sinon repond 401 et renvoie false.
function requireAdmin(req, res) {
  if (isAuthed(req)) return true;
  send(res, 401, { ok: false, error: 'unauthorized' });
  return false;
}

module.exports = { COOKIE, isAuthed, setSession, clearSession, checkPassword, requireAdmin, makeToken, verifyToken };
