import {mountSelectMenu} from '../assets/control-select.js?v=5.4.0';

const endpoint = 'https://1459223409-lnoxklunue.ap-chengdu.tencentscf.com';
const storageKey = 'aurum.model-admin.session.v1';
const panel = document.getElementById('model-settings');
const drawer = panel.closest('.settings-drawer');
const $ = id => document.getElementById('modelAdmin-' + id);
const pickers = Object.fromEntries(['provider', 'model', 'effort', 'account'].map(id => [id, mountSelectMenu($(id))]));
const loginButton = $('login').querySelector('button[type="submit"]');
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const percent = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1});
let credentials, expiry, state, busy = false, restored = false, session = new AbortController();

const errors = {
  AUTH_REQUIRED: '会话已结束，请输入新的动态验证码。',
  AUTH_INVALID: '验证码无效或已过期，请核对验证器里的黄金后台条目。',
  AUTH_REPLAY: '这组验证码已使用，请等验证器换码。',
  AUTH_RATE_LIMIT: '尝试次数过多，请稍等一分钟再登录。',
  AUTH_NOT_CONFIGURED: '云端验证码服务暂不可用。',
  REVISION_CONFLICT: '云端配置已更新，请回读后重新选择。',
  MODEL_NOT_CONFIGURED: '所选服务当前没有可用凭据。',
  MODEL_AUTH_FAILED: '模型或账号的授权失败。',
  MODEL_RATE_LIMIT: '账号额度不足或当前繁忙。',
  CODEX_ACCOUNT_BUSY: '该账号正在处理另一项任务，请稍后校准。',
  CODEX_ACCOUNT_NOT_FOUND: '账号已移出共享池，请回读云端。',
  CODEX_ACCOUNT_REAUTH_REQUIRED: '该账号需要重新授权。',
  CODEX_RPC_ERROR: '无法读取官方额度，请核对账号授权后重试。',
  CODEX_RUNTIME_UNAVAILABLE: '官方额度暂时读取失败，请稍后重试。',
  MODEL_UPSTREAM_TIMEOUT: '模型回复超时，请稍后重试。',
  MODEL_CONTENT_INVALID: '模型未通过结构化回复检查。'
};

function feedback(message, error = false) {
  $('feedback').textContent = message || '';
  $('feedback').toggleAttribute('data-error', error);
}

async function request(path, body, {bearer = credentials?.token, timeout = 75_000, requestId} = {}) {
  const guard = session.signal;
  const response = await fetch(endpoint + '/admin/' + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.any([guard, AbortSignal.timeout(timeout)]),
    headers: {
      ...(bearer ? {Authorization: 'Bearer ' + bearer} : {}),
      ...(body ? {'Content-Type': 'application/json'} : {}),
      ...(requestId ? {'X-Request-ID': requestId} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => null);
  guard.throwIfAborted();
  if (!response.ok || !result) throw Error(result?.error || 'HTTP_' + response.status);
  return result;
}

function setSession(record) {
  if (typeof record?.token !== 'string' || !record.token || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    throw Error('AUTH_REQUIRED');
  }
  credentials = {token: record.token, expiresAt: record.expiresAt};
  try { sessionStorage.setItem(storageKey, JSON.stringify(credentials)); } catch {}
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    leave();
    feedback(errors.AUTH_REQUIRED, true);
  }, record.expiresAt - Date.now());
  $('login').hidden = true;
  $('workspace').hidden = $('logout').hidden = false;
}

function shouldRestoreFocus() {
  return drawer.classList.contains('open') && (document.activeElement === document.body || panel.contains(document.activeElement));
}

function leave(focus = shouldRestoreFocus()) {
  session.abort();
  session = new AbortController();
  credentials = state = undefined;
  clearTimeout(expiry);
  try { sessionStorage.removeItem(storageKey); } catch {}
  for (const id of ['workspace', 'logout', 'configuration', 'receipt']) $(id).hidden = true;
  for (const picker of Object.values(pickers)) picker.setOptions([]);
  for (const id of ['active-model', 'active-provider', 'active-account', 'quota-account', 'quota-windows', 'quota-updated']) $(id).replaceChildren();
  $('login').hidden = false;
  $('code').value = '';
  lock(false);
  if (focus) $('code').focus();
}

const option = (value, label, disabled = false) => ({value, label, disabled});

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function time(value) {
  const numeric = number(value);
  const date = new Date(numeric === null ? value : numeric < 1e11 ? numeric * 1000 : numeric);
  return value && Number.isFinite(date.getTime()) ? clock.format(date) : '';
}

function duration(minutes) {
  if (minutes === null || minutes <= 0) return '';
  if (minutes >= 1440 && minutes % 1440 === 0) return (minutes / 1440) + ' 天';
  if (minutes >= 60 && minutes % 60 === 0) return (minutes / 60) + ' 小时';
  return minutes + ' 分钟';
}

