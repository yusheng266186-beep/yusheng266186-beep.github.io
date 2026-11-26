'use strict';

const http = require('node:http');
const {createHash, timingSafeEqual} = require('node:crypto');
const {COSStore} = require('./store.cjs');
const {createAdminSession} = require('./admin-session.cjs');
const {createControl} = require('./codex-accounts.cjs');
const {snapshot, publicCatalog} = require('./model-control.cjs');
const {completeRemote, completeGemini} = require('./model-completion.cjs');
const {completeKimi} = require('./kimi.cjs');

const env = process.env;
const origin = 'https://yusheng266186-beep.github.io';
const store = new COSStore({prefix: 'training-control-v1/'});
const adminSessions = createAdminSession({store, env});
const quotaJobs = {
  get: key => store.get('aurum-model/' + key),
  create: (key, value) => store.create('aurum-model/' + key, value)
};
const accounts = createControl({
  env, jobStore: quotaJobs, owner: 'quota',
  async dispatch(key) {
    const job = (await quotaJobs.get(key + '/meta.json'))?.value;
    if (job?.type !== 'codex-quota') throw problem('CODEX_OPERATION_NOT_FOUND', 404);
    await accounts.run(key, job);
  }
});
const defaults = {
  provider: 'openai-codex', model: 'gpt-6.1-terra', effort: 'max',
  accountId: env.AURUM_DEFAULT_ACCOUNT_ID
};
const probePrompt = {
  system: '只输出 JSON 对象，字段 value 是整数。计算 37 乘 19。禁止 Markdown 和代码围栏。',
  input: {task: '37×19'}, outputFormat: 'html'
};
const bytes = value => createHash('sha256').update(value).digest();
const problem = (message, status = 400) => Object.assign(Error(message), {status});
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const checkedKey = (secret, digest) => /^[a-f0-9]{64}$/.test(digest || '') &&
  typeof secret === 'string' && timingSafeEqual(bytes(secret), Buffer.from(digest, 'hex'));

function send(res, status, value) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'});
  res.end(status === 204 ? undefined : JSON.stringify(value));
}

async function json(req, limit = 256 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw problem('JSON_REQUIRED', 415);
  let size = 0;
  const parts = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > limit) { req.resume(); throw problem('REQUEST_TOO_LARGE', 413); }
    parts.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(parts)); } catch { throw problem('INVALID_JSON'); }
  if (!object(value)) throw problem('INVALID_JSON');
  return value;
}

function revisionKey(revision) {
  return 'aurum-model/revisions/' + String(revision).padStart(10, '0') + '.json';
}

async function current() {
  let low = 0, high = 1;
  while (await store.get(revisionKey(high))) { low = high; high = high * 2 + 1; }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await store.get(revisionKey(mid))) low = mid;
    else high = mid;
  }
  return low ? (await store.get(revisionKey(low))).value : {revision: 0, selection: defaults, updatedAt: null};
}

async function resolveGeneration(selection) {
  if (!object(selection) || Object.keys(selection).some(key => !['provider', 'model', 'effort', 'accountId'].includes(key)) ||
      ['provider', 'model', 'effort'].some(key => typeof selection[key] !== 'string') || selection.provider === 'openai-chatgpt' || selection.effort === 'ultra') {
    throw problem('MODEL_SELECTION_INVALID');
  }
  const {provider, model, effort, accountId} = selection;
  const generation = snapshot({provider, model, effort});
  if (provider === 'openai-codex') {
    if (!/^[a-f0-9]{32}$/.test(accountId || '')) throw problem('ACCOUNT_REQUIRED');
    return accounts.bind({...generation, codexAccountId: accountId});
  }
  if (accountId != null) throw problem('MODEL_SELECTION_INVALID');
  return generation;
}

async function complete(prompt, generation, signal, probe = false) {
  const options = {key: env[generation.credentialRef], signal, probe};
  if (generation.protocol === 'kimi') {
    return completeKimi(prompt, {...options, kind: 'code', model: generation.model, effort: generation.reasoningEffort});
  }
  if (generation.protocol === 'gemini') return completeGemini(prompt, generation, options);
  return completeRemote(prompt, generation, options);
}

function modelInfo(generation) {
  return {provider: generation.provider, model: generation.model, reasoningEffort: generation.reasoningEffort};
}

async function state() {
  const [active, pool] = await Promise.all([current(), accounts.accounts()]);
  const providers = publicCatalog().map(provider => ({
    id: provider.id, label: provider.label, configured: provider.configured,
    defaultModel: provider.defaultModel,
    models: provider.models.map(({id, name, efforts}) => ({
      id, name, efforts: Object.fromEntries(Object.entries(efforts).filter(([key]) => key !== 'ultra'))
    }))
  }));
  return {active, providers, accounts: pool.accounts, accountRevision: pool.revision};
}

