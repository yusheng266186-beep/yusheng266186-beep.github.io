'use strict';

const {createHash, createHmac, randomUUID, timingSafeEqual} = require('node:crypto');
const {decodeSecret, matchingCounter, STEP_MS} = require('./totp.cjs');

const audience = 'aurum-model-admin';
const lifetime = 8 * 60 * 60 * 1000;
const prefix = 'aurum-model/admin/';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const problem = (message, status) => Object.assign(Error(message), {status});

function createAdminSession({store, env = process.env, now = Date.now}) {
  const secret = env.AURUM_TOTP_SECRET;
  const signingSecret = env.AURUM_SESSION_SECRET;
  const gate = secret ? digest(secret).slice(0, 20) : '';
  const sign = body => createHmac('sha256', signingSecret).update(audience + '\n' + body).digest();

  function configured() {
    if (!signingSecret || Buffer.byteLength(signingSecret) < 32) throw problem('AUTH_NOT_CONFIGURED', 503);
    try { decodeSecret(secret); } catch { throw problem('AUTH_NOT_CONFIGURED', 503); }
  }

  async function login(input) {
    configured();
    const code = typeof input?.code === 'string' ? input.code.trim() : '';
    if (Object.keys(input || {}).length !== 1 || !/^\d{6}$/.test(code)) throw problem('AUTH_INVALID', 401);
    const minute = Math.floor(now() / 60_000);
    let reserved = false;
    for (let slot = 0; slot < 10 && !reserved; slot++) {
      reserved = await store.create(prefix + 'attempts/' + minute + '/' + slot + '.json', {at: now()});
    }
    if (!reserved) throw problem('AUTH_RATE_LIMIT', 429);
    const counter = matchingCounter(secret, code, now());
    if (counter === null) throw problem('AUTH_INVALID', 401);
    const usedKey = prefix + 'used/' + gate + '/' + counter + '-' + sign('totp:' + code).toString('hex') + '.json';
    const at = now();
    if (!await store.create(usedKey, {at})) throw problem('AUTH_REPLAY', 401);
    const payload = {v: 1, aud: audience, gate, sid: randomUUID(), iat: at, exp: at + lifetime};
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return {token: body + '.' + sign(body).toString('base64url'), expiresAt: payload.exp};
  }

  async function authenticate(header) {
    configured();
    const token = /^Bearer ([A-Za-z0-9_-]{1,700})\.([A-Za-z0-9_-]{43})$/.exec(header || '');
    if (!token) throw problem('AUTH_REQUIRED', 401);
    const [, body, signature] = token;
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== 32 || !timingSafeEqual(sign(body), supplied)) throw problem('AUTH_REQUIRED', 401);
    let payload;
    try { payload = JSON.parse(Buffer.from(body, 'base64url')); } catch { throw problem('AUTH_REQUIRED', 401); }
    const at = now();
    if (payload?.v !== 1 || payload.aud !== audience || payload.gate !== gate || !uuid.test(payload.sid || '') ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat > at + STEP_MS ||
        payload.exp <= at || payload.exp - payload.iat !== lifetime) throw problem('AUTH_REQUIRED', 401);
    if (await store.get(prefix + 'revoked/' + payload.sid + '.json')) throw problem('AUTH_REQUIRED', 401);
    return payload;
  }

  async function logout(session) {
    await store.create(prefix + 'revoked/' + session.sid + '.json', {at: now(), expiresAt: session.exp});
  }

  return {login, authenticate, logout};
}

module.exports = {createAdminSession};