function tile(tag, css, text) {
  const node = document.createElement(tag);
  if (css) node.className = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function quotaGroups(snapshot) {
  const grouped = Object.entries(snapshot?.rateLimitsByLimitId || {})
    .filter(([, value]) => value && typeof value === 'object');
  return grouped.length ? grouped : snapshot?.rateLimits ? [['Codex', snapshot.rateLimits]] : [];
}

function quotaRow(label, window) {
  const used = number(window?.usedPercent ?? window?.used_percent);
  const minutes = number(window?.windowDurationMins ?? window?.windowMinutes ?? window?.windowMins ?? window?.window_minutes ?? window?.window_mins);
  const reset = time(window?.resetsAt ?? window?.resets_at);
  const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));
  const labelText = [label, duration(minutes)].filter(Boolean).join(' · ');
  const row = tile('div', 'model-admin-quota-row');
  const metric = tile('div', 'model-admin-quota-metric');
  metric.append(tile('span', '', labelText),
    tile('strong', '', remaining === null ? '额度未返回' : '剩余 ' + percent.format(remaining) + '%'));
  row.append(metric);
  if (remaining !== null) {
    const bar = tile('progress');
    bar.max = 100;
    bar.value = remaining;
    bar.setAttribute('aria-label', labelText + '剩余额度');
    row.append(bar);
  }
  row.append(tile('p', 'model-admin-note', [
    ...(used === null ? [] : ['已用 ' + percent.format(used) + '%']),
    reset ? '北京时间 ' + reset + ' 重置' : '重置时间未返回'
  ].join(' · ')));
  return row;
}

function selectedAccount() {
  return state?.accounts.find(account => account.id === pickers.account.value);
}

function renderQuota() {
  const account = selectedAccount();
  $('quota').hidden = pickers.provider.value !== 'openai-codex';
  $('quota-account').textContent = account ? account.label + ' · ' + (account.planType || '套餐未返回') : '请选择可用云端账号';
  const groups = quotaGroups(account?.quota).map(([id, buckets]) => {
    const group = tile('div', 'model-admin-quota-group');
    if (id.toLowerCase() !== 'codex') group.append(tile('h5', '', buckets.limitName || id));
    group.append(quotaRow('主窗口', buckets.primary), quotaRow('次窗口', buckets.secondary));
    return group;
  });
  $('quota-windows').replaceChildren(...(groups.length ? groups : [tile('p', 'model-admin-note', '暂无官方额度快照。')]));
  const updated = time(account?.quota?.fetchedAt);
  $('quota-updated').textContent = updated ? '上次校准 · 北京时间 ' + updated : '';
  syncButtons();
}

function renderEfforts(value) {
  const provider = state.providers.find(row => row.id === pickers.provider.value);
  const model = provider?.models.find(row => row.id === pickers.model.value);
  const choices = new Map();
  for (const [key, actual] of Object.entries(model?.efforts || {})) {
    if (!choices.has(actual) || key === actual) choices.set(actual, key);
  }
  pickers.effort.setOptions([...choices].map(([actual, key]) => option(key, actual)), choices.get(model?.efforts?.[value]));
  syncButtons();
}

function renderModels(selection = {}) {
  const provider = state.providers.find(row => row.id === pickers.provider.value);
  const hasAccounts = provider?.id === 'openai-codex';
  pickers.model.setOptions((provider?.models || []).map(row => option(row.id, row.name)), selection.model || provider?.defaultModel);
  renderEfforts(selection.effort);
  $('account').hidden = !hasAccounts;
  pickers.account.setOptions(state.accounts.map(row => option(row.id,
    row.label + (row.planType ? ' · ' + row.planType : '') + (row.status === 'ready' ? '' : ' · 待授权'), row.status !== 'ready')),
    selection.accountId || state.active.selection.accountId);
  renderQuota();
}

function render() {
  const {selection, updatedAt} = state.active;
  const provider = state.providers.find(row => row.id === selection.provider);
  const model = provider?.models.find(row => row.id === selection.model);
  $('active-provider').textContent = provider?.label || selection.provider;
  $('active-model').textContent = (model?.name || selection.model) + ' / ' + (model?.efforts?.[selection.effort] || selection.effort);
  $('active-account-row').hidden = !selection.accountId;
  $('active-account').textContent = state.accounts.find(row => row.id === selection.accountId)?.label || '待授权';
  $('active-time').textContent = time(updatedAt) || '初始配置';
  pickers.provider.setOptions(state.providers.map(row => option(row.id,
    row.label + (row.configured ? '' : ' · 未配置'), !row.configured)), selection.provider);
  renderModels(selection);
  $('configuration').hidden = $('receipt').hidden = false;
}

