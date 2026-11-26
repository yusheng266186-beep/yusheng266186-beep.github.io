import {closeOpenMenu, mountSelectMenu} from './control-select.js?v=5.3.12';
import {mountDatePicker} from './date-picker.js?v=5.3.12';

function fieldFor(control) {
  const label = control.closest('label');
  const caption = label.cloneNode(true);
  caption.querySelector('input,select').remove();
  const field = document.createElement('div');
  field.id = control.id + '-field';
  field.className = ['aurum-control-field', label.className].filter(Boolean).join(' ');
  field.dataset.label = caption.textContent.replace(/\s+/g, ' ').trim();
  label.replaceWith(field);
  control.hidden = true;
  field.append(control);
  return field;
}

function enhanceSelect(select) {
  const field = fieldFor(select);
  const menu = mountSelectMenu(field, value => {
    select.value = value;
    for (const event of ['input', 'change']) select.dispatchEvent(new Event(event, {bubbles: true}));
  });
  function refresh() {
    menu.setOptions(Array.from(select.options).filter(option => !option.hidden).map(option => ({
      value: option.value,
      label: option.label,
      disabled: option.disabled || option.parentElement.matches('optgroup:disabled')
    })), select.value);
    menu.setDisabled(select.disabled);
  }
  refresh();
  for (const event of ['input', 'change', 'aurum:control-sync']) select.addEventListener(event, refresh);
  select.form?.addEventListener('reset', () => queueMicrotask(refresh));
  new MutationObserver(refresh).observe(select, {subtree: true, childList: true, characterData: true, attributes: true});
}

for (const select of document.querySelectorAll('select[id]:not([multiple]):not([size]):not([hidden])')) {
  if (select.closest('label')) enhanceSelect(select);
}

const replayDate = document.getElementById('replayDate');
if (replayDate) mountDatePicker(replayDate, fieldFor(replayDate));
document.getElementById('settingsDrawer')?.addEventListener('aurum:settings-close', closeOpenMenu);

function inlineValidation(formId, feedbackId, messageFor) {
  const form = document.getElementById(formId);
  const feedback = document.getElementById(feedbackId);
  if (!form || !feedback) return;
  let reported, message;

  function clear() {
    reported?.removeAttribute('aria-invalid');
    reported?.removeAttribute('aria-errormessage');
    if (feedback.textContent === message) feedback.textContent = '';
    reported = message = undefined;
  }

  form.addEventListener('invalid', event => {
    event.preventDefault();
    const field = form.querySelector('input:invalid,textarea:invalid,select:invalid');
    if (field !== event.target) return;
    clear();
    reported = field;
    message = feedback.textContent = messageFor(field);
    feedback.setAttribute('data-error', '');
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-errormessage', feedbackId);
    field.focus();
  }, true);
  form.addEventListener('input', event => { if (event.target === reported) clear(); });
  form.addEventListener('submit', clear);
  form.closest('.settings-drawer')?.addEventListener('aurum:settings-close', clear);
}

inlineValidation('modelAdmin-login', 'modelAdmin-feedback', () => '请输入 6 位动态验证码。');
inlineValidation('analysisWatchForm', 'analysisWatchError', field => {
  const label = field.labels?.[0]?.textContent.trim() || '该字段';
  if (field.validity.valueMissing) return '请填写' + label + '。';
  if (field.validity.rangeUnderflow) return label + '需大于或等于 ' + field.min + '。';
  return '请检查' + label + '的格式和精度。';
});
