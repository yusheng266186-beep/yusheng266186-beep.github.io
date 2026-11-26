const endpoint = 'https://1459223409-lnoxklunue.ap-chengdu.tencentscf.com';
const storageKey = 'aurum.model-admin.session.v1';
const $ = id => document.getElementById(id);
const controls = ['code', 'provider', 'model', 'effort', 'account', 'test', 'save', 'reload'];
const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const percent = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 1});
let credentials, expiry, state, busy = false, session = new AbortController();

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
  $('feedback').hidden = !message;
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
  if (typeof record?.token !== 'string' || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    throw Error('AUTH_REQUIRED');
  }
  credentials = record;
  try { sessionStorage.setItem(storageKey, JSON.stringify(record)); } catch {}
  clearTimeout(expiry);
  expiry = setTimeout(() => {
    leave();
    feedback(errors.AUTH_REQUIRED, true);
  }, record.expiresAt - Date.now());
  $('login').hidden = true;
  $('workspace').hidden = $('logout').hidden = false;
}

function leave(focus = true) {
  session.abort();
  session = new AbortController();
  credentials = state = undefined;
  clearTimeout(expiry);
  try { sessionStorage.removeItem(storageKey); } catch {}
  for (const id of ['workspace', 'logout', 'configuration', 'receipt']) $(id).hidden = true;
  $('login').hidden = false;
  $('code').value = '';
  lock(false);
  if (focus) $('code').focus();
}

function option(value, name, disabled = false) {
  const entry = new Option(name, value);
  entry.disabled = disabled;
  return entry;
}

function selectOptions(control, options, value) {
  control.replaceChildren(...options);
  control.value = options.some(entry => !entry.disabled && entry.value === value)
    ? value : options.find(entry => !entry.disabled)?.value || '';
}

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
  const row = tile('div', 'quota-row');
  const metric = tile('div', 'quota-metric');
  metric.append(tile('span', 'quota-period', labelText),
    tile('strong', '', remaining === null ? '额度未返回' : '剩余 ' + percent.format(remaining) + '%'));
  row.append(metric);
  if (remaining !== null) {
    const bar = tile('progress');
    bar.max = 100;
    bar.value = remaining;
    bar.setAttribute('aria-label', labelText + '剩余额度');
    row.append(bar);
  }
  row.append(tile('p', 'quota-detail', [
    ...(used === null ? [] : ['已用 ' + percent.format(used) + '%']),
    reset ? '北京时间 ' + reset + ' 重置' : '重置时间未返回'
  ].join(' · ')));
  return row;
}

function selectedAccount() {
  return state?.accounts.find(account => account.id === $('account').value);
}

function renderQuota() {
  const account = selectedAccount();
  $('quota').hidden = $('provider').value !== 'openai-codex';
  $('quota-account').textContent = account ? account.label + ' · ' + (account.planType || '套餐未返回') : '请选择可用云端账号';
  const groups = quotaGroups(account?.quota).map(([id, buckets]) => {
    const group = tile('div', 'quota-group');
    if (id.toLowerCase() !== 'codex') group.append(tile('h3', '', buckets.limitName || id));
    group.append(quotaRow('主窗口', buckets.primary), quotaRow('次窗口', buckets.secondary));
    return group;
  });
  $('quota-windows').replaceChildren(...(groups.length ? groups : [tile('p', 'quota-detail', '暂无可显示的官方额度快照。')]));
  const updated = time(account?.quota?.fetchedAt);
  $('quota-updated').textContent = updated ? '上次校准 · 北京时间 ' + updated : '校准后在此显示更新时间';
  $('calibrate').disabled = busy || account?.status !== 'ready';
}

function renderEfforts(value) {
  const provider = state.providers.find(row => row.id === $('provider').value);
  const model = provider?.models.find(row => row.id === $('model').value);
  const choices = new Map();
  for (const [key, actual] of Object.entries(model?.efforts || {})) {
    if (!choices.has(actual) || key === actual) choices.set(actual, key);
  }
  selectOptions($('effort'), [...choices].map(([actual, key]) => option(key, actual)), choices.get(model?.efforts?.[value]));
}

function renderModels(selection = {}) {
  const provider = state.providers.find(row => row.id === $('provider').value);
  const hasAccounts = provider?.id === 'openai-codex';
  selectOptions($('model'), (provider?.models || []).map(row => option(row.id, row.name)), selection.model || provider?.defaultModel);
  renderEfforts(selection.effort);
  $('account-field').hidden = !hasAccounts;
  $('account').required = hasAccounts;
  selectOptions($('account'), state.accounts.map(row => option(row.id,
    row.label + ' · ' + row.planType + (row.status === 'ready' ? '' : ' · 待授权'), row.status !== 'ready')),
    selection.accountId || state.active.selection.accountId);
  renderQuota();
}

function render() {
  const {selection, updatedAt} = state.active;
  const provider = state.providers.find(row => row.id === selection.provider);
  const model = provider?.models.find(row => row.id === selection.model);
  $('active-provider').textContent = provider?.label || selection.provider;
  $('active-model').textContent = (model?.name || selection.model) + ' / ' + (model?.efforts[selection.effort] || selection.effort);
  $('active-account-row').hidden = !selection.accountId;
  $('active-account').textContent = state.accounts.find(row => row.id === selection.accountId)?.label || '待授权';
  $('active-time').textContent = time(updatedAt) || '初始配置';
  selectOptions($('provider'), state.providers.map(row => option(row.id,
    row.label + (row.configured ? '' : ' · 未配置'), !row.configured)), selection.provider);
  renderModels(selection);
  $('configuration').hidden = $('receipt').hidden = false;
}

function lock(locked) {
  busy = locked;
  for (const id of controls) $(id).disabled = locked;
  $('login').querySelector('button[type="submit"]').disabled = locked;
  $('calibrate').disabled = locked || selectedAccount()?.status !== 'ready';
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
  const provider = $('provider').value;
  return {provider, model: $('model').value, effort: $('effort').value,
    ...(provider === 'openai-codex' ? {accountId: $('account').value} : {})};
}

$('code').addEventListener('input', event => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
});
$('login').addEventListener('submit', event => {
  event.preventDefault();
  const code = $('code').value.trim();
  action('正在验证动态验证码…', async () => {
    const result = await request('session', {code}, {bearer: null});
    $('code').value = '';
    setSession(result);
    $('adminTitle').focus();
    feedback('正在读取云端配置…');
    await load();
    return '';
  });
});
$('logout').addEventListener('click', () => {
  const previous = credentials?.token;
  leave();
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
$('model').addEventListener('change', () => renderEfforts($('effort').value));
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
  if (!$('selection').reportValidity()) return;
  action('正在发送模型测试…', async () => {
    const result = await request('test', {selection: selection()});
    return '连通测试通过 · ' + result.model + ' / ' + result.reasoningEffort + ' · ' + (result.latencyMs / 1000).toFixed(1) + ' 秒';
  });
});
$('selection').addEventListener('submit', event => {
  event.preventDefault();
  action('正在保存生产配置…', async () => {
    state.active = await request('switch', {expectedRevision: state.active.revision, selection: selection()});
    render();
    return '切换已保存。';
  });
});

try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  if (saved) {
    setSession(saved);
    action('正在回读云端配置…', async () => {
      await load();
      return '';
    });
  }
} catch { leave(false); }