async function handle(req, res) {
  if (req.headers.origin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (req.headers.origin) {
    return send(res, 403, {error: 'ORIGIN_NOT_ALLOWED'});
  }
  const path = new URL(req.url, 'http://localhost').pathname;
  const accountId = /^\/admin\/accounts\/([a-f0-9]{32})\/quota$/.exec(path)?.[1];
  const readOnly = ['/admin/state', '/runner/config'].includes(path);
  if (!readOnly && !accountId && !['/admin/session', '/admin/logout', '/admin/switch', '/admin/test', '/runner/research'].includes(path)) {
    return send(res, 404, {error: 'NOT_FOUND'});
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID');
    return send(res, 204, null);
  }
  if (req.method !== (readOnly ? 'GET' : 'POST')) return send(res, 405, {error: 'METHOD_NOT_ALLOWED'});
  if (path === '/admin/session') return send(res, 200, await adminSessions.login(await json(req, 1024)));
  const runner = path.startsWith('/runner/');
  let adminSession;
  if (runner) {
    const secret = /^Bearer ([A-Za-z0-9_-]{25,128})$/.exec(req.headers.authorization || '')?.[1];
    if (!checkedKey(secret, env.AURUM_RUNNER_DIGEST)) return send(res, 401, {error: 'AUTH_REQUIRED'});
  } else {
    adminSession = await adminSessions.authenticate(req.headers.authorization);
  }
  if (path === '/admin/state') return send(res, 200, await state());
  if (path === '/admin/logout') {
    await adminSessions.logout(adminSession);
    return send(res, 200, {signedOut: true});
  }
  if (accountId) {
    const input = await json(req, 1024);
    const queued = await accounts.queueAccount(accountId, 'quota', input, req.headers['x-request-id']);
    const result = await accounts.operation(queued.id);
    if (result.status === 'failed') {
      const status = result.error === 'CODEX_ACCOUNT_BUSY' || result.error === 'CODEX_ACCOUNT_REAUTH_REQUIRED' ? 409 : 502;
      throw problem(result.error, status);
    }
    if (result.status !== 'ready') throw problem('CODEX_ACCOUNT_BUSY', 409);
    const pool = await accounts.accounts();
    const account = pool.accounts.find(row => row.id === accountId);
    if (!account) throw problem('CODEX_ACCOUNT_NOT_FOUND', 404);
    return send(res, 200, {account, accountRevision: pool.revision});
  }
  if (path === '/runner/config') {
    const {revision, selection} = await current();
    return send(res, 200, {...modelInfo(await resolveGeneration(selection)), revision});
  }

  const disconnected = new AbortController();
  res.once('close', () => disconnected.abort());
  const body = await json(req);
  if (path === '/admin/switch') {
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw problem('INVALID_REVISION');
    await resolveGeneration(body.selection);
    if (body.expectedRevision !== (await current()).revision) throw problem('REVISION_CONFLICT', 409);
    const next = {revision: body.expectedRevision + 1, selection: body.selection, updatedAt: new Date().toISOString()};
    if (!await store.create(revisionKey(next.revision), next)) throw problem('REVISION_CONFLICT', 409);
    return send(res, 200, next);
  }
  const deadline = AbortSignal.timeout(runner ? 260_000 : 66_000);
  const signal = AbortSignal.any([disconnected.signal, deadline]);
  if (path === '/admin/test') {
    const generation = await resolveGeneration(body.selection);
    const started = Date.now(), response = await complete(probePrompt, generation, signal, true);
    let result;
    try { result = JSON.parse(response.output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch {}
    if (result?.value !== 703) throw problem('MODEL_CONTENT_INVALID', 502);
    return send(res, 200, {...modelInfo(generation), latencyMs: Date.now() - started});
  }
  if (!object(body.input) || !Array.isArray(body.input.evidence) || !body.input.evidence.length || body.input.evidence.length > 60) throw problem('EVIDENCE_INVALID');
  const {SYSTEM, BULK_SYSTEM} = await import('./research-prompt.mjs');
  const {selection, revision} = await current();
  if (body.expectedRevision !== undefined && body.expectedRevision !== revision) throw problem('MODEL_REVISION_CONFLICT', 409);
  const generation = await resolveGeneration(selection);
  const system = body.expectedRevision === undefined ? SYSTEM : BULK_SYSTEM;
  let response;
  try {
    response = await complete({system, input: body.input, outputFormat: 'html'}, generation, signal);
  } catch (error) {
    if (deadline.aborted) throw problem('MODEL_UPSTREAM_TIMEOUT', 504);
    throw error;
  }
  if (typeof response.output !== 'string' || !response.output.trim() || response.output.length > 160_000) throw problem('MODEL_INCOMPLETE', 502);
  const usage = Object.fromEntries(['input', 'output', 'thinking'].map(key => [key, Number(response.usage?.[key]) || 0]));
  return send(res, 200, {...modelInfo(generation), revision, output: response.output, usage});
}

http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (res.destroyed || res.headersSent) return;
    const code = /^[A-Z][A-Z0-9_]{2,58}$/.test(error.message) ? error.message : 'MODEL_SERVICE_UNAVAILABLE';
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 502;
    if (status >= 500) console.error(JSON.stringify({code, phase: error.diagnostic?.phase, kind: error.diagnostic?.kind, upstreamStatus: error.diagnostic?.status}));
    send(res, status, {error: code});
  });
}).listen(Number(env.PORT) || 9000, '0.0.0.0');
