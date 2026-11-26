export function mountModelSelect(field) {
  const label = document.createElement('span');
  const trigger = document.createElement('button');
  const value = document.createElement('span');
  const list = document.createElement('ul');
  label.className = 'model-select-label';
  label.id = field.id + '-label';
  label.textContent = field.dataset.label;
  value.id = field.id + '-value';
  trigger.className = 'model-select-trigger';
  trigger.type = 'button';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-labelledby', label.id + ' ' + value.id);
  list.className = 'model-select-list';
  list.id = field.id + '-options';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', label.id);
  trigger.setAttribute('aria-controls', list.id);
  trigger.append(value);
  field.append(label, trigger, list);

  let entries = [], enabled = [], selected = -1, active = -1, locked = false;
  let search = '', lastTyped = 0;

  function close() {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    list.children[active]?.removeAttribute('data-active');
    active = -1;
    search = '';
  }

  function highlight(index) {
    list.children[active]?.removeAttribute('data-active');
    active = index;
    const node = list.children[index];
    if (!node) return;
    node.setAttribute('data-active', '');
    trigger.setAttribute('aria-activedescendant', node.id);
    requestAnimationFrame(() => {
      if (!list.hidden && list.children[active] === node) node.scrollIntoView({block: 'nearest', inline: 'nearest'});
    });
  }

  function open(index = selected) {
    if (trigger.disabled) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    highlight(index < 0 ? enabled[0] ?? -1 : index);
    requestAnimationFrame(() => {
      if (!list.hidden) list.scrollIntoView({block: 'nearest', inline: 'nearest'});
    });
  }

  function update() {
    trigger.disabled = locked || !entries.length;
    value.textContent = entries[selected]?.label || '暂无可用选项';
    Array.from(list.children).forEach((node, index) => node.setAttribute('aria-selected', String(index === selected)));
  }

  function choose(index) {
    if (!enabled.includes(index)) return;
    const changed = selected !== index;
    selected = index;
    close();
    update();
    trigger.focus({preventScroll: true});
    if (changed) field.dispatchEvent(new Event('change', {bubbles: true}));
  }

  trigger.addEventListener('click', () => {
    if (list.hidden) {
      trigger.focus({preventScroll: true});
      open();
    } else close();
  });
  list.addEventListener('click', event => {
    const option = event.target.closest('[role="option"]');
    if (option) choose(Number(option.dataset.index));
  });
  document.addEventListener('click', event => {
    if (!list.hidden && !field.contains(event.target)) close();
  });

  trigger.addEventListener('keydown', event => {
    const key = event.key;
    if (key === 'Tab') { close(); return; }
    if (key === 'Escape' && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if ((key === 'Enter' || key === ' ') && !list.hidden) {
      event.preventDefault();
      choose(active);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      let next;
      if (key === 'Home') next = enabled[0];
      else if (key === 'End') next = enabled.at(-1);
      else if (list.hidden) next = selected;
      else {
        const step = key === 'ArrowDown' ? 1 : -1;
        const position = enabled.indexOf(active) + step;
        next = enabled[Math.max(0, Math.min(enabled.length - 1, position))];
      }
      if (list.hidden) open(next);
      else if (next !== undefined) highlight(next);
      return;
    }
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || key.length !== 1 || key === ' ') return;
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    const letter = key.toLocaleLowerCase();
    search = now - lastTyped > 700 ? letter : search + letter;
    lastTyped = now;
    const repeated = [...search].every(character => character === letter);
    const prefix = repeated ? letter : search;
    const after = enabled.indexOf(list.hidden ? selected : active) + 1;
    const order = repeated ? [...enabled.slice(after), ...enabled.slice(0, after)] : enabled;
    const next = order.find(index => entries[index].label.toLocaleLowerCase().startsWith(prefix));
    if (next !== undefined) {
      if (list.hidden) open(next);
      else highlight(next);
    }
  });

  close();
  update();
  return {
    get value() { return entries[selected]?.value || ''; },
    setOptions(options, requested) {
      close();
      entries = options;
      enabled = entries.flatMap((entry, index) => entry.disabled ? [] : [index]);
      selected = enabled.find(index => entries[index].value === requested) ?? enabled[0] ?? -1;
      list.replaceChildren(...entries.map((entry, index) => {
        const node = document.createElement('li');
        node.className = 'model-select-option';
        node.id = list.id + '-' + index;
        node.dataset.index = index;
        node.setAttribute('role', 'option');
        if (entry.disabled) node.setAttribute('aria-disabled', 'true');
        node.textContent = entry.label;
        return node;
      }));
      update();
    },
    setDisabled(disabled) {
      locked = disabled;
      if (locked) close();
      update();
    },
    close
  };
}