function lock(locked) {
  busy = locked;
  $('code').readOnly = locked;
  $('reload').disabled = loginButton.disabled = locked;
  for (const picker of Object.values(pickers)) picker.setDisabled(locked);
  syncButtons();
}

function syncButtons() {
  const ready = state && validSelection(selection());
  $('test').disabled = $('save').disabled = busy || !ready;
  $('calibrate').disabled = busy || selectedAccount()?.status !== 'ready';
}

async function action(message, task) {
  if (busy) return;
  const activeSession = session;
  lock(true);
  feedback(message);
  try {
    const note = await task();
    if (session === activeSession) feedback(note);
  } catch (error) {
    if (session !== activeSession) return;
    if (error.message === 'AUTH_REQUIRED') leave();
    const fallback = error.name === 'TimeoutError' ? '请求超时，请稍后重试。' : '请求失败，请稍后重试。';
    feedback(errors[error.message] || fallback, true);
  } finally {
    if (session === activeSession) lock(false);
  }
}

async function load() {
  state = await request('state');
  render();
}

function selection() {
  const provider = pickers.provider.value;
  return {provider, model: pickers.model.value, effort: pickers.effort.value,
    ...(provider === 'openai-codex' ? {accountId: pickers.account.value} : {})};
}

function validSelection({provider, model, effort, accountId}) {
  return Boolean(provider && model && effort && (provider !== 'openai-codex' || accountId));
}

$('code').addEventListener('input', event => {
  event.target.value = event.target.value.normalize('NFKC').replace(/\D/g, '').slice(0, 6);
});
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  const code = $('code').value;
  if (!/^\d{6}$/.test(code)) return;
  await action('正在验证动态验证码…', async () => {
    const result = await request('session', {code}, {bearer: null});
    $('code').value = '';
    const focus = shouldRestoreFocus();
    setSession(result);
    if (focus) $('title').focus({preventScroll: true});
    feedback('正在读取云端配置…');
    await load();
    return '';
  });
  if (!credentials && shouldRestoreFocus()) {
    $('code').focus({preventScroll: true});
    $('code').select();
  }
});
$('logout').addEventListener('click', () => {
  const previous = credentials?.token;
  leave(true);
  feedback('已退出本机后台。');
  const currentSession = session;
  if (previous) request('logout', {}, {bearer: previous, timeout: 12_000}).catch(error => {
    if (session === currentSession && !credentials && error.message !== 'AUTH_REQUIRED') {
      feedback('已退出本机后台，云端会话将按有效期结束。', true);
    }
  });
});
$('reload').addEventListener('click', () => action('正在回读云端配置…', async () => {
  await load();
  return '已回读云端配置。';
}));
$('provider').addEventListener('change', () => renderModels());
$('model').addEventListener('change', () => renderEfforts(pickers.effort.value));
$('account').addEventListener('change', renderQuota);
$('calibrate').addEventListener('click', () => {
  const account = selectedAccount();
  if (account?.status !== 'ready') return;
  action('正在读取 ' + account.label + ' 的官方额度…', async () => {
    const result = await request('accounts/' + encodeURIComponent(account.id) + '/quota', {},
      {timeout: 180_000, requestId: crypto.randomUUID()});
    state.accounts = state.accounts.map(row => row.id === result.account.id ? result.account : row);
    state.accountRevision = result.accountRevision;
    renderModels(selection());
    return quotaGroups(result.account.quota).length ? '官方额度已校准。' : '这次读取未返回可显示的额度窗口。';
  });
});
$('test').addEventListener('click', () => {
  const selected = selection();
  if (!state || !validSelection(selected)) return;
  action('正在发送模型测试…', async () => {
    const result = await request('test', {selection: selected});
    return '连通测试通过 · ' + result.model + ' / ' + result.reasoningEffort + ' · ' + (result.latencyMs / 1000).toFixed(1) + ' 秒';
  });
});
$('selection').addEventListener('submit', event => {
  event.preventDefault();
  const selected = selection();
  if (!state || !validSelection(selected)) return;
  action('正在保存生产配置…', async () => {
    state.active = await request('switch', {expectedRevision: state.active.revision, selection: selected});
    render();
    return '切换已保存。';
  });
});

function restoreSession() {
  if (restored) return;
  restored = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (!saved) return;
    setSession(saved);
    action('正在回读云端配置…', async () => {
      await load();
      return '';
    });
  } catch { leave(false); }
}

drawer.addEventListener('aurum:settings-open', restoreSession);
drawer.addEventListener('aurum:settings-close', () => {
  $('code').value = '';
  for (const picker of Object.values(pickers)) picker.close();
});
lock(false);
if (drawer.classList.contains('open')) restoreSession();
