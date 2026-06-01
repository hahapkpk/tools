// ==UserScript==
// @name         通用网页填表记忆助手
// @namespace    https://github.com/hahapkpk/tools
// @version      0.2.0
// @description  自动记住当前网页表单内容，刷新后恢复输入框、下拉框、复选框、单选框、点击式选项、账号和密码等字段。
// @author       hahapkpk
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/form-memory-autofill.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/form-memory-autofill.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'codex-form-memory-autofill';
  const VERSION = '0.2.0';
  const DEBUG = false;
  const AUTO_SAVE_KEY = `${SCRIPT_ID}:auto-save-enabled`;
  const UI_ID = `${SCRIPT_ID}-panel`;
  const RESTORE_LIMIT = 8;
  const RESTORE_INTERVAL_MS = 650;
  const SAVE_DEBOUNCE_MS = 250;
  const RESTORE_DEBOUNCE_MS = 350;

  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  function readValue(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (error) {
      console.warn(`[${SCRIPT_ID}] read failed`, error);
    }
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function writeValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (error) {
      console.warn(`[${SCRIPT_ID}] write failed`, error);
    }
    localStorage.setItem(key, JSON.stringify(value));
  }

  function deleteValue(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
        return;
      }
    } catch (error) {
      console.warn(`[${SCRIPT_ID}] delete failed`, error);
    }
    localStorage.removeItem(key);
  }

  function pageKey() {
    const framePath = window.top === window
      ? 'top'
      : Array.from(window.parent.frames).indexOf(window);
    return `${SCRIPT_ID}:page:${location.origin}${location.pathname}${location.search}:frame:${framePath}`;
  }

  function isAutoSaveEnabled() {
    return readValue(AUTO_SAVE_KEY, true) !== false;
  }

  function setAutoSaveEnabled(enabled) {
    writeValue(AUTO_SAVE_KEY, Boolean(enabled));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function fieldSelector(el) {
    if (el.id) return `#${cssEscape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${cssEscape(el.name)}"]`;
    return null;
  }

  function getFormIndex(form) {
    if (!form) return -1;
    return Array.from(document.forms).indexOf(form);
  }

  function getFieldIndex(el) {
    return getFields().indexOf(el);
  }

  function fieldKey(el) {
    const selector = fieldSelector(el);
    const form = el.form || el.closest('form');
    const formHint = form
      ? (form.id || form.name || form.getAttribute('action') || `form-${getFormIndex(form)}`)
      : 'no-form';
    const role = [
      el.tagName.toLowerCase(),
      el.type || '',
      el.name || '',
      el.id || '',
      el.getAttribute('autocomplete') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || ''
    ].join('|');
    return `${formHint}::${selector || role}::index-${getFieldIndex(el)}`;
  }

  function getFields() {
    return Array.from(document.querySelectorAll([
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="file"])',
      'textarea',
      'select',
      '[contenteditable="true"]'
    ].join(','))).filter(el => !el.disabled && !el.readOnly && !el.closest('[data-codex-form-memory-ignore]'));
  }

  function normalizedText(el) {
    return (el.getAttribute('aria-label') || el.innerText || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function getClickableControls() {
    const selectors = [
      '[role="radio"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="option"]',
      '[aria-checked]',
      '[aria-selected]'
    ];
    return Array.from(document.querySelectorAll(selectors.join(','))).filter(el => {
      if (el.closest('[data-codex-form-memory-ignore]')) return false;
      if (el.matches('input,textarea,select,option')) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;
      const role = (el.getAttribute('role') || '').toLowerCase();
      return role || el.hasAttribute('aria-checked') || el.hasAttribute('aria-selected');
    });
  }

  function clickableGroupKey(el) {
    const group = el.closest('[role="radiogroup"],[role="group"],[role="listbox"],fieldset,form');
    const groupText = group
      ? (group.id || group.getAttribute('aria-label') || group.getAttribute('aria-labelledby') || normalizedText(group))
      : 'no-group';
    const groupIndex = group ? Array.from(document.querySelectorAll('[role="radiogroup"],[role="group"],[role="listbox"],fieldset,form')).indexOf(group) : -1;
    const role = (el.getAttribute('role') || 'aria-control').toLowerCase();
    return `${role}::${groupText || 'group'}::group-index-${groupIndex}`;
  }

  function clickableChoiceKey(el) {
    const role = (el.getAttribute('role') || 'aria-control').toLowerCase();
    return [
      role,
      el.id || '',
      el.getAttribute('name') || '',
      el.getAttribute('value') || '',
      el.getAttribute('data-value') || '',
      normalizedText(el)
    ].join('|');
  }

  function isClickableSelected(el) {
    const checked = el.getAttribute('aria-checked');
    const selected = el.getAttribute('aria-selected');
    if (checked != null) return checked === 'true';
    if (selected != null) return selected === 'true';
    return el.matches('[data-state="checked"],[data-checked="true"],.checked,.selected,.active,[class*="checked"],[class*="selected"]');
  }

  function customClickableSnapshot() {
    const clickables = {};
    getClickableControls().forEach(el => {
      const groupKey = clickableGroupKey(el);
      if (!clickables[groupKey]) clickables[groupKey] = [];
      clickables[groupKey].push({
        key: clickableChoiceKey(el),
        text: normalizedText(el),
        selected: isClickableSelected(el)
      });
    });
    return clickables;
  }

  function restoreCustomClickables(clickables) {
    if (!clickables) return 0;

    let count = 0;
    getClickableControls().forEach(el => {
      const records = clickables[clickableGroupKey(el)];
      if (!records) return;

      const record = records.find(item => item.key === clickableChoiceKey(el))
        || records.find(item => item.text && item.text === normalizedText(el));
      if (!record) return;

      const selected = isClickableSelected(el);
      if (record.selected !== selected) {
        el.click();
        count += 1;
      }
    });
    return count;
  }

  function getFieldValue(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'select' && el.multiple) {
      return { kind: 'select-multiple', value: Array.from(el.selectedOptions).map(option => option.value) };
    }
    if (type === 'checkbox') return { kind: 'checkbox', value: Boolean(el.checked) };
    if (type === 'radio') return { kind: 'radio', value: el.checked ? el.value : null, name: el.name || '' };
    if (el.isContentEditable) return { kind: 'contenteditable', value: el.innerHTML };
    return { kind: 'value', value: el.value };
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
  }

  function emitChange(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function restoreField(el, record) {
    if (!record) return false;

    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (record.kind === 'select-multiple' && tag === 'select' && el.multiple) {
      const selected = new Set(Array.isArray(record.value) ? record.value : []);
      Array.from(el.options).forEach(option => {
        option.selected = selected.has(option.value);
      });
      emitChange(el);
      return true;
    }

    if (record.kind === 'checkbox' && type === 'checkbox') {
      el.checked = Boolean(record.value);
      emitChange(el);
      return true;
    }

    if (record.kind === 'radio' && type === 'radio') {
      el.checked = record.value != null && el.value === record.value;
      emitChange(el);
      return true;
    }

    if (record.kind === 'contenteditable' && el.isContentEditable) {
      el.innerHTML = record.value || '';
      emitChange(el);
      return true;
    }

    if ('value' in el && record.kind === 'value') {
      setNativeValue(el, record.value == null ? '' : String(record.value));
      emitChange(el);
      return true;
    }

    return false;
  }

  function snapshot() {
    const fields = {};
    getFields().forEach(el => {
      fields[fieldKey(el)] = getFieldValue(el);
    });
    return {
      version: VERSION,
      href: location.href,
      title: document.title,
      savedAt: new Date().toISOString(),
      fields,
      clickables: customClickableSnapshot()
    };
  }

  function saveNow(showToast = false) {
    const data = snapshot();
    writeValue(pageKey(), data);
    log('saved', data);
    if (showToast) toast(`已保存 ${Object.keys(data.fields).length} 个字段`);
    return data;
  }

  function restoreNow(showToast = false) {
    const data = readValue(pageKey(), null);
    if (!data || (!data.fields && !data.clickables)) {
      if (showToast) toast('当前页面没有已保存的表单内容');
      return 0;
    }

    let count = 0;
    getFields().forEach(el => {
      if (restoreField(el, data.fields && data.fields[fieldKey(el)])) count += 1;
    });
    count += restoreCustomClickables(data.clickables);
    log('restored', count, data);
    if (showToast) toast(`已恢复 ${count} 个字段`);
    return count;
  }

  function clearCurrentPage() {
    deleteValue(pageKey());
    toast('已清空当前页面记录');
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  const debouncedSave = debounce(() => {
    if (isAutoSaveEnabled()) saveNow(false);
  }, SAVE_DEBOUNCE_MS);

  const debouncedRestore = debounce(() => {
    restoreNow(false);
  }, RESTORE_DEBOUNCE_MS);

  function bindAutoSave() {
    document.addEventListener('input', event => {
      if (event.target && getFields().includes(event.target)) debouncedSave();
    }, true);
    document.addEventListener('change', event => {
      if (event.target && getFields().includes(event.target)) debouncedSave();
    }, true);
    document.addEventListener('click', event => {
      if (event.target && event.target.closest('[role="radio"],[role="checkbox"],[role="switch"],[role="option"],[aria-checked],[aria-selected]')) {
        setTimeout(() => debouncedSave(), 0);
      }
    }, true);
  }

  function installMutationRestore() {
    const observer = new MutationObserver(() => {
      if (readValue(pageKey(), null)) debouncedRestore();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startRestoreLoop() {
    let round = 0;
    restoreNow(false);
    const timer = setInterval(() => {
      round += 1;
      restoreNow(false);
      if (round >= RESTORE_LIMIT) clearInterval(timer);
    }, RESTORE_INTERVAL_MS);
  }

  function toast(message) {
    if (window.top !== window) return;
    let node = document.getElementById(`${SCRIPT_ID}-toast`);
    if (!node) {
      node = document.createElement('div');
      node.id = `${SCRIPT_ID}-toast`;
      node.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:72px',
        'z-index:2147483647',
        'max-width:280px',
        'padding:9px 12px',
        'border-radius:8px',
        'background:rgba(20,20,20,.92)',
        'color:#fff',
        'font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,.22)',
        'pointer-events:none',
        'opacity:0',
        'transition:opacity .18s ease'
      ].join(';');
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.style.opacity = '1';
    clearTimeout(node._timer);
    node._timer = setTimeout(() => {
      node.style.opacity = '0';
    }, 1800);
  }

  function makeButton(text, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.style.cssText = [
      'display:block',
      'width:100%',
      'margin:6px 0 0',
      'padding:7px 9px',
      'border:1px solid #d7d7d7',
      'border-radius:6px',
      'background:#fff',
      'color:#202124',
      'font:13px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
      'text-align:left'
    ].join(';');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return button;
  }

  function installPanel() {
    if (window.top !== window || document.getElementById(UI_ID)) return;

    const panel = document.createElement('div');
    panel.id = UI_ID;
    panel.dataset.codexFormMemoryIgnore = '1';
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'width:178px',
      'padding:10px',
      'border:1px solid rgba(0,0,0,.14)',
      'border-radius:8px',
      'background:#f7f8fa',
      'box-shadow:0 10px 28px rgba(0,0,0,.18)',
      'color:#202124',
      'font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '填表记忆助手';
    title.style.cssText = 'font-weight:700;margin-bottom:5px;';
    panel.appendChild(title);

    const status = document.createElement('div');
    status.style.cssText = 'font-size:12px;color:#5f6368;margin-bottom:4px;';

    function refreshStatus() {
      const data = readValue(pageKey(), null);
      const fieldCount = data && data.fields ? Object.keys(data.fields).length : 0;
      const clickableCount = data && data.clickables
        ? Object.values(data.clickables).flat().filter(item => item.selected).length
        : 0;
      const count = fieldCount + clickableCount;
      status.textContent = `${isAutoSaveEnabled() ? '自动保存开启' : '自动保存关闭'} · 已记 ${count} 项`;
    }

    panel.appendChild(status);
    panel.appendChild(makeButton('保存当前表单', () => {
      saveNow(true);
      refreshStatus();
    }));
    panel.appendChild(makeButton('恢复到页面', () => {
      restoreNow(true);
      refreshStatus();
    }));
    panel.appendChild(makeButton('清空当前记录', () => {
      clearCurrentPage();
      refreshStatus();
    }));
    panel.appendChild(makeButton('切换自动保存', () => {
      setAutoSaveEnabled(!isAutoSaveEnabled());
      toast(isAutoSaveEnabled() ? '自动保存已开启' : '自动保存已关闭');
      refreshStatus();
    }));

    document.documentElement.appendChild(panel);
    refreshStatus();
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('保存当前表单', () => saveNow(true));
    GM_registerMenuCommand('恢复当前表单', () => restoreNow(true));
    GM_registerMenuCommand('清空当前页面记录', clearCurrentPage);
    GM_registerMenuCommand('切换自动保存', () => {
      setAutoSaveEnabled(!isAutoSaveEnabled());
      toast(isAutoSaveEnabled() ? '自动保存已开启' : '自动保存已关闭');
    });
  }

  function init() {
    if (document.documentElement.getAttribute(`data-${SCRIPT_ID}`) === '1') return;
    document.documentElement.setAttribute(`data-${SCRIPT_ID}`, '1');
    bindAutoSave();
    installMutationRestore();
    installPanel();
    registerMenu();
    startRestoreLoop();
  }

  init();
})();
