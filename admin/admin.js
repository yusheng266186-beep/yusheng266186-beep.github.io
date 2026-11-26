const endpoint = 'https://1459223409-lnoxklunue.ap-chengdu.tencentscf.com';
const $ = id => document.getElementById(id);
const controls = ['provider', 'model', 'effort', 'account', 'test', 'reload'];
let key, state, session, busy = false;

const errors = {
  AUTH_REQUIRED: '访问密钥无效。',
  REVISION_CONFLICT: '另一处已切换配置。请回读云端后重新选择。',
  MODEL_NOT_CONFIGURED: '此服务当前没有可用凭据。',
  MODEL_AUTH_FAILED: '模型或账号的授权失败。',
  MODEL_RATE_LIMIT: '账号额度不足或当前繁忙。',
  CODEX_ACCOUNT_BUSY: '该账号正在处理另一项任务。',
  CODEX_ACCOUNT_REAUTH_REQUIRED: '该账号需要重新授权。',
  MODEL_UPSTREAM_TIMEOUT: '模型回复超时，请稍后重试。',
  MODEL_CONTENT_INVALID: '模型未通过结构化回复检查。'
};

function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').hidden = !text;
  $('feedback').toggleAttribute('data-error', error);
}

async function request(path, body) {
  const activeSession = session;
  const response = await fetch(endpoint + '/admin/' + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.any([activeSession.signal, AbortSignal.timeout(75_000)]),
    headers: {Authorization: 'Bearer ' + key, ...(body ? {'Content-Type': 'application/json'} : {})},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(error.error || 'HTTP_' + response.status);
  }
  const result = await response.json();
  activeSession.signal.throwIfAborted();
  return result;
}

function option(value, name, disabled = false) {
  const entry = new Option(name, value);
  entry.disabled = disabled;
  return entry;
}

function selectOptions(control, options, value) {
  control.replaceChildren(...options);
  if (options.some(entry => !entry.disabled && entry.value === value)) control.value = value;
  else control.value = options.find(entry => !entry.disabled)?.value || '';
}

function time(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai'
  }).format(new Date(value)) : '初始配置';
}

function quota() {
  const account = state.accounts.find(row => row.id === $('account').value);
  const limits = account?.quota?.rateLimits;
  const windows = [limits?.primary, limits?.secondary].filter(row => Number.isFinite(row?.usedPercent));
  const usage = windows.map(row => {
    const hours = row.windowDurationMins / 60;
    const period = Number.isFinite(hours) ? hours >= 24 ? Math.round(hours / 24) + ' 天窗口' : hours + ' 小时窗口' : '额度窗口';
    return period + '已用 ' + row.usedPercent + '%';
  });
  $('quota').hidden = $('provider').value !== 'openai-codex' || !account?.quota?.fetchedAt;
  $('quota').textContent = [...usage, '额度快照 ' + time(account?.quota?.fetchedAt)].join(' · ');
}

function renderEfforts(value) {
  const provider = state.providers.find(row => row.id === $('provider').value);
  const model = provider?.models.find(row => row.id === $('model').value);
  const efforts = Object.entries(model?.efforts || {});
  const choices = new Map();
  for (const [key, actual] of efforts) {
    if (!choices.has(actual) || key === actual) choices.set(actual, key);
  }
  const preferred = choices.get(model?.efforts?.[value]);
  selectOptions($('effort'), [...choices].map(([actual, key]) => option(key, actual)), preferred);
}

function renderModels(selection = {}) {
  const provider = state.providers.find(row => row.id === $('provider').value);
  const isAccount = provider?.id === 'openai-codex';
  selectOptions($('model'), (provider?.models || []).map(row => option(row.id, row.name)), selection.model || provider?.defaultModel);
  renderEfforts(selection.effort);
  $('account-field').hidden = !isAccount;
  $('account').required = isAccount;
  selectOptions($('account'), state.accounts.map(row => option(row.id,
    row.label + ' · ' + row.planType + (row.status === 'ready' ? '' : ' · 待授权'), row.status !== 'ready')),
    selection.accountId || state.active.selection.accountId);
  quota();
}

function render() {
  const {selection, updatedAt} = state.active;
  const provider = state.providers.find(row => row.id === selection.provider);
  const model = provider?.models.find(row => row.id === selection.model);
  $('active-provider').textContent = provider?.label || selection.provider;
  $('active-model').textContent = (model?.name || selection.model) + ' / ' + (model?.efforts[selection.effort] || selection.effort);
  $('active-account-row').hidden = !selection.accountId;
  $('active-account').textContent = state.accounts.find(row => row.id === selection.accountId)?.label || '待授权';
  $('active-time').textContent = time(updatedAt);
  selectOptions($('provider'), state.providers.map(row => option(row.id, row.label + (row.configured ? '' : ' · 未配置'), !row.configured)), selection.provider);
  renderModels(selection);
}

function lock(locked) {
  busy = locked;
  for (const id of controls) $(id).disabled = locked;
  document.querySelectorAll('button[type="submit"]').forEach(button => {button.disabled = locked;});
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
    if (session === activeSession) feedback(errors[error.message] || '请求失败（' + (error.name === 'TimeoutError' ? '超时' : error.message) + '）。', true);
  } finally {
    if (session === activeSession) lock(false);
  }
}

function selection() {
  const provider = $('provider').value;
  return {provider, model: $('model').value, effort: $('effort').value, ...(provider === 'openai-codex' ? {accountId: $('account').value} : {})};
}

$('login').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  key = $('key').value.trim();
  session = new AbortController();
  action('正在读取云端配置…', async () => {
    state = await request('state');
    $('key').value = '';
    $('login').hidden = true;
    $('workspace').hidden = false;
    $('logout').hidden = false;
    render();
    return '';
  });
});
$('logout').addEventListener('click', () => {
  session.abort();
  session = key = state = undefined;
  lock(false); feedback('');
  $('workspace').hidden = $('logout').hidden = true;
  $('login').hidden = false;
  $('key').focus();
});
$('reload').addEventListener('click', () => action('正在回读云端配置…', async () => {
  state = await request('state'); render(); return '已回读云端配置。';
}));
$('provider').addEventListener('change', () => renderModels());
$('model').addEventListener('change', () => renderEfforts($('effort').value));
$('account').addEventListener('change', quota);
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
