const dayMs = 86_400_000;
const monthLabel = new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'long', timeZone: 'UTC'});
const dayLabel = new Intl.DateTimeFormat('zh-CN', {dateStyle: 'full', timeZone: 'UTC'});
const iso = date => date.toISOString().slice(0, 10);
const asDate = value => new Date(value + 'T00:00:00Z');
const weekday = date => (date.getUTCDay() + 6) % 7;

function parseDate(value) {
  const raw = value.trim().normalize('NFKC');
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  const date = compact ? compact.slice(1).join('-') : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = asDate(date);
  return Number.isFinite(parsed.getTime()) && iso(parsed) === date ? date : '';
}

function shiftMonth(value, months) {
  const first = new Date(value);
  first.setUTCDate(1);
  first.setUTCMonth(first.getUTCMonth() + months);
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  first.setUTCDate(Math.min(value.getUTCDate(), last.getUTCDate()));
  return first;
}

export function mountDatePicker(source, field) {
  const label = document.createElement('label');
  const entry = document.createElement('div');
  const text = document.createElement('input');
  const trigger = document.createElement('button');
  const error = document.createElement('p');
  const dialog = document.createElement('dialog');
  label.className = 'aurum-select-label';
  label.htmlFor = text.id = source.id + '-text';
  label.textContent = field.dataset.label;
  entry.className = 'aurum-date-entry';
  text.type = 'text';
  text.inputMode = 'numeric';
  text.autocomplete = 'off';
  text.placeholder = 'YYYY-MM-DD';
  text.maxLength = 10;
  text.spellcheck = false;
  error.id = source.id + '-error';
  error.className = 'aurum-date-error';
  error.setAttribute('role', 'status');
  text.setAttribute('aria-describedby', error.id);
  trigger.type = 'button';
  trigger.className = 'aurum-date-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'aurumDateDialog');
  trigger.textContent = '日历';
  entry.append(text, trigger);
  field.append(label, entry, error);

  dialog.id = 'aurumDateDialog';
  dialog.className = 'aurum-date-dialog';
  dialog.setAttribute('aria-labelledby', 'aurumDateTitle');
  dialog.innerHTML = `
    <div class="aurum-date-head">
      <h2 id="aurumDateTitle">选择训练截止日期</h2>
      <button class="icon-button" type="button" data-date-close aria-label="关闭日期选择器">×</button>
    </div>
    <div class="aurum-date-month">
      <button type="button" data-month="-1" aria-label="上个月">‹</button>
      <h3 id="aurumDateMonth" aria-live="polite"></h3>
      <button type="button" data-month="1" aria-label="下个月">›</button>
    </div>
    <div class="aurum-date-grid" role="grid" aria-labelledby="aurumDateMonth">
      <div class="aurum-date-weekdays" role="row"></div>
      <div data-date-days role="rowgroup"></div>
    </div>`;
  document.body.append(dialog);
  const month = dialog.querySelector('#aurumDateMonth');
  const previous = dialog.querySelector('[data-month="-1"]');
  const next = dialog.querySelector('[data-month="1"]');
  const days = dialog.querySelector('[data-date-days]');
  for (const name of ['一', '二', '三', '四', '五', '六', '日']) {
    const column = document.createElement('span');
    column.setAttribute('role', 'columnheader');
    column.setAttribute('aria-label', '星期' + name);
    column.textContent = name;
    dialog.querySelector('.aurum-date-weekdays').append(column);
  }

  let active;
  function inRange(value) {
    return value && (!source.min || value >= source.min) && (!source.max || value <= source.max);
  }

  function setActive(date) {
    const value = iso(date);
    active = asDate(source.min && value < source.min ? source.min : source.max && value > source.max ? source.max : value);
  }

  function sync() {
    text.value = source.value;
    text.removeAttribute('aria-invalid');
    error.textContent = '';
    trigger.setAttribute('aria-label', source.value ? '更改日期，当前 ' + source.value : '打开日期选择器');
  }

  function commit(value) {
    source.value = value;
    sync();
    for (const event of ['input', 'change']) source.dispatchEvent(new Event(event, {bubbles: true}));
  }

  function render(focus = false) {
    month.textContent = monthLabel.format(active);
    const first = new Date(active);
    first.setUTCDate(1);
    const firstTime = first.getTime() - weekday(first) * dayMs;
    const offset = weekday(first);
    const monthDays = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const rows = Math.ceil((offset + monthDays) / 7);
    const container = document.createDocumentFragment();
    const activeValue = iso(active);
    for (let row = 0; row < rows; row++) {
      const week = document.createElement('div');
      week.className = 'aurum-date-week';
      week.setAttribute('role', 'row');
      for (let column = 0; column < 7; column++) {
        const date = new Date(firstTime + (row * 7 + column) * dayMs);
        const value = iso(date);
        const cell = document.createElement('div');
        cell.setAttribute('role', 'gridcell');
        if (date.getUTCMonth() === first.getUTCMonth()) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.date = value;
          button.setAttribute('aria-label', dayLabel.format(date));
          button.textContent = date.getUTCDate();
          button.disabled = !inRange(value);
          button.tabIndex = value === activeValue ? 0 : -1;
          cell.setAttribute('aria-selected', String(value === source.value));
          cell.append(button);
        }
        week.append(cell);
      }
      container.append(week);
    }
    days.replaceChildren(container);
    previous.disabled = Boolean(source.min && iso(first).slice(0, 7) <= source.min.slice(0, 7));
    next.disabled = Boolean(source.max && iso(first).slice(0, 7) >= source.max.slice(0, 7));
    if (focus) days.querySelector('button[tabindex="0"]')?.focus({preventScroll: true});
  }

  text.addEventListener('input', () => {
    source.value = parseDate(text.value);
    text.removeAttribute('aria-invalid');
    error.textContent = '';
  });
  text.addEventListener('blur', () => {
    const value = parseDate(text.value);
    if (inRange(value) || !text.value.trim()) commit(value);
    else {
      text.setAttribute('aria-invalid', 'true');
      error.textContent = '请输入历史范围内的日期，格式为 YYYY-MM-DD。';
    }
  });
  for (const event of ['change', 'aurum:control-sync']) source.addEventListener(event, sync);
  trigger.addEventListener('click', () => {
    setActive(asDate(source.value || source.max || iso(new Date())));
    render();
    dialog.showModal();
    days.querySelector('button[tabindex="0"]')?.focus({preventScroll: true});
  });
  dialog.querySelector('[data-date-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.focus({preventScroll: true}));
  for (const button of [previous, next]) button.addEventListener('click', () => {
    setActive(shiftMonth(active, Number(button.dataset.month)));
    render();
    if (button.disabled) days.querySelector('button[tabindex="0"]')?.focus({preventScroll: true});
  });
  days.addEventListener('click', event => {
    const button = event.target.closest('[data-date]');
    if (!button || button.disabled) return;
    commit(button.dataset.date);
    dialog.close();
  });
  days.addEventListener('keydown', event => {
    if (!event.target.matches('[data-date]')) return;
    const shift = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday(active), End: 6 - weekday(active)};
    if (Object.hasOwn(shift, event.key)) setActive(new Date(active.getTime() + shift[event.key] * dayMs));
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      setActive(shiftMonth(active, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)));
    } else return;
    event.preventDefault();
    render(true);
  });
  sync();
}
