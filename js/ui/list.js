/* 목록 화면: 세목 탭 + 검색·필터 + 카드 목록 + 일괄 선택 (PRD F4, F5-3, F3-7) */
window.STM.ui = window.STM.ui || {};

(function (STM) {
  'use strict';

  const { el, debounce } = STM.utils;
  const C = STM.constants;

  const EMPTY_FILTERS = Object.freeze({ q: '', from: '', to: '', type: '', status: '', relevance: '' });

  function badge(text, kind, value) {
    return el('span', { class: `badge badge-${kind}`, dataset: value ? { value } : undefined }, text);
  }

  // 문서번호·날짜·기관 등 메타 정보 한 줄 (구분은 간격으로)
  function meta(items, tag) {
    return el(tag || 'div', { class: 'meta' }, items.filter(Boolean));
  }

  function docMeta(r) {
    return meta([el('span', { class: 'doc-no' }, r.docNo), el('span', null, r.date || '날짜 없음'), r.issuer ? el('span', null, r.issuer) : null]);
  }

  // ---------- 필터 ----------
  function searchText(r) {
    const a = r.analysis || C.emptyAnalysis();
    return [r.docNo, r.title, r.summary, a.implications.join(' ')].join(' ').toLowerCase();
  }

  // 세목을 제외한 조건을 적용한다. 검색어는 공백으로 나눈 모든 단어를 포함해야 한다.
  function applyFilters(rulings, f) {
    const words = (f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return rulings.filter((r) => {
      if (f.from && (!r.date || r.date < f.from)) return false;
      if (f.to && (!r.date || r.date > f.to)) return false;
      if (f.type && r.type !== f.type) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.relevance && (f.relevance === 'none' ? r.relevance : r.relevance !== f.relevance)) return false;
      if (words.length) {
        const text = searchText(r);
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    });
  }

  function visibleRulings(state) {
    return applyFilters(state.rulings, state.filters)
      .filter((r) => C.matchesCategory(r, state.activeCategory))
      .sort(C.compareRulings);
  }

  function hasActiveFilters(f) {
    return Object.keys(EMPTY_FILTERS).some((k) => f[k]);
  }

  // ---------- 필터 바 (한 번만 만들어 입력 포커스를 유지한다) ----------
  function selectControl(label, options, onChange) {
    return el(
      'select',
      { 'aria-label': label, onchange: (e) => onChange(e.target.value) },
      options.map(([value, text]) => el('option', { value }, text))
    );
  }

  function buildFilterBar(h) {
    const emit = (patch) => h.onFilterChange(patch);
    const emitSearch = debounce((q) => emit({ q }), 200);
    const controls = {
      q: el('input', {
        type: 'search',
        id: 'search-input',
        placeholder: '제목·요지·시사점·문서번호 검색 ( / )',
        'aria-label': '검색',
        oninput: (e) => emitSearch(e.target.value),
      }),
      from: el('input', { type: 'date', 'aria-label': '시작일', onchange: (e) => emit({ from: e.target.value }) }),
      to: el('input', { type: 'date', 'aria-label': '종료일', onchange: (e) => emit({ to: e.target.value }) }),
      type: selectControl('구분', [['', '전체 구분']].concat(C.TYPES.map((t) => [t, t])), (v) => emit({ type: v })),
      status: selectControl('검토 상태', [['', '전체 상태']].concat(C.STATUSES.map((s) => [s, s])), (v) => emit({ status: v })),
      relevance: selectControl(
        '관련도',
        [['', '전체 관련도']].concat(C.RELEVANCE.map((r) => [r, '관련도 ' + r]), [['none', '관련도 미정']]),
        (v) => emit({ relevance: v })
      ),
    };
    const recentBtn = el('button', { type: 'button', onclick: () => h.onRecent() });
    const resetBtn = el('button', { type: 'button', class: 'btn-quiet', onclick: () => emit(Object.assign({}, EMPTY_FILTERS)) }, '필터 초기화');
    const chips = el('div', { class: 'chips', 'aria-label': '적용된 필터' });
    const node = el('div', null, [
      el('div', { class: 'filter-bar', role: 'search' }, [
        controls.q,
        el('div', { class: 'filter-range' }, [controls.from, el('span', { 'aria-hidden': 'true' }, '~'), controls.to, recentBtn]),
        controls.type,
        controls.status,
        controls.relevance,
        resetBtn,
      ]),
      chips,
    ]);
    return { node, controls, recentBtn, resetBtn, chips, emit };
  }

  // 적용된 필터를 칩으로 보여주고, 칩을 누르면 그 조건만 해제한다.
  function renderChips(f, emit) {
    const chips = [];
    const add = (label, patch) =>
      chips.push(
        el('button', { type: 'button', class: 'chip', 'aria-label': `${label} 필터 해제`, onclick: () => emit(patch) }, [
          el('span', null, label),
          el('span', { class: 'chip-x', 'aria-hidden': 'true' }, '×'),
        ])
      );
    if (f.q) add(`검색: ${f.q}`, { q: '' });
    if (f.from || f.to) add(`기간: ${f.from || '처음'} ~ ${f.to || '오늘'}`, { from: '', to: '' });
    if (f.type) add(`구분: ${f.type}`, { type: '' });
    if (f.status) add(`상태: ${f.status}`, { status: '' });
    if (f.relevance) add(`관련도: ${f.relevance === 'none' ? '미정' : f.relevance}`, { relevance: '' });
    return chips;
  }

  function syncFilterBar(bar, state) {
    for (const key of Object.keys(bar.controls)) {
      const control = bar.controls[key];
      const value = state.filters[key] || '';
      if (document.activeElement !== control && control.value !== value) control.value = value;
    }
    const days = Number(STM.settings.get('periodDays')) || 7;
    bar.recentBtn.textContent = days === 7 ? '최근 1주일' : `최근 ${days}일`;
    bar.resetBtn.disabled = !hasActiveFilters(state.filters);
    bar.chips.replaceChildren(...renderChips(state.filters, bar.emit));
  }

  // ---------- 탭·카드 ----------
  function renderTabs(rulings, active, onTabChange) {
    const tabs = [C.ALL].concat(C.CATEGORIES);
    return el(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': '세목' },
      tabs.map((cat) => {
        const selected = cat === active;
        const count = rulings.filter((r) => C.matchesCategory(r, cat)).length;
        return el(
          'button',
          { type: 'button', class: 'tab' + (selected ? ' is-active' : ''), role: 'tab', 'aria-selected': String(selected), onclick: () => onTabChange(cat) },
          [cat, el('span', { class: 'tab-count' }, String(count))]
        );
      })
    );
  }

  function renderCard(r, selected, h) {
    const preview = r.analysis && r.analysis.implications[0];
    const open = () => h.onOpen(r.id);
    return el(
      'article',
      {
        class: 'card' + (selected ? ' is-selected' : ''),
        dataset: { relevance: r.relevance || 'none', status: r.status },
        tabindex: '0',
        role: 'button',
        'aria-label': `${r.docNo} ${r.title}`,
        onclick: open,
        onkeydown: (e) => {
          if (e.target !== e.currentTarget) return; // 카드 안 체크박스의 키 입력은 무시
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        },
      },
      [
        el('label', { class: 'card-select', onclick: (e) => e.stopPropagation() }, [
          el('input', { type: 'checkbox', checked: selected, 'aria-label': `${r.docNo} 선택`, onchange: (e) => h.onSelect(r.id, e.target.checked) }),
        ]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'card-badges' }, [
            badge(r.category, 'category', r.category),
            badge(r.type, 'type'),
            badge('관련도 ' + (r.relevance || '-'), 'relevance', r.relevance || 'none'),
            badge(r.status, 'status', r.status),
            C.hasAnalysis(r.analysis) ? null : badge('미분석', 'pending'),
          ]),
          docMeta(r),
          el('h3', { class: 'card-title' }, r.title),
          preview ? el('p', { class: 'card-preview' }, preview) : null,
        ]),
      ]
    );
  }

  function renderSelectionBar(visible, state, h) {
    const batch = state.batch;
    const selectedCount = state.selected.size;
    const left = el('span', { class: 'result-count' }, `${visible.length}건`);
    if (batch.running) {
      return el('div', { class: 'selection-bar is-busy', role: 'status', 'aria-busy': 'true' }, [
        left,
        el('span', { class: 'selection-actions' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), `AI 분석 중 ${batch.done}/${batch.total}건`]),
      ]);
    }
    const right = selectedCount
      ? [
          el('span', null, `${selectedCount}건 선택`),
          el('button', { type: 'button', class: 'btn-primary', onclick: h.onAnalyzeSelected }, '선택 분석'),
          el('button', { type: 'button', onclick: h.onClearSelection }, '선택 해제'),
        ]
      : [el('button', { type: 'button', disabled: !visible.length, onclick: () => h.onSelectAll(visible.map((r) => r.id)) }, '보이는 항목 모두 선택')];
    return el('div', { class: 'selection-bar' }, [left, el('div', { class: 'selection-actions' }, right)]);
  }

  function renderEmpty(state, h) {
    if (!state.rulings.length) {
      return el('div', { class: 'empty' }, [
        el('p', { class: 'empty-title' }, '등록된 예규/판례가 없습니다.'),
        el('p', { class: 'empty-text' }, '최근 1주일 판례·해석례를 수집하거나, 국세청 예규 목록을 엑셀에서 복사해 붙여넣어 시작하세요.'),
        el('div', { class: 'empty-actions' }, [
          el('button', { type: 'button', class: 'btn-primary', onclick: h.onCollect }, '최근 1주일 수집'),
          el('button', { type: 'button', onclick: h.onPaste }, '붙여넣기 등록'),
          el('button', { type: 'button', onclick: h.onAdd }, '+ 직접 추가'),
          el('button', { type: 'button', class: 'btn-quiet', onclick: h.onSample }, '샘플 데이터 넣기'),
        ]),
      ]);
    }
    if (hasActiveFilters(state.filters)) {
      return el('div', { class: 'empty' }, [
        el('p', { class: 'empty-title' }, '조건에 맞는 예규/판례가 없습니다.'),
        el('p', { class: 'empty-text' }, '검색어나 기간을 바꾸거나 필터를 초기화하세요.'),
        el('div', { class: 'empty-actions' }, [el('button', { type: 'button', onclick: () => h.onFilterChange(Object.assign({}, EMPTY_FILTERS)) }, '필터 초기화')]),
      ]);
    }
    return el('div', { class: 'empty' }, [
      el('p', { class: 'empty-title' }, `${state.activeCategory}에 해당하는 예규/판례가 없습니다.`),
      el('p', { class: 'empty-text' }, '다른 세목 탭을 보거나 [전체]에서 확인하세요.'),
    ]);
  }

  const views = new WeakMap();

  function render(root, state, h) {
    let view = views.get(root);
    if (!view || !root.contains(view.node)) {
      const filterBar = buildFilterBar(h);
      const tabs = el('div');
      const bar = el('div');
      const results = el('div');
      view = { node: el('div', { class: 'list-view' }, [tabs, filterBar.node, bar, results]), filterBar, tabs, bar, results };
      root.replaceChildren(view.node);
      views.set(root, view);
    }
    syncFilterBar(view.filterBar, state);

    const filtered = applyFilters(state.rulings, state.filters);
    const visible = filtered.filter((r) => C.matchesCategory(r, state.activeCategory)).sort(C.compareRulings);
    view.tabs.replaceChildren(renderTabs(filtered, state.activeCategory, h.onTabChange));
    view.bar.replaceChildren(renderSelectionBar(visible, state, h));
    view.results.replaceChildren(
      visible.length ? el('div', { class: 'card-list' }, visible.map((r) => renderCard(r, state.selected.has(r.id), h))) : renderEmpty(state, h)
    );
  }

  STM.ui.list = { render, badge, meta, docMeta, applyFilters, visibleRulings, EMPTY_FILTERS };
})(window.STM);
