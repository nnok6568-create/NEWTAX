/* 공통 유틸리티: DOM 생성, 날짜, ID, 디바운스, 토스트 */
window.STM = window.STM || {};

(function (STM) {
  'use strict';

  const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'required']);

  // innerHTML을 쓰지 않고 DOM을 만든다. 문자열 자식은 항상 텍스트 노드로 들어가므로 XSS에 안전하다.
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const val = props[key];
        if (val === undefined || val === null || val === false) continue;
        if (key === 'class') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'dataset') Object.assign(node.dataset, val);
        else if (key.slice(0, 2) === 'on' && typeof val === 'function') node.addEventListener(key.slice(2), val);
        else if (PROP_KEYS.has(key)) node[key] = val;
        else node.setAttribute(key, val === true ? '' : String(val));
      }
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === undefined || children === null || children === false) return;
    if (Array.isArray(children)) {
      children.forEach((c) => append(node, c));
      return;
    }
    node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  }

  function uuid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const pad = (n) => String(n).padStart(2, '0');

  // 날짜는 로컬(KST) 기준 'YYYY-MM-DD' 문자열로 다룬다.
  function toDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return toDateStr(new Date(y, m - 1, d + n));
  }

  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return `${toDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function isDateStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // '2026-09-25', '2026.09.25', '20260925', '2026. 9. 25.' 등을 'YYYY-MM-DD'로 바꾼다. 해석할 수 없으면 null.
  function normalizeDate(value) {
    const s = String(value || '').trim();
    let m = s.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const out = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
    return isDateStr(out) ? out : null;
  }

  function maskKey(key) {
    if (!key) return '';
    return key.length <= 10 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
  }

  // Blob으로 파일을 내려받는다 (file:// 에서도 동작).
  function download(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // http/https 링크만 허용한다 (javascript: 등 차단).
  function safeUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  function debounce(fn, wait) {
    let timer = null;
    let lastArgs = null;
    function run() {
      timer = null;
      const args = lastArgs;
      lastArgs = null;
      if (args) fn.apply(null, args);
    }
    function debounced() {
      lastArgs = arguments;
      clearTimeout(timer);
      timer = setTimeout(run, wait);
    }
    debounced.flush = () => {
      if (timer) {
        clearTimeout(timer);
        run();
      }
    };
    return debounced;
  }

  // action: { label, onClick } — 예: 삭제 후 [되돌리기]. 오류와 동작 버튼이 있는 알림은 더 오래 남고 닫기 버튼이 붙는다.
  function toast(message, type, action) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const kind = type || 'info';
    const sticky = kind === 'error' || !!action;
    const node = el('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, [
      el('span', { class: 'toast-text' }, message),
      action
        ? el(
            'button',
            {
              type: 'button',
              class: 'toast-action',
              onclick: () => {
                node.remove();
                action.onClick();
              },
            },
            action.label
          )
        : null,
      sticky ? el('button', { type: 'button', 'aria-label': '알림 닫기', onclick: () => node.remove() }, '닫기') : null,
    ]);
    root.appendChild(node);
    setTimeout(() => node.remove(), kind === 'error' ? 8000 : action ? 6000 : 2500);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  STM.utils = { el, uuid, todayStr, addDays, formatDateTime, isDateStr, normalizeDate, maskKey, download, safeUrl, debounce, toast, sleep };
})(window.STM);
