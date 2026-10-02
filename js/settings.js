/* localStorage 설정 저장소 (PRD 5.2) */
(function (STM) {
  'use strict';

  const KEY = 'stm.settings';
  const DEFAULTS = Object.freeze({
    apiKey: '',
    model: 'claude-sonnet-5-5',
    lawApiKey: '',
    periodDays: 7,
    proxyUrl: '',
    lastFetchedAt: null,
    lastBackupAt: null,
    theme: 'system', // 'system' | 'light' | 'dark'
  });

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
      return Object.assign({}, DEFAULTS, parsed && typeof parsed === 'object' ? parsed : {});
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  let cache = load();

  function get(key) {
    return key ? cache[key] : Object.assign({}, cache);
  }

  // 저장 실패(사생활 보호 모드 등) 시 false를 돌려준다. 메모리 값은 유지된다.
  function set(patch) {
    cache = Object.assign({}, cache, patch);
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
      return true;
    } catch (e) {
      return false;
    }
  }

  STM.settings = { get, set, DEFAULTS };
})(window.STM);
